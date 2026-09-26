import { spawn as nativeSpawn } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import path from 'node:path';

const REVISION = 'e4e9ddf21a7b1903b7acffd8814ad4307bf63a67';
const MAX_INPUT = 16384, MAX_OUTPUT = 65536;
const REASONS = new Set(['selected','none','below_threshold','selected_fit_failed']);
const keysAre = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const problem = code => Object.assign(new Error(`Local classifier: ${code}`),{code});
const deferred = () => { let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject}; };
const validText = (value,max) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value,'utf8') <= max && value.isWellFormed();

function input(prompt,candidates) {
  if (!validText(prompt,2048) || !Array.isArray(candidates) || !candidates.length || candidates.length > 8) throw problem('invalid_input');
  const seen = new Set();
  for (const candidate of candidates) {
    if (!keysAre(candidate,['source_id','description']) || typeof candidate.source_id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_:/.@+\-]{0,159}$/.test(candidate.source_id) || candidate.source_id.trim() !== candidate.source_id || candidate.source_id === 'none' || seen.has(candidate.source_id) ||
        !validText(candidate.description,256)) throw problem('invalid_input');
    seen.add(candidate.source_id);
  }
  return {prompt,candidates:candidates.map(({source_id,description})=>({source_id,description}))};
}
function selection(value,candidates) {
  if (!keysAre(value,['provider','source_id','reason','usage','runnable','probability']) || value.provider !== 'laya' || value.runnable !== false ||
      (value.probability !== null && !(typeof value.probability === 'number' && value.probability >= 0 && value.probability <= 1)) ||
      !REASONS.has(value.reason) || !keysAre(value.usage,['input_tokens','output_tokens']) ||
      Object.values(value.usage).some(count=>count!==null&&(!Number.isSafeInteger(count)||count<0)) ||
      (value.reason === 'selected' ? !candidates.some(candidate=>candidate.source_id===value.source_id) : value.source_id !== null)) throw problem('protocol_error');
  return {...value,usage:{...value.usage},runnable:false};
}
function duration(value,max) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw problem('invalid_config');
  return value;
}
function environment() {
  const result = {};
  // Do not inherit API keys, host tokens, proxy settings, PYTHONPATH, or HOME.
  for (const name of ['SystemRoot','WINDIR','PATH','TEMP','TMP','LANG']) if(process.env[name])result[name]=process.env[name];
  return {...result,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',USE_TF:'0',
    TOKENIZERS_PARALLELISM:'false',OMP_NUM_THREADS:'4',MKL_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4',
    PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
}

/** Explicit local activation; one active request plus two waiting requests.
 * Methods reject only stable generic error codes. close/disable resolve only
 * after actual child close; cleanup failure is unavailable, never proven stopped.
 */
export class ClassifierService {
  constructor({repoRoot,python,checkpoint,manifest,spawn=nativeSpawn,warmTimeoutMs=60000,inferenceTimeoutMs=5000,idleTimeoutMs=120000,cleanupTimeoutMs=2000}={}) {
    if(typeof repoRoot!=='string'||!path.isAbsolute(repoRoot)||typeof spawn!=='function')throw problem('invalid_config');
    this.root=repoRoot;this.python=python||path.join(repoRoot,'.omniharness/runtime/laya-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    this.checkpoint=checkpoint||path.join(repoRoot,'.omniharness/runtime/laya-multilingual',REVISION);
    this.manifest=manifest||path.join(repoRoot,'docs/experiments/laya-artifacts-2026-09-25.json');
    if([this.python,this.checkpoint,this.manifest].some(value=>typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')))throw problem('invalid_config');
    this.spawn=spawn;this.warmTimeout=duration(warmTimeoutMs,60000);this.inferenceTimeout=duration(inferenceTimeoutMs,5000);
    this.idleTimeout=duration(idleTimeoutMs,120000);this.cleanupTimeout=duration(cleanupTimeoutMs,10000);
    this.worker=null;this.active=null;this.queue=[];this.enabled=false;this.closed=false;
    this.state='off';this.reason='disabled';this.nextId=1;this.generation=0;this.idleTimer=null;
  }
  status() { return {provider:'laya',state:this.state,enabled:this.enabled,active:!!this.active,queued:this.queue.length,reason:this.reason}; }
  enable() {
    if(this.closed)return Promise.reject(problem('closed'));
    if(this.worker) {
      if(!this.enabled||this.worker.stopping)return Promise.reject(problem('unavailable'));
      return this.worker.warmPromise||Promise.resolve(this.status());
    }
    this.enabled=true;this.state='warming';this.reason=null;
    let child;
    try { child=this.spawn(this.python,['-I','-u',path.join(this.root,'harness/classifier_worker.py'),'--checkpoint',this.checkpoint,'--manifest',this.manifest],
      {cwd:this.root,env:environment(),windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']}); }
    catch {this.enabled=false;this.state='unavailable';this.reason='worker_failed';return Promise.reject(problem('worker_failed'));}
    const closed=deferred();
    const worker={child,generation:++this.generation,buffer:Buffer.alloc(0),closed,stopping:false,stopPromise:null,afterClose:'unavailable',warmPromise:null};
    this.worker=worker;
    child.on('error',()=>{if(this.worker===worker)this.fail('worker_failed');});
    child.stdin.on('error',()=>{if(this.worker===worker&&!worker.stopping)this.fail('worker_failed');});
    child.stdout.on('data',chunk=>this.receive(worker,chunk));
    child.stderr.on('data',()=>{}); // Diagnostics are consumed, never copied to status/logs.
    for(const stream of [child.stdout,child.stderr]) stream.on('error',()=>{
      if(this.worker===worker&&!worker.stopping)this.fail('worker_failed');
    });
    child.on('close',()=>{
      closed.resolve();
      if(this.worker!==worker)return;
      clearTimeout(this.idleTimer);this.worker=null;
      if(!worker.stopping){this.rejectAll('worker_failed');this.reason='worker_failed';}
      this.enabled=false;this.state=worker.stopping?worker.afterClose:'unavailable';
      if(this.state==='off')this.reason=this.closed?'closed':'disabled';
    });
    const job={...deferred(),id:this.nextId++,op:'warm'};
    worker.warmPromise=job.promise.then(()=>this.status());
    worker.warmPromise.then(()=>{worker.warmPromise=null;},()=>{worker.warmPromise=null;});
    this.start(job);
    return worker.warmPromise;
  }
  select(prompt,candidates) {
    if(this.closed)return Promise.reject(problem('closed'));
    let request;try{request=input(prompt,candidates);}catch(error){return Promise.reject(error);}
    if(!this.enabled||!this.worker||this.worker.stopping)return Promise.reject(problem('disabled'));
    if(this.active&&this.queue.length>=2)return Promise.reject(problem('queue_full'));
    clearTimeout(this.idleTimer);
    const job={...deferred(),...request,id:this.nextId++,op:'select'};
    if(this.active)this.queue.push(job);else this.start(job);
    return job.promise;
  }
  start(job) {
    const worker=this.worker;if(!worker||worker.stopping){job.reject(problem('unavailable'));return;}
    this.active=job;this.state=job.op==='warm'?'warming':'busy';
    const frame=job.op==='warm'?{id:job.id,op:'warm'}:{id:job.id,op:'select',prompt:job.prompt,candidates:job.candidates};
    const text=JSON.stringify(frame)+'\n';
    if(Buffer.byteLength(text)>MAX_INPUT){this.fail('invalid_input');return;}
    job.timer=setTimeout(()=>{if(this.worker===worker&&this.active===job)this.fail('timeout');},job.op==='warm'?this.warmTimeout:this.inferenceTimeout);
    try {worker.child.stdin.write(text,'utf8',error=>{if(error&&this.worker===worker&&!worker.stopping)this.fail('worker_failed');});}
    catch {this.fail('worker_failed');}
  }
  receive(worker,chunk) {
    if(this.worker!==worker||worker.generation!==this.generation||worker.stopping)return;
    if(!Buffer.isBuffer(chunk))chunk=Buffer.from(chunk);
    if(worker.buffer.length+chunk.length>MAX_OUTPUT){this.fail('protocol_error');return;}
    worker.buffer=Buffer.concat([worker.buffer,chunk]);
    let newline;
    while((newline=worker.buffer.indexOf(10))>=0) {
      const line=worker.buffer.subarray(0,newline);worker.buffer=worker.buffer.subarray(newline+1);
      const job=this.active;
      try {
        if(!job||!isUtf8(line))throw problem('protocol_error');
        const reply=JSON.parse(line.toString('utf8'));
        if(reply?.id!==job.id)throw problem('protocol_error');
        if(reply.ok!==true)throw problem('worker_failed');
        let result;
        if(job.op==='warm'){if(!keysAre(reply,['id','ok','ready'])||reply.ready!==true)throw problem('protocol_error');}
        else {if(!keysAre(reply,['id','ok','selection']))throw problem('protocol_error');result=selection(reply.selection,job.candidates);}
        clearTimeout(job.timer);this.active=null;this.state='ready';job.resolve(result);
        if(this.queue.length)this.start(this.queue.shift());else this.armIdle();
      } catch(error) {this.fail(error.code==='worker_failed'?'worker_failed':'protocol_error');return;}
      if(this.worker!==worker||worker.stopping)return;
    }
  }
  armIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer=setTimeout(()=>{this.disable().catch(()=>{});},this.idleTimeout);this.idleTimer.unref?.();
  }
  rejectAll(code) {
    if(this.active){clearTimeout(this.active.timer);this.active.reject(problem(code));this.active=null;}
    for(const job of this.queue)job.reject(problem(code));this.queue=[];
  }
  fail(code) {
    this.enabled=false;this.state='unavailable';this.reason=code;this.rejectAll(code);
    this.stop('unavailable').catch(()=>{});
  }
  stop(afterClose) {
    clearTimeout(this.idleTimer);
    const worker=this.worker;if(!worker)return Promise.resolve();
    worker.afterClose=afterClose;
    if(worker.stopPromise)return worker.stopPromise;
    worker.stopping=true;
    worker.stopPromise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(this.worker===worker){this.state='unavailable';this.reason='cleanup_failed';}reject(problem('cleanup_failed'));},this.cleanupTimeout);
      worker.closed.promise.then(()=>{clearTimeout(timer);resolve();});
      try{worker.child.kill('SIGKILL');}catch{/* Await actual close or report failed cleanup. */}
    });
    return worker.stopPromise;
  }
  async disable() {
    this.enabled=false;this.rejectAll('disabled');
    if(this.worker){this.state='unavailable';this.reason='disabled';await this.stop('off');}
    else{this.state='off';this.reason=this.closed?'closed':'disabled';}
    return this.status();
  }
  async close() {this.closed=true;return this.disable();}
}
