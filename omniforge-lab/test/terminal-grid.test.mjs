import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePaneSessions, selectPaneSession } from '../pane-scope.mjs';
import { TerminalLayout, TerminalTranscript, terminalWindowUrl, canControlTerminal, splitTerminalInput } from '../terminal-grid.mjs';

const sessions = ['a','b','c','d'].map(id=>({id,projectId:'p'})).concat({id:'foreign',projectId:'other'});

test('three or more panes remain unique and project bound while selecting another visible session',()=>{
  const panes = reconcilePaneSessions(sessions,'p',['a','b','c',null]);
  assert.deepEqual(panes,['a','b','c','d']);
  assert.deepEqual(selectPaneSession(sessions,'p',panes,0,'d'),['d','b','c','a']);
  assert.throws(()=>selectPaneSession(sessions,'p',panes,2,'foreign'),/project/);
});

const storage = () => ({value:null,getItem(){return this.value;},setItem(key,value){this.value=value;}});
test('layouts survive reload, remain independent across windows and restore each project',()=>{
  const store=storage(),layout=new TerminalLayout(store);layout.switchProject('p',sessions);layout.add(sessions);layout.setColumns(3);layout.setWeight(0,3);layout.setHeight(0,760);layout.assign(0,'c',sessions);
  const expected=structuredClone(layout.value);
  layout.switchProject('other',sessions);assert.deepEqual(layout.value.panes,['foreign',null]);layout.remove(1);
  layout.switchProject('p',sessions);assert.deepEqual(layout.value,expected);
  const reload=new TerminalLayout(store);reload.switchProject('p',sessions);assert.deepEqual(reload.value,expected);
  const duplicateStore=storage();duplicateStore.value=store.value;const duplicate=new TerminalLayout(duplicateStore);duplicate.switchProject('p',sessions);duplicate.remove(1);duplicate.setColumns(1);
  assert.deepEqual(new TerminalLayout(store).layouts.get('p'),expected);
  assert.equal(duplicate.value.panes.length,2);
});

test('pane count and dimensions are bounded; removed and foreign identities cannot survive restore',()=>{
  const store=storage(),layout=new TerminalLayout(store);layout.switchProject('p',sessions);while(layout.value.panes.length<8)layout.add(sessions);
  assert.throws(()=>layout.add(sessions));assert.equal(new Set(layout.value.panes.filter(Boolean)).size,4);
  for(const n of [-1,0,5,Infinity,NaN,'2'])assert.throws(()=>layout.setColumns(n));
  assert.throws(()=>layout.setWeight(0,5));assert.throws(()=>layout.setHeight(0,1001));
  layout.switchProject('p',sessions.filter(s=>s.id!=='b'));assert.ok(!layout.value.panes.includes('b'));assert.ok(!layout.value.panes.includes('foreign'));
  while(layout.value.panes.length>1)layout.remove(0);assert.throws(()=>layout.remove(0));
  const invalid=JSON.parse(store.value);invalid.layouts[0][1].panes=Array(1000).fill('foreign');store.value=JSON.stringify(invalid);
  const restored=new TerminalLayout(store);restored.switchProject('p',sessions);assert.deepEqual(restored.value.panes,['a','b']);
  const unavailable=new TerminalLayout({getItem(){throw Error();},setItem(){throw Error();}});unavailable.switchProject('p',sessions);assert.equal(unavailable.persistent,false);
});

test('project cache is bounded and opening a window carries only selected context IDs',()=>{
  const layout=new TerminalLayout(storage());for(let i=0;i<25;i++)layout.switchProject(`p${i}`,[]);assert.equal(layout.layouts.size,20);
  const url=new URL(terminalWindowUrl('http://127.0.0.1:9000/?token=secret&other=private#raw','p','a'));
  assert.equal(url.origin,'http://127.0.0.1:9000');assert.deepEqual([...url.searchParams],[['project','p'],['session','a']]);assert.equal(url.hash,'');
  assert.throws(()=>terminalWindowUrl('file:///private','p'));assert.throws(()=>terminalWindowUrl(url.href,'../foreign'));
  const seeded=new TerminalLayout(storage());seeded.switchProject('p',sessions,'c');assert.deepEqual(seeded.value.panes,['c']);seeded.switchProject('other',sessions,'c');assert.deepEqual(seeded.value.panes,['foreign',null]);
});

test('only the foreground focused pane can control its running project session; Unicode input stays bounded',()=>{
  const base={focused:true,index:0,focusIndex:0,sessionId:'a',panes:['a','b'],projectId:'p',sessions:[{id:'a',projectId:'p',status:'running'}]};
  assert.equal(canControlTerminal(base),true);for(const change of [{focused:false},{focusIndex:1},{projectId:'other'},{panes:['b','a']},{sessions:[{id:'a',projectId:'p',status:'stopped'}]}])assert.equal(canControlTerminal({...base,...change}),false);
  const text='x'.repeat(8191)+'🤖'+'y'.repeat(8192),chunks=splitTerminalInput(text);assert.equal(chunks.join(''),text);assert.ok(chunks.every(c=>c.length<=8192&&c.isWellFormed()));assert.throws(()=>splitTerminalInput('x'.repeat(65537)));assert.throws(()=>splitTerminalInput('\ud800'));
});

const chunk=(sequence,text=String(sequence))=>({sequence,text,stream:'stdout'});
const live=(sequence,text,epoch='e1')=>({sessionId:'a',projectId:'p',epoch,...chunk(sequence,text)});
const snapshot=(chunks,options={})=>({sessionId:'a',projectId:'p',epoch:'e1',firstSequence:1,nextSequence:(chunks.at(-1)?.sequence||0)+1,truncated:false,chunks,...options});

test('live and replay merge once in sequence; reconnect retains the exact cursor',()=>{
  const transcript=new TerminalTranscript('a','p');transcript.live(live(1,'a'));const token=transcript.begin();
  assert.equal(transcript.live(live(3,'c')).gap,true);
  assert.deepEqual(transcript.replay(snapshot([chunk(2,'b'),chunk(3,'c')]),token),{reset:false,text:'bc',gap:false});
  assert.equal(transcript.live(live(2,'b')).text,'');assert.equal(transcript.text,'abc');assert.equal(transcript.begin().cursor,3);
  const later=transcript.begin();transcript.live(live(4,'d'));assert.equal(transcript.replay(snapshot([chunk(4,'d')]),later).text,'');assert.equal(transcript.text,'abcd');
});

test('truncated history, future cursor and changed epochs recover including empty buffers',()=>{
  const transcript=new TerminalTranscript('a','p');const initial=transcript.begin();
  assert.equal(transcript.replay(snapshot([chunk(8,'eight'),chunk(9,'nine')],{firstSequence:8,truncated:true}),initial).reset,true);assert.equal(transcript.cursor,9);assert.equal(transcript.text,'eightnine');assert.equal(transcript.truncated,true);
  assert.equal(transcript.replay(snapshot([chunk(1,'new')],{epoch:'e2',truncated:true}),transcript.begin()).text,'new');assert.equal(transcript.cursor,1);
  const result=transcript.replay(snapshot([],{epoch:'e3',truncated:true}),transcript.begin());assert.equal(result.reset,true);assert.equal(transcript.cursor,0);assert.equal(transcript.text,'');
  assert.equal(transcript.replay(snapshot([],{epoch:'e3'}),transcript.begin()).gap,false);
});

test('a live epoch change invalidates the old replay and epoch changes with a matching cursor expose gaps',()=>{
  const transcript=new TerminalTranscript('a','p');transcript.live(live(1,'old'));const stale=transcript.begin();transcript.live(live(1,'new','e2'));
  assert.equal(transcript.replay(snapshot([chunk(2,'stale')]),stale),null);assert.equal(transcript.text,'old','live epoch alone cannot replace current output');
  transcript.replay(snapshot([chunk(1,'new')],{epoch:'e2',truncated:true}),transcript.begin());assert.equal(transcript.text,'new');
  const reset=transcript.replay(snapshot([chunk(2,'two'),chunk(3,'three')],{epoch:'e3'}),transcript.begin());assert.equal(reset.reset,true);assert.equal(reset.gap,true);
  transcript.replay(snapshot([chunk(1,'one'),chunk(2,'two'),chunk(3,'three')],{epoch:'e3'}),transcript.begin());assert.equal(transcript.text,'onetwothree');
});

test('changed epoch with the same final sequence exposes missing history even without pending frames',()=>{
  const transcript=new TerminalTranscript('a','p');transcript.live(live(1,'old one'));transcript.live(live(2,'old two'));
  // after=2 on a new server already holding sequences 1 and 2 returns no chunks,
  // nextSequence=3 and truncated=false: the old cursor is valid only numerically.
  const result=transcript.replay(snapshot([],{epoch:'e2',nextSequence:3}),transcript.begin());
  assert.equal(result.reset,true);assert.equal(result.gap,true);assert.equal(transcript.cursor,0);
  transcript.replay(snapshot([chunk(1,'new one'),chunk(2,'new two')],{epoch:'e2'}),transcript.begin());
  assert.equal(transcript.text,'new onenew two');assert.equal(transcript.cursor,2);
});

test('local display retention loss remains sticky through replay and an unconfirmed new epoch',()=>{
  const transcript=new TerminalTranscript('a','p');
  for(let sequence=1;sequence<=16;sequence++)transcript.live(live(sequence,'x'.repeat(8192)));
  assert.equal(transcript.text.length,120000);assert.equal(transcript.truncated,true);
  transcript.live(live(17,'more'));assert.equal(transcript.truncated,true);
  transcript.replay(snapshot([],{nextSequence:18}),transcript.begin());assert.equal(transcript.truncated,true);
  transcript.live(live(1,'new epoch','e2'));assert.equal(transcript.truncated,true);
  transcript.replay(snapshot([chunk(1,'new epoch')],{epoch:'e2',truncated:true}),transcript.begin());assert.equal(transcript.text,'new epoch');
});

test('a delayed retired live epoch cannot replace confirmed current output',()=>{
  const transcript=new TerminalTranscript('a','p');transcript.live(live(1,'old'));
  transcript.replay(snapshot([chunk(1,'new')],{epoch:'e2',truncated:true}),transcript.begin());
  assert.equal(transcript.live(live(2,'delayed old')),null);
  assert.equal(transcript.text,'new');assert.equal(transcript.epoch,'e2');assert.equal(transcript.cursor,1);
});

test('unfamiliar live epochs require replay confirmation even after old identities age out',()=>{
  const transcript=new TerminalTranscript('a','p');transcript.live(live(1,'start'));
  for(let index=2;index<=40;index++)transcript.replay(snapshot([chunk(1,`current${index}`)],{epoch:`e${index}`,truncated:true}),transcript.begin());
  const token=transcript.begin(),result=transcript.live(live(2,'ancient old','e1'));
  assert.equal(result.gap,true);assert.equal(result.reset,false);assert.equal(transcript.text,'current40');
  assert.equal(transcript.replay(snapshot([],{epoch:'e40',nextSequence:2}),token),null,'observing an unfamiliar live epoch invalidates an older in-flight reply');
  transcript.replay(snapshot([],{epoch:'e40',nextSequence:2}),transcript.begin());
  assert.equal(transcript.text,'current40');assert.ok(transcript.retiredEpochs.size<=8);
});

test('foreign, malformed, sparse or excessive transcripts are rejected before mutation',()=>{
  const transcript=new TerminalTranscript('a','p');
  for(const bad of [snapshot([chunk(1)],{projectId:'foreign'}),snapshot([chunk(1)],{sessionId:'b'}),snapshot([chunk(2)]),snapshot([chunk(1)],{nextSequence:3}),snapshot([chunk(1)],{epoch:'../bad'}),snapshot([chunk(1,'\ud800')]),snapshot([chunk(1,'x'.repeat(8193))])])assert.throws(()=>transcript.replay(bad,transcript.begin()));
  assert.equal(transcript.cursor,0);assert.equal(transcript.text,'');assert.throws(()=>transcript.live({...live(1,'bad'),projectId:'other'}));
  for(let i=1;i<=24;i++)transcript.live(live(i,'🤖'.repeat(4096)));
  assert.ok(transcript.text.length<=120000);assert.ok(transcript.text.isWellFormed());
  for(let i=100;i<200;i++)transcript.live(live(i,'x'));assert.ok(transcript.pending.size<=32);
  assert.throws(()=>new TerminalTranscript('a','p').replay(snapshot(Array.from({length:40},(_,i)=>chunk(i+1,'x'.repeat(8192)))),{generation:0,cursor:0}));
});
