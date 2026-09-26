import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftSession, contextExcerpt, localTemplate, catalogResponse, candidateSkills, refreshCatalogIndex, mountCatalog } from '../copilot.mjs';

test('an async suggestion stays stale after editing and restoring the same draft', () => {
  const session = new DraftSession('p1', 'revisar código');
  const captured = session.capture(0, 7);
  session.update('outro texto', 'p1');
  session.update('revisar código', 'p1');
  assert.equal(session.propose(captured, 'auditar'), false);
  assert.equal(session.text, 'revisar código');
});

test('project ABA and newer requests invalidate older suggestions', () => {
  const session = new DraftSession('p1', 'abc');
  const first = session.capture(0, 1);
  session.update('abc', 'p2'); session.update('abc', 'p1');
  assert.equal(session.propose(first, 'x'), false);
  const second = session.capture(0, 1); session.capture(1, 2);
  assert.equal(session.propose(second, 'x'), false);
});

test('selection apply changes only the captured UTF16 span and undo is revision bound', () => {
  const session = new DraftSession('p1', 'Olá 🤖 mundo');
  assert.throws(() => session.capture(5, 6), /selection/i);
  assert.equal(session.propose(session.capture(4, 6), 'amigo'), true);
  assert.equal(session.text, 'Olá 🤖 mundo');
  assert.equal(session.apply(), true);
  assert.equal(session.text, 'Olá amigo mundo');
  assert.equal(session.undo(), true);
  assert.equal(session.text, 'Olá 🤖 mundo');
  session.propose(session.capture(4, 6), 'amigo'); session.apply();
  session.update('Olá novo mundo', 'p1');
  assert.equal(session.undo(), false);
});

test('Off cancels in-flight work and cannot apply; oversized replacement is rejected', () => {
  const session = new DraftSession('p1', 'abc');
  const captured = session.capture(); session.setMode('off');
  assert.equal(session.propose(captured, 'x'), false);
  assert.equal(session.apply(), false);
  session.setMode('discreet');
  assert.equal(session.propose(session.capture(), 'x'.repeat(4001)), false);
});

test('duplicate and multiline selections preserve surrounding characters and reject stale apply', () => {
  const session = new DraftSession('p1', 'foo\nfoo fim');
  session.propose(session.capture(5,7), 'AR');
  assert.equal(session.apply(), true);
  assert.equal(session.text, 'foo\nfAR fim');
  session.undo();
  session.propose(session.capture(0,7), 'duas linhas');
  session.update('texto diferente', 'p1'); session.update('foo\nfoo fim', 'p1');
  assert.equal(session.apply(), false);
  assert.equal(session.text, 'foo\nfoo fim');
});

test('native catalog coverage schema remains visibly incomplete and unknown hosts grant no execution', () => {
  const result = catalogResponse({snapshot_id:'native',coverage:{complete_for_discovery_scope:false},issues:[{severity:'error'}],rows:[
    {skill_id:'one',name:'review',ring:'installed',hosts:[],availability:'installed',runnable:true},
  ],total:1,query:''});
  assert.equal(result.coverage.complete_for_discovery_scope,false);
  assert.equal(candidateSkills(result.rows)[0].runnable,false);
  assert.deepEqual(candidateSkills(result.rows)[0].hosts,[]);
});

test('pause policy respects visibility, focus, selected text and one suggestion per revision', () => {
  const session = new DraftSession('p1', 'abc');
  const options = { visible: true, focused: true, selected: false, now: 100 };
  assert.equal(session.canPause(options), true);
  for (const changed of [{visible:false}, {focused:false}, {selected:true}]) assert.equal(session.canPause({...options,...changed}), false);
  session.lastSuggestedRevision = session.revision;
  assert.equal(session.canPause(options), false);
  session.update('abcd', 'p1');
  assert.equal(session.canPause(options), true);
});

test('rejection asks once per draft revision, retains draft and cooldown across revisions', () => {
  const session = new DraftSession('p1', 'abc');
  assert.equal(session.dismiss(100), true);
  assert.equal(session.dismiss(101), false);
  assert.equal(session.text, 'abc');
  session.update('abcd', 'p1');
  assert.equal(session.canPause({visible:true,focused:true,selected:false,now:110}), false);
  assert.equal(session.dismiss(120), true);
});

test('context has source provenance, an exact character bound and no cross-project/session leak', () => {
  const notes = [
    {scope:'global',source:'owner',text:'preferência global',mutationSequence:1},
    {scope:'project',projectId:'p1',source:'ADR',text:'x'.repeat(2000),mutationSequence:2},
    {scope:'project',projectId:'p2',source:'secret',text:'private'},
    {scope:'session',projectId:'p1',sessionId:'s1',source:'secret',text:'private'},
    {scope:'project',projectId:'p1',source:'archived',text:'private',archivedAt:'today'},
  ];
  const result = contextExcerpt(notes, 'p1', 350);
  assert.ok(result.length <= 350);
  assert.match(result, /ADR/); assert.doesNotMatch(result, /secret|private/);
  assert.equal(contextExcerpt(notes, null), '');
  assert.match(localTemplate('context', 'pedido', result), /Fonte: ADR/);
});

test('catalog validates its response and recommendations retain explicit non-executable status', () => {
  assert.throws(() => catalogResponse({rows:[],total:0}), /catalog/i);
  const response = catalogResponse({snapshot_id:'abc',coverage:{complete:false},issues:[],rows:[
    {skill_id:'a',name:'remote',ring:'remote',availability:'not_installed',runnable:true},
    {skill_id:'b',name:'installed',ring:'installed',availability:'installed',runnable:false},
  ],total:2,query:'review'});
  const candidates = candidateSkills(response.rows);
  assert.equal(candidates.length, 1); assert.equal(candidates[0].name, 'installed');
  assert.equal(candidates[0].runnable, false);
  assert.equal(candidateSkills(Array.from({length:8},(_,i)=>({skill_id:String(i),name:'x',ring:'installed',availability:'installed'}))).length, 3);
});

test('explicit index refresh rebuilds before querying so newly installed skills replace cached rows', async () => {
  const calls = []; let rebuilt = false;
  const api = async (path, options) => {
    calls.push([path,options]);
    if (path === '/api/skills/refresh') { rebuilt = true; return {snapshot_id:'new',coverage:{complete:true}}; }
    return {snapshot_id:rebuilt?'new':'old',coverage:{complete:true},issues:[],rows:[{skill_id:'a',name:rebuilt?'newly installed':'old cache'}],total:1};
  };
  const result = await refreshCatalogIndex(api,{path:'/api/skills?q=&ring=installed',isCurrent:()=>true});
  assert.equal(result.rows[0].name,'newly installed');
  assert.deepEqual(calls,[['/api/skills/refresh',{method:'POST',body:{}}],['/api/skills?q=&ring=installed',undefined]]);
});

test('index refresh ignores old filter/project responses and fails visibly instead of claiming an update', async () => {
  let current = true, count = 0;
  const stale = await refreshCatalogIndex(async()=>{count++;current=false;return{snapshot_id:'new',coverage:{complete:true}};},
    {path:'/api/skills?q=old',isCurrent:()=>current});
  assert.equal(stale,null); assert.equal(count,1);
  await assert.rejects(refreshCatalogIndex(async()=>{throw Error('build failed');},{path:'/api/skills',isCurrent:()=>true}),/build failed/);
});

// Minimal DOM seam: replacing an ancestor of the focused node moves focus to body.
// This verifies the actual asynchronous catalog controller without a browser.
function stubDocument() {
  const doc = {};
  class Element {
    constructor(tag) { this.tagName=tag.toUpperCase(); this.children=[]; this.events={}; this.parent=null; this._text=''; }
    append(child) { if(child.parent)child.parent.children=child.parent.children.filter(item=>item!==child); child.parent=this;this.children.push(child); }
    contains(element) { return element===this || this.children.some(child=>child.contains(element)); }
    replaceChildren() { if(this.children.some(child=>child.contains(doc.activeElement)))doc.activeElement=doc.body; for(const child of this.children)child.parent=null;this.children=[];this._text=''; }
    set textContent(text) {this.replaceChildren();this._text=String(text);}
    get textContent() {return this._text+this.children.map(child=>child.textContent).join('');}
    set value(value) {this._value=value;}
    get value() {return this._value ?? (this.tagName==='SELECT'?this.children[0]?.value:'') ?? '';}
    setAttribute() {}
    addEventListener(name,fn) {this.events[name]=fn;}
    focus() {doc.activeElement=this;}
    querySelector(tag) {for(const child of this.children){if(child.tagName===tag.toUpperCase())return child;const found=child.querySelector(tag);if(found)return found;}return null;}
    click() {return this.events.click?.({target:this});}
  }
  doc.createElement=tag=>new Element(tag);doc.body=new Element('body');doc.activeElement=doc.body;
  return doc;
}

test('catalog detail retains its focused heading across success/error and never steals departed focus', async () => {
  const previous = globalThis.document;
  try {
    for (const outcome of ['success','error','moved']) {
      const doc=stubDocument();globalThis.document=doc;
      const root=doc.createElement('section'),list=doc.createElement('div'),search=doc.createElement('input'),count=doc.createElement('span');
      doc.body.append(root);root.append(list);let resolve,reject;
      const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
      const row={skill_id:'a',name:'Skill A'};
      const controller=mountCatalog({root,list,search,count,fallback:()=>[],api:path=>path.includes('/api/skills/a')?pending:Promise.resolve({snapshot_id:'s',coverage:{complete:true},issues:[],rows:[row],total:1})});
      await controller.load();const completion=list.querySelector('button').click();
      const focused=doc.activeElement;assert.equal(focused.tagName,'H2');
      const elsewhere=doc.createElement('button');doc.body.append(elsewhere);
      if(outcome==='moved')elsewhere.focus();
      if(outcome==='error')reject(Error('offline'));else resolve({snapshot_id:'s',row});
      await completion;
      assert.equal(doc.activeElement===(outcome==='moved'?elsewhere:focused),true,`focus after ${outcome}`);
      assert.equal(root.contains(focused),true,'loading heading remains attached');
    }
  } finally {globalThis.document=previous;}
});

test('opening a known item searches its own ring, not the installed default of the Anel select', async () => {
  const previous = globalThis.document;
  try {
    const doc=stubDocument();globalThis.document=doc;
    const root=doc.createElement('section'),list=doc.createElement('div'),search=doc.createElement('input'),count=doc.createElement('span'),paths=[];
    doc.body.append(root);root.append(list);search.value='candidate';
    const controller=mountCatalog({root,list,search,count,fallback:()=>[],api:async path=>{paths.push(path);return {snapshot_id:'s',coverage:{complete:true},issues:[],rows:[],total:0};}});
    await controller.load();assert.match(paths.at(-1),/ring=installed/);
    await controller.search('catalog');assert.match(paths.at(-1),/ring=catalog/,'a catalog candidate is searched in the catalog ring');
    await controller.search('missing');assert.match(paths.at(-1),/ring=all/,'a ring the select cannot show falls back to all rings');
    await controller.search();assert.match(paths.at(-1),/ring=all/,'a plain search keeps the current ring');
  } finally {globalThis.document=previous;}
});
