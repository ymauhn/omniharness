import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { spawn as nativeSpawn } from 'node:child_process';
import path from 'node:path';
import { ClassifierService } from '../classifier-service.mjs';

const repoRoot=path.resolve('.');
const candidates=[{source_id:'source:a',description:'Review code'}];
const selected=id=>({provider:'laya',source_id:id,reason:'selected',usage:{input_tokens:null,output_tokens:null},runnable:false});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fakeSpawn({delay=10,closeDelay=0,reply=frame=>frame.op==='warm'?{id:frame.id,ok:true,ready:true}:{id:frame.id,ok:true,selection:selected(frame.candidates[0].source_id)}}={}) {
  const calls=[],children=[];
  const spawn=(...args)=>{
    calls.push(args);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
    child.stdin=new Writable({write(chunk,encoding,callback){const frame=JSON.parse(chunk.toString());setTimeout(()=>{if(child.killed)return;const value=reply(frame,child);if(value!==undefined)child.stdout.write(typeof value==='string'?value:JSON.stringify(value)+'\n');},frame.op==='warm'?0:delay);callback();}});
    child.kill=()=>{child.killed=true;setTimeout(()=>{child.closed=true;child.emit('close',null,'SIGKILL');},closeDelay);return true;};children.push(child);return child;
  };
  return {spawn,calls,children};
}

test('disabled by default; explicit warm caches one process and keeps payloads off command line',async()=>{
  const fake=fakeSpawn();const service=new ClassifierService({repoRoot,spawn:fake.spawn});
  try {
    assert.equal(service.status().state,'off');assert.equal(fake.calls.length,0);
    await assert.rejects(service.select('private prompt',candidates),{code:'disabled'});
    await service.enable();assert.equal(service.status().state,'ready');
    const result=await service.select('private prompt',candidates);await service.select('next',candidates);
    assert.equal(result.runnable,false);assert.equal(result.usage.input_tokens,null);assert.equal(fake.calls.length,1);
    assert.equal(JSON.stringify(fake.calls[0]).includes('private prompt'),false);
    assert.equal(fake.calls[0][2].shell,false);assert.equal(fake.calls[0][2].env.HF_HUB_OFFLINE,'1');
  } finally {await service.close();}
});

test('one active plus two waiting requests is a hard queue bound',async()=>{
  const fake=fakeSpawn();const service=new ClassifierService({repoRoot,spawn:fake.spawn});
  try {
    await service.enable();const first=service.select('first',candidates),second=service.select('second',candidates),third=service.select('third',candidates);
    await assert.rejects(service.select('overflow',candidates),{code:'queue_full'});
    assert.equal(service.status().queued,2);await Promise.all([first,second,third]);
  } finally {await service.close();}
});

test('invalid inputs fail before starting or queueing work',async()=>{
  const fake=fakeSpawn();const service=new ClassifierService({repoRoot,spawn:fake.spawn});
  try {
    for(const [prompt,rows] of [['x'.repeat(2049),candidates],['\ud800',candidates],['x',[]],['x',[{...candidates[0],source_id:'none'}]],['x',[{...candidates[0],body:'private'}]],['x',[candidates[0],candidates[0]]],['x',[{...candidates[0],description:'x'.repeat(257)}]]])
      await assert.rejects(service.select(prompt,rows),{code:'invalid_input'});
    await assert.rejects(service.select('x',[{...candidates[0],source_id:'source:a\n'}]),{code:'invalid_input'});
    assert.equal(fake.calls.length,0);assert.equal(service.status().queued,0);
  } finally {await service.close();}
});

test('readable pipe errors fail only the owned worker instead of crashing the Lab',async()=>{
  for(const stream of ['stdout','stderr']) {
    const fake=fakeSpawn({delay:40}); const service=new ClassifierService({repoRoot,spawn:fake.spawn});
    try {
      await service.enable();
      const pending=service.select('private draft',candidates).then(()=>null,error=>error);
      assert.doesNotThrow(()=>fake.children[0][stream].emit('error',new Error('private pipe diagnostics')));
      assert.equal((await pending)?.code,'worker_failed');
      assert.equal(service.status().state,'unavailable');
      assert.equal(service.status().reason,'worker_failed');
    } finally { await service.close(); }
  }
});

test('typed replies reject invalid identity, authority, counts and protocol frames',async()=>{
  const mutations=[r=>{r.id++;},r=>{r.selection.source_id='outside';},r=>{r.selection.runnable=true;},r=>{r.selection.usage.input_tokens=-1;},r=>{r.selection.reason='provider_failed';},r=>{delete r.selection.usage;},()=> 'x'.repeat(65537),()=> '{invalid}\n'];
  for(const mutate of mutations){
    const fake=fakeSpawn({reply:frame=>{if(frame.op==='warm')return{id:frame.id,ok:true,ready:true};const reply={id:frame.id,ok:true,selection:selected('source:a')};return mutate(reply)||reply;}});
    const service=new ClassifierService({repoRoot,spawn:fake.spawn});
    try {await service.enable();await assert.rejects(service.select('private',candidates),{code:'protocol_error'});assert.equal(service.status().state,'unavailable');}
    finally {await service.close();}
  }
});

test('warm deadline and inference deadline kill owned process and reject queued requests',async()=>{
  const never=fakeSpawn({reply:()=>undefined});const cold=new ClassifierService({repoRoot,spawn:never.spawn,warmTimeoutMs:15});
  await assert.rejects(cold.enable(),{code:'timeout'});await cold.close();assert.equal(never.children[0].closed,true);
  const fake=fakeSpawn({reply:frame=>frame.op==='warm'?{id:frame.id,ok:true,ready:true}:undefined});
  const service=new ClassifierService({repoRoot,spawn:fake.spawn,inferenceTimeoutMs:15});
  try {
    await service.enable();const requests=['one','two','three'].map(prompt=>service.select(prompt,candidates));
    const outcomes=await Promise.allSettled(requests);assert.ok(outcomes.every(item=>item.status==='rejected'&&item.reason.code==='timeout'));
    assert.equal(service.status().queued,0);assert.equal(service.status().enabled,false);
  } finally {await service.close();}
  assert.equal(fake.children[0].closed,true);
});

test('disable interrupts warm-up and queued calls and waits for actual process close',async()=>{
  const fake=fakeSpawn({closeDelay:30,reply:()=>undefined});const service=new ClassifierService({repoRoot,spawn:fake.spawn});
  const enable=assert.rejects(service.enable(),{code:'disabled'});
  const queued=assert.rejects(service.select('queued private prompt',candidates),{code:'disabled'});
  let finished=false;const disable=service.disable().then(()=>{finished=true;});
  await tick();assert.equal(finished,false);assert.equal(service.status().state,'unavailable');
  await Promise.all([enable,queued,disable]);assert.equal(fake.children[0].closed,true);assert.equal(service.status().state,'off');
  await service.close();await assert.rejects(service.enable(),{code:'closed'});
});

test('failed cleanup is unavailable and cannot create a replacement process before close',async()=>{
  const fake=fakeSpawn();const service=new ClassifierService({repoRoot,spawn:fake.spawn,cleanupTimeoutMs:15});
  await service.enable();fake.children[0].kill=()=>false;
  try {
    await assert.rejects(service.disable(),{code:'cleanup_failed'});assert.equal(service.status().state,'unavailable');
    await assert.rejects(service.enable(),{code:'unavailable'});assert.equal(fake.calls.length,1);
  } finally {fake.children[0].emit('close',1);await service.close();}
});

test('missing runtime and unexpected process exit reject safely without raw diagnostics',async()=>{
  const service=new ClassifierService({repoRoot,spawn:()=>{throw Error('PRIVATE runtime path');}});
  await assert.rejects(service.enable(),error=>error.code==='worker_failed'&&!error.message.includes('PRIVATE'));await service.close();
  const fake=fakeSpawn({reply:frame=>frame.op==='warm'?{id:frame.id,ok:true,ready:true}:undefined});
  const running=new ClassifierService({repoRoot,spawn:fake.spawn});
  await running.enable();const outcome=assert.rejects(running.select('private prompt',candidates),{code:'worker_failed'});
  fake.children[0].emit('close',1);await outcome;assert.equal(running.status().state,'unavailable');await running.close();
});

test('old process output cannot resolve a new generation and queued input is snapshotted',async()=>{
  const fake=fakeSpawn();const service=new ClassifierService({repoRoot,spawn:fake.spawn});
  try {
    await service.enable();const first=fake.children[0];await service.disable();await service.enable();
    first.stdout.emit('data',Buffer.from('{"id":900,"ok":true,"ready":true}\n'));
    assert.equal(service.status().state,'ready');
    const active=service.select('one',candidates),copy=[{...candidates[0]}],queued=service.select('two',copy);
    copy[0].source_id='mutated';assert.equal((await queued).source_id,'source:a');await active;
  } finally {await service.close();}
});

test('idle unloading closes the child and requires fresh explicit enable',async()=>{
  const fake=fakeSpawn();const service=new ClassifierService({repoRoot,spawn:fake.spawn,idleTimeoutMs:15});
  await service.enable();await new Promise(resolve=>fake.children[0].once('close',resolve));
  assert.equal(service.status().state,'off');await assert.rejects(service.select('one',candidates),{code:'disabled'});await service.close();
});

const realProtocol = `
const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const value=JSON.parse(line);
  if(value.op==='warm')process.stdout.write(JSON.stringify({id:value.id,ok:true,ready:true})+'\\n');
  else if(value.prompt==='hang')setInterval(()=>{},1000);
  else process.stdout.write(JSON.stringify({id:value.id,ok:true,selection:{provider:'laya',source_id:value.candidates[0].source_id,reason:'selected',usage:{input_tokens:null,output_tokens:null},runnable:false}})+'\\n');
});`;

test('real child JSONL process returns selection and close waits for its OS exit',async()=>{
  let child;const spawn=(_python,_args,options)=>(child=nativeSpawn(process.execPath,['-e',realProtocol],options));
  const service=new ClassifierService({repoRoot,spawn});
  try {await service.enable();assert.equal((await service.select('select',candidates)).source_id,'source:a');}
  finally {await service.close();}
  assert.ok(child.exitCode!==null||child.signalCode!==null);assert.equal(service.status().state,'off');
});

test('real hung child is terminated at inference deadline and pending work rejects',async()=>{
  let child;const spawn=(_python,_args,options)=>(child=nativeSpawn(process.execPath,['-e',realProtocol],options));
  const service=new ClassifierService({repoRoot,spawn,inferenceTimeoutMs:25});
  try {
    await service.enable();const pending=Promise.allSettled([service.select('hang',candidates),service.select('queued',candidates)]);
    const results=await pending;assert.ok(results.every(item=>item.status==='rejected'&&item.reason.code==='timeout'));
  } finally {await service.close();}
  assert.ok(child.exitCode!==null||child.signalCode!==null);
});
