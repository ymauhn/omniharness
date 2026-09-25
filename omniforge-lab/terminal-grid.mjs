import { MAX_PANES, reconcilePaneSessions, selectPaneSession } from './pane-scope.mjs';

const KEY = 'omniforge-terminal-layout-v1';
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const integer = (value,min,max) => Number.isInteger(value) && value >= min && value <= max;
const defaults = () => ({panes:[null,null],columns:2,weights:[1,1,1,1],heights:Array(8).fill(560),focus:0});
function validate(value) {
  if (!value || !Array.isArray(value.panes) || !integer(value.panes.length,1,MAX_PANES) ||
      value.panes.some(id=>id!==null&&!identity(id)) || !integer(value.columns,1,4) ||
      !Array.isArray(value.weights) || value.weights.length!==4 || value.weights.some(n=>!integer(n,1,4)) ||
      !Array.isArray(value.heights) || value.heights.length!==8 || value.heights.some(n=>!integer(n,360,1000)) ||
      !integer(value.focus,0,value.panes.length-1)) throw Error('Layout inválido');
  return {panes:[...value.panes],columns:value.columns,weights:[...value.weights],heights:[...value.heights],focus:value.focus};
}

/** sessionStorage is tab-local, survives reload, and is copied independently by
 * browser duplication. App-created windows use noopener and seed only IDs. */
export class TerminalLayout {
  constructor(storage) {
    this.storage=storage;this.layouts=new Map();this.projectId=null;this.value=defaults();this.persistent=true;
    try {
      const raw=storage?.getItem(KEY);
      if(raw && raw.length<=32768) {
        const saved=JSON.parse(raw);
        if(saved?.schema===1 && Array.isArray(saved.layouts) && saved.layouts.length<=20)
          for(const [id,value] of saved.layouts) if(identity(id))this.layouts.set(id,validate(value));
        if(identity(saved.projectId))this.preferredProject=saved.projectId;
      }
    } catch {this.layouts.clear();}
  }
  save() {
    if(this.projectId)this.layouts.set(this.projectId,validate(this.value));
    while(this.layouts.size>20)this.layouts.delete(this.layouts.keys().next().value);
    try {this.storage?.setItem(KEY,JSON.stringify({schema:1,projectId:this.projectId,layouts:[...this.layouts]}));this.persistent=!!this.storage;}
    catch {this.persistent=false;}
  }
  switchProject(id,sessions,seed=null) {
    if(id!==null&&!identity(id))throw Error('Projeto inválido');
    if(id!==this.projectId) {
      this.save();this.projectId=id;this.value=validate(this.layouts.get(id)||defaults());
      if(identity(seed)&&sessions.some(s=>s.id===seed&&s.projectId===id)){this.value.panes=[seed];this.value.focus=0;}
    }
    this.value.panes=reconcilePaneSessions(sessions,id,this.value.panes);this.save();return this.value;
  }
  assign(index,id,sessions) {this.value.panes=selectPaneSession(sessions,this.projectId,this.value.panes,index,id);this.focus(index);}
  focus(index) {if(!integer(index,0,this.value.panes.length-1))throw Error('Painel inválido');this.value.focus=index;this.save();}
  add(sessions) {if(this.value.panes.length>=MAX_PANES)throw Error('Limite de oito painéis');this.value.panes.push(null);this.switchProject(this.projectId,sessions);this.focus(this.value.panes.length-1);}
  remove(index) {if(this.value.panes.length===1||!integer(index,0,this.value.panes.length-1))throw Error('Mantenha ao menos um painel');this.value.panes.splice(index,1);this.value.focus=Math.min(index,this.value.panes.length-1);this.save();}
  move(index,step) {const target=index+step;if(!integer(index,0,this.value.panes.length-1)||![-1,1].includes(step)||!integer(target,0,this.value.panes.length-1))return false;[this.value.panes[index],this.value.panes[target]]=[this.value.panes[target],this.value.panes[index]];this.focus(target);return true;}
  setColumns(value) {if(!integer(value,1,4))throw Error('Colunas inválidas');this.value.columns=value;this.save();}
  setWeight(index,value) {if(!integer(index,0,3)||!integer(value,1,4))throw Error('Largura inválida');this.value.weights[index]=value;this.save();}
  setHeight(index,value) {if(!integer(index,0,7)||!integer(value,360,1000))throw Error('Altura inválida');this.value.heights[index]=value;this.save();}
  get columns() {return Math.min(this.value.columns,this.value.panes.length);}
}

export function terminalWindowUrl(href,projectId,sessionId=null) {
  if(!identity(projectId)||sessionId!==null&&!identity(sessionId))throw Error('Seleção inválida');
  const current=new URL(href),url=new URL('/',current.origin);
  if(!['http:','https:'].includes(current.protocol))throw Error('Origem inválida');
  url.searchParams.set('project',projectId);if(sessionId)url.searchParams.set('session',sessionId);
  return url.href;
}

export function canControlTerminal({focused,index,focusIndex,sessionId,panes,projectId,sessions}) {
  return focused && index===focusIndex && panes[index]===sessionId &&
    sessions.some(session=>session.id===sessionId&&session.projectId===projectId&&session.status==='running');
}

export function splitTerminalInput(text) {
  if(typeof text!=='string'||text.length>65536||!text.isWellFormed())throw Error('Entrada de terminal excede o limite');
  const chunks=[];
  for(let start=0;start<text.length;){let end=Math.min(start+8192,text.length);if(/[\uD800-\uDBFF]/.test(text[end-1]||''))end--;chunks.push(text.slice(start,end));start=end;}
  return chunks;
}

export const terminalTextTail = value => {let start=Math.max(0,value.length-120000);if(/[\uDC00-\uDFFF]/.test(value[start]||''))start++;return value.slice(start);};
const frame = value => value && Number.isSafeInteger(value.sequence) && value.sequence>0 &&
  typeof value.text==='string' && value.text.length<=8192 && value.text.isWellFormed() &&
  ['stdout','stderr','error'].includes(value.stream);
const display = chunk => chunk.stream==='stdout'?chunk.text:`[${chunk.stream}] ${chunk.text}`;

/** At most 120k displayed code units + 32 out-of-order frames per selected session.
 * A replay token binds the epoch observation; later live epochs invalidate it. */
export class TerminalTranscript {
  constructor(sessionId,projectId) {this.sessionId=sessionId;this.projectId=projectId;this.epoch=null;this.cursor=0;this.text='';this.pending=new Map();this.generation=0;this.truncated=false;this.retiredEpochs=new Set();this.pendingEpoch=null;this.epochChanged=false;}
  begin() {return {generation:this.generation,cursor:this.cursor};}
  validScope(value) {return value?.sessionId===this.sessionId&&value.projectId===this.projectId&&identity(value.epoch);}
  reset(epoch) {
    if(this.epoch&&this.epoch!==epoch){this.retiredEpochs.add(this.epoch);this.epochChanged=true;}
    while(this.retiredEpochs.size>8)this.retiredEpochs.delete(this.retiredEpochs.values().next().value);
    this.epoch=epoch;this.cursor=0;this.text='';this.pending.clear();this.pendingEpoch=null;this.generation++;this.truncated=false;
  }
  drain(reset=false) {
    let append='';
    while(this.pending.has(this.cursor+1)){const chunk=this.pending.get(++this.cursor);this.pending.delete(this.cursor);append+=display(chunk);}
    const combined=this.text+append;
    this.text=terminalTextTail(combined);
    if(this.text.length<combined.length)this.truncated=true;
    while(this.pending.size>32)this.pending.delete(Math.max(...this.pending.keys()));
    return {reset,text:reset?this.text:append,gap:this.pending.size>0||this.pendingEpoch!==null};
  }
  live(value) {
    if(!this.validScope(value)||!frame(value))throw Error('Evento de terminal inválido');
    if(this.retiredEpochs.has(value.epoch))return null;
    // SSE may arrive late. Only an authenticated replay can confirm a different
    // epoch before replacing current output, including epochs aged out above.
    if(this.epoch!==null&&this.epoch!==value.epoch){
      if(this.pendingEpoch!==value.epoch){this.pendingEpoch=value.epoch;this.generation++;}
      return {reset:false,text:'',gap:true};
    }
    const reset=this.epoch!==value.epoch;
    if(reset)this.reset(value.epoch);
    if(value.sequence>this.cursor)this.pending.set(value.sequence,value);
    return this.drain(reset);
  }
  replay(value,token) {
    if(token.generation!==this.generation)return null;
    if(!this.validScope(value)||!Number.isSafeInteger(value.firstSequence)||!Number.isSafeInteger(value.nextSequence)||
        value.firstSequence<1||value.nextSequence<value.firstSequence||typeof value.truncated!=='boolean'||
        !Array.isArray(value.chunks)||value.chunks.length>512||value.chunks.some(c=>!frame(c)||
          c.sessionId!==undefined&&c.sessionId!==this.sessionId||c.projectId!==undefined&&c.projectId!==this.projectId||
          c.epoch!==undefined&&c.epoch!==value.epoch))throw Error('Histórico de terminal inválido');
    if(this.retiredEpochs.has(value.epoch))return null;
    let bytes=0,expected=value.truncated?value.firstSequence:token.cursor+1;
    for(const chunk of value.chunks){bytes+=new TextEncoder().encode(chunk.text).length;if(chunk.sequence!==expected++||chunk.sequence<value.firstSequence||chunk.sequence>=value.nextSequence)throw Error('Sequência inválida');}
    if(expected!==value.nextSequence)throw Error('Histórico incompleto');
    if(bytes>262144)throw Error('Histórico excede o limite');
    let reset=this.epoch!==value.epoch;
    if(reset)this.reset(value.epoch);
    this.pendingEpoch=null;
    if(value.truncated&&(this.cursor<value.firstSequence-1||token.cursor>=value.nextSequence)){
      this.cursor=value.firstSequence-1;this.text='';reset=true;this.truncated=true;
      for(const seq of this.pending.keys())if(seq<=this.cursor)this.pending.delete(seq);
    }
    for(const chunk of value.chunks)if(chunk.sequence>this.cursor)this.pending.set(chunk.sequence,chunk);
    const result=this.drain(reset);
    // A new epoch can have exactly the old final sequence: its after=N reply
    // is empty, although resetting the epoch just discarded the local cursor.
    result.gap ||= this.cursor<value.nextSequence-1;
    return result;
  }
}

export function mountGridControls({root,layout,getSessions,getProjectId,changed,openWindow}) {
  const add=(parent,tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;parent.append(el);return el;};
  const button=(label,action)=>{const el=add(root,'button',label);el.type='button';el.className='secondary';el.addEventListener('click',action);return el;};
  const more=button('Adicionar painel',()=>{layout.add(getSessions());changed();});
  const clone=button('Nova janela',()=>openWindow(null));
  const label=add(root,'label','Colunas '),columns=add(label,'select');columns.setAttribute('aria-label','Colunas da grade');
  for(let n=1;n<=4;n++){const option=add(columns,'option',String(n));option.value=String(n);}
  columns.addEventListener('change',()=>{layout.setColumns(Number(columns.value));changed();});
  const details=add(root,'details');add(details,'summary','Dimensionar grade');const sizes=add(details,'div');sizes.className='grid-sizes';
  const status=add(root,'p');status.className='microcopy';status.setAttribute('role','status');
  function slider(text,value,min,max,step,onValue) {
    const field=add(sizes,'label',text),input=add(field,'input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;input.setAttribute('aria-label',text);
    const output=add(field,'output',String(value));input.addEventListener('input',()=>{onValue(Number(input.value));output.textContent=input.value;changed(false);});
  }
  return {render(){more.disabled=!getProjectId()||layout.value.panes.length>=MAX_PANES;clone.disabled=!getProjectId();columns.value=String(layout.value.columns);
    sizes.replaceChildren();for(let i=0;i<layout.columns;i++)slider(`Largura relativa da coluna ${i+1}`,layout.value.weights[i],1,4,1,value=>layout.setWeight(i,value));
    for(let i=0;i<Math.ceil(layout.value.panes.length/layout.columns);i++)slider(`Altura da linha ${i+1} (px)`,layout.value.heights[i],360,1000,20,value=>layout.setHeight(i,value));
    status.textContent=`${layout.value.panes.length}/${MAX_PANES} painéis · layout desta janela e projeto${layout.persistent?'':' · armazenamento indisponível'}. Fechar painel mantém a sessão. Só a janela e o painel em foco enviam entrada e tamanho.`;
  }};
}
