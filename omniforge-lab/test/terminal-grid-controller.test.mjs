import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { sessionsForProject } from '../pane-scope.mjs';
import { TerminalLayout, TerminalTranscript, canControlTerminal, splitTerminalInput, terminalWindowUrl, terminalTextTail } from '../terminal-grid.mjs';

// Executes the actual index controller functions against a DOM seam. No renderer,
// browser, PTY process, provider or shell command is launched by these checks.
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const block=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to));
function environment(api=async()=>{throw Error('Unavailable');}) {
  const doc={activeElement:null,focused:true,hasFocus(){return this.focused;}};
  class Element {
    constructor(tag,className='',text=''){Object.assign(this,{tag,className,children:[],parent:null,dataset:{},events:{},attributes:{},_text:String(text),value:'',style:{setProperty(){}},scrollHeight:100,clientHeight:100,scrollTop:0});}
    get isConnected(){return this.root===true||!!this.parent?.isConnected;}
    append(child){child.parent=this;this.children.push(child);}
    replaceChildren(){for(const child of this.children)child.parent=null;this.children=[];this._text='';}
    replaceChild(next,old){const i=this.children.indexOf(old);assert.ok(i>=0);old.parent=null;next.parent=this;this.children[i]=next;}
    remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
    get lastElementChild(){return this.children.at(-1);}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    set textContent(value){this.replaceChildren();this._text=String(value);}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(name,callback){(this.events[name]||=[]).push(callback);}
    async fire(name){for(const callback of this.events[name]||[])await callback({target:this,currentTarget:this,preventDefault(){}});}
    focus(){doc.activeElement=this;for(let node=this;node;node=node.parent)for(const callback of node.events.focusin||[])callback({target:this});}
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
    matches(selector){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector.startsWith('[data-'))return selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()) in this.dataset;return this.tag===selector;}
    querySelectorAll(selector){const parts=selector.split(' ');return this.children.flatMap(child=>[...(child.matches(parts[0])?(parts.length>1?child.querySelectorAll(parts.slice(1).join(' ')):[child]):[]),...child.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  }
  const grid=new Element('div');grid.root=true;
  doc.querySelectorAll=selector=>grid.querySelectorAll(selector);
  const local={state:{sessions:['a','b','c','d'].map(id=>({id,projectId:'p',name:id,status:'running',host:'local-shell'})).concat({id:'foreign',projectId:'q',name:'foreign',status:'running',host:'local-shell'})},projectId:'p',paneSessions:[],ptyViews:new Map(),buffers:new Map(),view:'workspace',confirmedAcks:new Set()};
  const layout=new TerminalLayout({getItem(){return null;},setItem(){}}),streams=new Map(),requests=[],messages=[],timers=new Map();let timerId=0;
  const make=(tag,className,text)=>new Element(tag,className,text),one=(parent,...args)=>{const e=make(...args);parent.append(e);return e;};
  const ctx=vm.createContext({document:doc,local,terminalLayout:layout,terminalStreams:streams,seedPending:false,windowSeed:new URLSearchParams(),gridControlsKey:'',gridControls:{render(){}},
    TerminalTranscript,canControlTerminal,splitTerminalInput,terminalWindowUrl,terminalTextTail,TextEncoder,URL,URLSearchParams,
    sessionsForProject,sessionById:id=>local.state.sessions.find(s=>s.id===id),projectById:id=>({id,name:id,root:`/${id}`}),currentProjectSessions:()=>sessionsForProject(local.state.sessions,local.projectId),
    $:selector=>selector==='#terminal-grid'?grid:null,make,one,statusLabel:s=>s,fillSelect(select,options,value){select.value=value||'';},
    api:async(path,options)=>{requests.push({path,options});return api(path,options);},action:(...args)=>{requests.push(args);},toast:message=>messages.push(message),log(){},renderLog(){},requestAnimationFrame(){},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},location:{href:'http://local/?token=hidden'},window:{open(){}},ptyModulesPromise:undefined});
  vm.runInContext(block('    function reconcilePanes()', '    function clearContext()')+block('    const isPtySession', '    function renderLog()'),ctx);
  return {ctx,grid,doc,local,layout,streams,requests,messages,timers,render:()=>ctx.renderWorkspace()};
}

test('actual grid renders N panes, reorders drafts/focus and closes only the view',async()=>{
  const env=environment();env.layout.switchProject('p',env.local.state.sessions);env.layout.add(env.local.state.sessions);env.layout.add(env.local.state.sessions);env.render();
  assert.equal(env.grid.children.length,4);
  const first=env.grid.children[0],draft=first.querySelector('.command-line input');draft.value='keep this unsent';draft.focus();
  await first.querySelector('[data-pane-next]').fire('click');
  assert.equal(env.grid.children[1].dataset.sessionId,'a');assert.equal(env.grid.children[1].querySelector('.command-line input').value,'keep this unsent');assert.equal(env.doc.activeElement,env.grid.children[1].querySelector('.pane-select'));
  await env.grid.children[1].querySelector('[data-pane-close]').fire('click');
  assert.equal(env.grid.children.length,3);assert.ok(env.local.state.sessions.some(s=>s.id==='a'));assert.ok(!env.requests.some(r=>String(r.path||r[0]).includes('/stop')));
  env.local.projectId='q';env.render();assert.deepEqual(env.grid.children.map(p=>p.dataset.sessionId),['foreign','']);assert.equal(env.streams.size,1);
  env.local.projectId='p';env.local.state.sessions=env.local.state.sessions.filter(s=>s.id!=='b');env.render();assert.ok(!env.local.paneSessions.includes('b'));assert.ok(!env.local.paneSessions.includes('foreign'));
});

test('empty panes are rebuilt for a newly selected project so session creation becomes available',()=>{
  const env=environment();env.local.projectId=null;env.render();const empty=env.grid.children[0];
  assert.equal(empty.querySelectorAll('button').find(b=>b.textContent==='Nova sessão').disabled,true);
  env.local.projectId='empty-project';env.render();assert.notEqual(env.grid.children[0],empty);
  assert.equal(env.grid.children[0].querySelectorAll('button').find(b=>b.textContent==='Nova sessão').disabled,false);
});

test('a late replay after project switch cannot display content or refill a discarded buffer',async()=>{
  const pending=[];const env=environment(path=>new Promise(resolve=>pending.push({path,resolve})));env.render();
  const old=pending.find(p=>p.path.includes('/a/output'));assert.ok(old);
  env.local.projectId='q';env.render();
  old.resolve({sessionId:'a',projectId:'p',epoch:'e1',firstSequence:1,nextSequence:2,truncated:false,chunks:[{sequence:1,stream:'stdout',text:'PRIVATE_A'}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(!env.local.buffers.has('a'));assert.ok(!env.grid.textContent.includes('PRIVATE_A'));
  assert.throws(()=>env.ctx.acceptTerminal({sessionId:'foreign',projectId:'p',epoch:'e1',sequence:1,text:'PRIVATE_A',stream:'stdout'}));assert.ok(!env.grid.textContent.includes('PRIVATE_A'));
});

test('actual replay/SSE controller deduplicates output and reconnect requests the known cursor',async()=>{
  const env=environment(async path=>{const after=Number(new URL(path,'http://local').searchParams.get('after'));return {sessionId:'a',projectId:'p',epoch:'e1',firstSequence:1,nextSequence:3,truncated:false,chunks:[1,2].filter(n=>n>after).map(sequence=>({sequence,text:String(sequence),stream:'stdout'}))};});
  env.layout.switchProject('p',env.local.state.sessions,'a');env.render();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(env.local.buffers.get('a'),'12');env.ctx.acceptTerminal({sessionId:'a',projectId:'p',epoch:'e1',sequence:2,text:'2',stream:'stdout'});assert.equal(env.local.buffers.get('a'),'12');
  await env.ctx.replayTerminal('a');assert.match(env.requests.at(-1).path,/after=2$/);assert.equal(env.local.buffers.get('a'),'12');
});

test('actual controller fetches missing history after a same-tail epoch reset and exposes local retention loss',async()=>{
  let epoch='old';const env=environment(async path=>{
    const after=Number(new URL(path,'http://local').searchParams.get('after'));
    return {sessionId:'a',projectId:'p',epoch,firstSequence:1,nextSequence:3,truncated:after>=3,
      chunks:[1,2].filter(n=>after>=3||n>after).map(sequence=>({sequence,text:`${epoch}${sequence}`,stream:'stdout'}))};
  });
  env.layout.switchProject('p',env.local.state.sessions,'a');env.render();await new Promise(resolve=>setImmediate(resolve));assert.equal(env.local.buffers.get('a'),'old1old2');
  const before=env.requests.length;epoch='new';await env.ctx.replayTerminal('a');
  assert.equal(env.local.buffers.get('a'),'new1new2');assert.equal(env.requests.length-before,2);
  assert.match(env.requests.at(-2).path,/after=2$/);assert.match(env.requests.at(-1).path,/after=0$/);
  for(let sequence=3;sequence<=18;sequence++)env.ctx.acceptTerminal({sessionId:'a',projectId:'p',epoch,sequence,text:'x'.repeat(8192),stream:'stdout'});
  assert.match(env.grid.querySelector('.terminal-replay-status').textContent,/início foi descartado/);
  env.ctx.acceptTerminal({sessionId:'a',projectId:'p',epoch,sequence:19,text:'newest',stream:'stdout'});
  assert.match(env.grid.querySelector('.terminal-replay-status').textContent,/início foi descartado/);
});

test('actual queued input rechecks focus before each bounded write and never sends to a stale pane',async()=>{
  let release;const env=environment(()=>new Promise(resolve=>{release=resolve;}));env.layout.switchProject('p',env.local.state.sessions);env.ctx.reconcilePanes();
  const view={index:0,sessionId:'a',disposed:false,inputFailed:false,queuedInput:0,writeQueue:Promise.resolve(),term:{options:{}}};
  env.ctx.sendPtyInput(view,'x'.repeat(8192)+'🤖');await new Promise(resolve=>setImmediate(resolve));assert.equal(env.requests.length,1);
  env.doc.focused=false;release({});await view.writeQueue;assert.equal(env.requests.length,1);assert.equal(view.queuedInput,0);assert.match(env.messages.at(-1),/interrompida/);
  env.doc.focused=true;env.local.projectId='q';env.ctx.sendPtyInput(view,'must not send');await view.writeQueue;assert.equal(env.requests.length,1);
  env.local.projectId='p';env.ctx.sendPtyInput(view,'x'.repeat(65537));assert.equal(env.requests.length,1);assert.match(env.messages.at(-1),/limite/);
});

test('actual display cache preserves Unicode at its retention boundary and ignores retired live output',async()=>{
  const env=environment();env.layout.switchProject('p',env.local.state.sessions,'a');env.render();
  env.ctx.appendOutput('a','🤖');for(let i=0;i<14;i++)env.ctx.appendOutput('a','x'.repeat(8192));env.ctx.appendOutput('a','x'.repeat(5311));
  assert.ok(env.local.buffers.get('a').length<=120000);assert.equal(env.local.buffers.get('a').isWellFormed(),true);
  const transcript=env.streams.get('a').transcript;transcript.live({sessionId:'a',projectId:'p',epoch:'old',sequence:1,text:'old',stream:'stdout'});
  const update=transcript.replay({sessionId:'a',projectId:'p',epoch:'current',firstSequence:1,nextSequence:2,truncated:true,chunks:[{sequence:1,text:'current',stream:'stdout'}]},transcript.begin());
  env.ctx.displayTranscript('a',update);assert.doesNotThrow(()=>env.ctx.acceptTerminal({sessionId:'a',projectId:'p',epoch:'old',sequence:2,text:'delayed old',stream:'stdout'}));
  assert.equal(env.local.buffers.get('a'),'current');
});

test('two invalidated replay replies schedule one bounded catch-up even if the stream then goes quiet',async()=>{
  let phase='initial';const pending=[];
  const response=(epoch,after)=>({sessionId:'a',projectId:'p',epoch,firstSequence:1,nextSequence:2,truncated:false,chunks:after===0?[{sequence:1,text:epoch,stream:'stdout'}]:[]});
  const env=environment(path=>{const after=Number(new URL(path,'http://local').searchParams.get('after'));return phase==='initial'?response('initial',after):phase==='stale'?new Promise(resolve=>pending.push(resolve)):response('latest',after);});
  env.layout.switchProject('p',env.local.state.sessions,'a');env.render();await new Promise(resolve=>setImmediate(resolve));phase='stale';
  const replaying=env.ctx.replayTerminal('a');
  env.ctx.acceptTerminal({sessionId:'a',projectId:'p',epoch:'middle',sequence:1,text:'middle',stream:'stdout'});pending.shift()(response('initial',1));await new Promise(resolve=>setImmediate(resolve));
  env.ctx.acceptTerminal({sessionId:'a',projectId:'p',epoch:'latest',sequence:1,text:'latest',stream:'stdout'});pending.shift()(response('middle',1));await replaying;
  assert.equal(env.timers.size,1,'a quiet stream still needs exactly one queued catch-up');phase='latest';
  const [timer,run]=env.timers.entries().next().value;env.timers.delete(timer);run();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(env.local.buffers.get('a'),'latest');assert.equal(env.streams.get('a').transcript.pendingEpoch,null);assert.equal(env.timers.size,0);
});

test('confirmed epoch reset stays visible across catch-up, live output, refresh and local truncation',async()=>{
  let epoch='initial',finishCatchup,failRefresh=false;const chunks=[{sequence:1,text:'initial',stream:'stdout'}];
  const response=after=>({sessionId:'a',projectId:'p',epoch,firstSequence:1,nextSequence:chunks.length+1,truncated:false,chunks:chunks.filter(c=>c.sequence>after)});
  const env=environment(path=>{if(failRefresh)throw Error('offline');const after=Number(new URL(path,'http://local').searchParams.get('after'));return epoch==='new'&&after===0?new Promise(resolve=>finishCatchup=()=>resolve(response(after))):response(after);});
  env.layout.switchProject('p',env.local.state.sessions,'a');env.render();await new Promise(resolve=>setImmediate(resolve));
  const status=()=>env.grid.querySelector('.terminal-replay-status').textContent;
  assert.doesNotMatch(status(),/Histórico recente reiniciado/);
  epoch='new';chunks[0].text='new';const reset=env.ctx.replayTerminal('a');await new Promise(resolve=>setImmediate(resolve));
  assert.match(status(),/Histórico recente reiniciado/);assert.match(status(),/possível reinício do servidor ou descarte/);assert.match(status(),/Recuperando lacuna/);
  finishCatchup();await reset;assert.equal(env.local.buffers.get('a'),'new');assert.match(status(),/Histórico recente reiniciado/);
  chunks.push({sequence:2,text:'live',stream:'stdout'});env.ctx.acceptTerminal({sessionId:'a',projectId:'p',epoch,...chunks[1]});assert.match(status(),/Histórico recente reiniciado/);
  await env.ctx.replayTerminal('a');env.render();assert.match(status(),/Histórico recente reiniciado/);
  for(let sequence=3;sequence<=18;sequence++)env.ctx.acceptTerminal({sessionId:'a',projectId:'p',epoch,sequence,text:'x'.repeat(8192),stream:'stdout'});
  assert.match(status(),/Histórico recente reiniciado/);assert.match(status(),/início foi descartado/);
  failRefresh=true;await env.ctx.replayTerminal('a');assert.match(status(),/Histórico recente reiniciado/);assert.match(status(),/indisponível/);
});

test('actual fit resizes only the focused live pane and coalesces in-flight requests',async()=>{
  let release;const env=environment(()=>new Promise(resolve=>{release=resolve;}));env.layout.switchProject('p',env.local.state.sessions);env.ctx.reconcilePanes();
  let fits=0;const view={index:0,sessionId:'a',pane:{isConnected:true},host:{clientWidth:400,clientHeight:300},fit:{fit(){fits++;}},term:{cols:90,rows:30}};
  env.doc.focused=false;env.ctx.fitPty(view);assert.equal(fits,1);assert.equal(env.requests.length,0);
  env.doc.focused=true;env.layout.focus(1);env.ctx.fitPty(view);assert.equal(env.requests.length,0);
  env.layout.focus(0);env.ctx.fitPty(view);env.ctx.fitPty(view);assert.equal(env.requests.length,1);assert.match(env.requests[0].path,/\/a\/resize$/);
  release({});await new Promise(resolve=>setImmediate(resolve));env.ctx.fitPty(view);assert.equal(env.requests.length,1);
  env.local.projectId='q';view.lastSize=null;env.ctx.fitPty(view);assert.equal(env.requests.length,1);
});

test('xterm keeps Tab for shell completion until Ctrl+M makes Tab move focus; Shift+Tab always leaves without writing to the PTY',async()=>{
  const env=environment();env.local.state.sessions[0].host='local-pty';let term;
  env.ctx.ptyModulesPromise=Promise.resolve({Terminal:class{constructor(options){term=this;this.options=options;}loadAddon(){}open(){this.textarea=env.ctx.make('textarea');}write(){}dispose(){}onData(fn){this.input=fn;return{dispose(){}};}attachCustomKeyEventHandler(fn){this.keys=fn;}},FitAddon:class{}});
  env.ctx.ResizeObserver=class{observe(){}disconnect(){}};env.doc.body={dataset:{theme:'operations'}};
  env.layout.switchProject('p',env.local.state.sessions,'a');env.render();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof term?.keys,'function','the PTY pane installs a key handler');
  const press=(key,extra={})=>{let prevented=false;const handled=term.keys({type:'keydown',key,ctrlKey:false,shiftKey:false,altKey:false,metaKey:false,preventDefault(){prevented=true;},...extra});return{handled,prevented};};
  const hint=env.grid.querySelector('.terminal-tab-mode');
  assert.equal(press('Tab').handled,true,'by default Tab reaches the shell for completion');assert.match(hint.textContent,/Ctrl\+M/);
  assert.equal(press('Tab',{shiftKey:true}).handled,false,'default Shift+Tab leaves without writing ESC[Z to the shell');
  assert.ok(hint.id&&term.textarea.attributes['aria-describedby']===hint.id,'the focused xterm input points screen readers to the Ctrl+M hint');
  assert.deepEqual(press('m',{ctrlKey:true}),{handled:false,prevented:true},'Ctrl+M toggles and never reaches the shell as CR');
  assert.match(hint.textContent,/Tab move o foco/);assert.match(env.messages.at(-1),/Tab move o foco/);
  assert.equal(press('Tab').handled,false);assert.equal(press('Tab',{shiftKey:true}).handled,false,'Shift+Tab leaves without ESC[Z');assert.equal(press('a').handled,true);
  assert.ok(!env.requests.some(r=>String(r.path||r[0]).includes('/write')));
  press('m',{ctrlKey:true});assert.equal(press('Tab').handled,true);assert.doesNotMatch(hint.textContent,/Tab move o foco \(/);
});

test('actual session creation selects the first new session but never follows a stale project response',async()=>{
  for(const switchAway of [false,true]){
    const env=environment();env.local.state.sessions=env.local.state.sessions.filter(s=>s.projectId!=='p');env.render();
    const button={disabled:false},form={hidden:false,elements:{projectId:{value:'p'},name:{value:'Created'}},events:{},querySelector(){return button;},reset(){this.elements.name.value='';},addEventListener(name,fn){this.events[name]=fn;}};
    const query=env.ctx.$;env.ctx.$=selector=>selector==='#session-form'?form:selector==='#toggle-session'?{setAttribute(){}}:query(selector);
    env.ctx.selectProject=id=>{env.local.projectId=id;env.render();};env.ctx.renderAll=env.render;env.ctx.showView=()=>{};
    let release;env.ctx.action=()=>new Promise(resolve=>{release=()=>{const created={id:'new',projectId:'p',name:'Created',host:'local-shell',status:'running'};env.local.state.sessions.push(created);env.render();resolve(created);};});
    vm.runInContext(html.split('\n').find(line=>line.startsWith("    $('#session-form').addEventListener('submit'")),env.ctx);
    const pending=form.events.submit({preventDefault(){},currentTarget:form});assert.equal(button.disabled,true);
    if(switchAway){env.local.projectId='q';env.render();}
    release();await pending;assert.equal(button.disabled,false);
    if(switchAway){assert.equal(env.local.projectId,'q');assert.deepEqual(env.local.paneSessions,['foreign',null]);assert.equal(form.hidden,false);}
    else{assert.equal(env.local.paneSessions[0],'new');assert.equal(form.hidden,true);}
  }
});
