// Original Companion Studio robot and draft safety, adapted for the local composer.
// Local classifier is explicit opt-in; no skill execution or persistent draft storage.
import { mountClassifierControls, utf8Excerpt } from './copilot-provider.mjs';
const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
const boundary = (text, index) => Number.isInteger(index) && index >= 0 && index <= text.length &&
  !(index > 0 && /[\uD800-\uDBFF]/.test(text[index - 1]) && /[\uDC00-\uDFFF]/.test(text[index] || ''));
const clipped = (text, limit) => String(text || '').slice(0, boundary(String(text || ''), limit) ? limit : Math.max(0, limit - 1));

export class DraftSession {
  constructor(projectId = null, text = '') {
    Object.assign(this, { projectId, text, revision:0, generation:0, mode:'discreet', pending:null,
      receipt:null, lastSuggestedRevision:-1, lastFollowupRevision:-1, cooldownUntil:0 });
  }
  update(text, projectId) {
    if (text === this.text && projectId === this.projectId) return false;
    this.text = text; this.projectId = projectId; this.revision++; this.cancel(); this.receipt = null;
    return true;
  }
  cancel() { this.generation++; this.pending = null; }
  setMode(mode) { this.mode = ['off','discreet','active'].includes(mode) ? mode : 'discreet'; this.cancel(); }
  capture(start = 0, end = this.text.length) {
    if (!boundary(this.text, start) || !boundary(this.text, end) || start > end) throw Error('Invalid selection');
    return Object.freeze({ projectId:this.projectId, draft:this.text, revision:this.revision, generation:++this.generation, start, end });
  }
  current(item) {
    return !!item && !!this.projectId && this.mode !== 'off' && item.projectId === this.projectId && item.draft === this.text &&
      item.revision === this.revision && item.generation === this.generation;
  }
  propose(captured, replacement) {
    if (!this.current(captured) || typeof replacement !== 'string' || captured.draft.length - (captured.end - captured.start) + replacement.length > 4000) return false;
    this.pending = Object.freeze({ ...captured, replacement }); return true;
  }
  apply() {
    const item = this.pending;
    if (!this.current(item)) return false;
    const before = this.text, after = before.slice(0,item.start) + item.replacement + before.slice(item.end);
    this.update(after, this.projectId); this.cancel();
    this.receipt = { before, after, projectId:this.projectId, revision:this.revision };
    this.lastSuggestedRevision = this.revision;
    return true;
  }
  undo() {
    const item = this.receipt;
    if (!item || item.after !== this.text || item.projectId !== this.projectId || item.revision !== this.revision) return false;
    this.update(item.before, this.projectId); this.receipt = null; return true;
  }
  dismiss(now) {
    this.cancel(); this.cooldownUntil = now + 12000; this.lastSuggestedRevision = this.revision;
    const ask = this.lastFollowupRevision !== this.revision;
    this.lastFollowupRevision = this.revision; return ask;
  }
  canPause({visible,focused,selected,now}) {
    return !!this.projectId && !!this.text.trim() && this.mode !== 'off' && visible && focused && !selected &&
      !this.pending && now >= this.cooldownUntil && this.revision !== this.lastSuggestedRevision;
  }
}

export function contextExcerpt(notes, projectId, limit = 1000) {
  if (!projectId) return '';
  const bound = Math.max(0, Math.min(1000, Number.isInteger(limit) ? limit : 1000));
  return clipped((Array.isArray(notes) ? notes : []).filter(note => !note.archivedAt &&
    (note.scope === 'global' || note.scope === 'project' && note.projectId === projectId))
    .sort((a,b) => (b.mutationSequence || 0) - (a.mutationSequence || 0)).slice(0,3)
    .map(note => `Fonte: ${clipped(note.source || 'não informada',120)} (${note.scope})\n${clipped(note.text,400)}`).join('\n\n'), bound);
}

export function localTemplate(kind, text, context = '') {
  const additions = {
    clarify:'Objetivo: [resultado desejado]\nEntrega: [formato e critério de aceite]\nLimites: [escopo e restrições]',
    research:'Pesquisar: [questão principal]\nTermos e sinônimos: [preencher]\nEvidências: [fontes primárias e data]\nComparar: [alternativas e limitações]',
    context:context ? `Contexto citado — confirme a relevância:\n${context}` : 'Contexto: [projeto, arquivos relevantes e decisões anteriores]',
  };
  return `${text}\n\n${additions[kind] || additions.clarify}`;
}

export function catalogResponse(result) {
  if (!result || typeof result.snapshot_id !== 'string' || !result.coverage ||
      typeof (result.coverage.complete_for_discovery_scope ?? result.coverage.complete) !== 'boolean' ||
      !Array.isArray(result.issues) || !Array.isArray(result.rows) || result.rows.length > 50 ||
      !Number.isSafeInteger(result.total) || result.total < result.rows.length || result.rows.some(row =>
        !row || typeof row.skill_id !== 'string' || typeof row.name !== 'string')) throw Error('Resposta do catálogo inválida (catalog schema).');
  return result;
}
export function candidateSkills(rows) {
  return (Array.isArray(rows) ? rows : []).filter(row => row.ring === 'installed' && (row.availability?.status || row.availability) === 'installed')
    .slice(0,3).map(row => ({...row,runnable:false}));
}

const node = (tag, className = '', text) => {
  const element = document.createElement(tag); element.className = className;
  if (text !== undefined) element.textContent = String(text); return element;
};
function add(parent, tag, className, text) { const child = node(tag,className,text); parent.append(child); return child; }
function button(parent, label, action, className = 'secondary') {
  const element = add(parent,'button',className,label); element.type = 'button'; element.addEventListener('click',action); return element;
}
function select(parent, label, choices) {
  const field = add(parent,'label','cp-field',label), element = add(field,'select');
  for (const [value,text] of choices) { const option = add(element,'option','',text); option.value = value; }
  return element;
}
function field(parent, label, value) {
  const wrapper = add(parent,'div','catalog-field'); add(wrapper,'dt','',label);
  add(wrapper,'dd','',Array.isArray(value) ? (value.length ? value.join(' · ') : 'Não informado') : value || 'Não informado');
}
function coverageText(result) {
  const complete = result.coverage.complete_for_discovery_scope ?? result.coverage.complete;
  return `${complete ? 'Descoberta concluída no escopo declarado' : 'Cobertura incompleta'} · ${result.coverage.curated_rows ?? '?'} metadados curados · ${result.issues.length} avisos/erros · snapshot ${result.snapshot_id.slice(0,12)}`;
}
function skillSummary(parent, row) {
  add(parent,'h3','',row.name); add(parent,'p','',row.metadata?.functional_description || row.description || 'Descrição não informada.');
  const badges = add(parent,'div','cp-tags');
  for (const text of [row.ring || 'Origem desconhecida',strings(row.hosts).join(' / ') || 'Host desconhecido',`Curadoria: ${row.curation || 'desconhecida'}`]) add(badges,'span','scope-badge',text);
  add(parent,'code','',row.source_key || row.source || 'Fonte não informada');
  add(parent,'p','microcopy',`Disponibilidade: ${row.availability?.status || row.availability || 'desconhecida'} · autoridade não concedida · consulta apenas`);
}

export function mountCatalog({root,search,list,count,api,fallback,getProjectId=()=>null}) {
  let sequence = 0, detailSequence = 0, offset = 0, lastKey = null, timer, observedProjectId = getProjectId();
  const controls = add(root,'div','toolbar catalog-controls');
  const ring = select(controls,'Anel',[['installed','Instaladas'],['catalog','Catálogo'],['remote','Remotas'],['all','Todos os anéis']]);
  const host = select(controls,'Host',[['codex','Codex'],['claude','Claude'],['hermes','Hermes']]);
  const refresh = button(controls,'Atualizar índice',refreshIndex);
  const status = add(root,'p','catalog-status','Aguardando consulta ao índice local.'); status.setAttribute('role','status');
  const issues = add(root,'details','catalog-issues'); add(issues,'summary','','Detalhes da cobertura'); const issueList = add(issues,'ul'); issues.hidden = true;
  root.append(list);
  const paging = add(root,'div','catalog-paging');
  const previous = button(paging,'← Anterior',()=>{offset=Math.max(0,offset-50);load(true);});
  const page = add(paging,'span','microcopy');
  const next = button(paging,'Próxima →',()=>{offset+=50;load(true);}); previous.disabled = true; next.disabled = true;
  const detail = add(root,'section','card catalog-detail'); detail.hidden = true; detail.setAttribute('aria-label','Metadados da skill');

  function closeDetail() { detailSequence++; detail.hidden = true; detail.replaceChildren(); }
  function sync() {
    if (observedProjectId === getProjectId()) return;
    observedProjectId = getProjectId(); sequence++; lastKey = null; closeDetail();
  }
  function renderRows(rows, incomplete = false) {
    list.replaceChildren();
    if (!rows.length) add(list,'p','empty','Nenhuma correspondência. Tente o nome exato ou um sinônimo PT/EN. A busca pode se abster.');
    for (const row of rows) {
      const card = add(list,'article','card skill-card'); skillSummary(card,row);
      if (incomplete) add(card,'p','microcopy','Fallback do repositório; inventário e metadados completos indisponíveis.');
      else button(card,'Metadados e exemplos',()=>openDetail(row.skill_id,card));
    }
  }
  async function openDetail(id, card) {
    const request = ++detailSequence; detail.hidden = false; detail.replaceChildren();
    const heading = add(detail,'h2','','Consultando metadados…'); heading.tabIndex = -1; heading.focus();
    const content = add(detail,'div','catalog-detail-content');
    try {
      const result = await api(`/api/skills/${encodeURIComponent(id)}`);
      if (request !== detailSequence) return;
      if (!result.row || result.row.skill_id !== id || typeof result.snapshot_id !== 'string') throw Error('Identidade da skill não confirmada.');
      const row = result.row, meta = row.metadata || {}; heading.textContent = 'Metadados e exemplos'; skillSummary(content,row);
      const info = add(content,'dl','catalog-metadata');
      for (const [label,value] of [['Identidade',row.skill_id],['Hash da fonte',row.source_sha256 || row.source_hash],['Snapshot',result.snapshot_id],['Fonte local',row.source_path],['Referência pública',row.source_url],['Versão',row.version],['Licença',row.license],['Compatibilidade declarada',row.compatibility],['Taxonomia',meta.taxonomy],['Pilares',meta.pillars],['Intenções',meta.intents],['Aliases PT',meta.aliases?.pt],['Aliases EN',meta.aliases?.en],['Casos de uso PT',meta.use_cases?.pt],['Casos de uso EN',meta.use_cases?.en],['Entradas',meta.inputs],['Saídas',meta.outputs],['Quando usar',meta.when_to_use],['Quando evitar',meta.when_to_avoid],['Pré-requisitos',meta.prerequisites],['Revisado em',meta.reviewed_at],['Campos ausentes',row.metadata_gaps]]) field(info,label,value);
      add(content,'p','microcopy','Os campos ausentes não foram inferidos. Relevância, disponibilidade e autorização são decisões distintas. A consulta não carrega o corpo nem executa esta skill.');
    } catch (error) { if(request!==detailSequence)return; heading.textContent = 'Consulta indisponível'; content.replaceChildren(); add(content,'p','catalog-error',`Metadados indisponíveis: ${error.message}`); }
    button(detail,'Fechar detalhes',()=>{closeDetail();card.querySelector('button')?.focus();});
  }
  function queryPath() {
    return `/api/skills?${new URLSearchParams({q:search.value.trim(),host:host.value,ring:ring.value,limit:'50',offset:String(offset)})}`;
  }
  function showResult(result) {
    renderRows(result.rows); count.textContent = `${result.total} skills`; status.textContent = coverageText(result); status.className = 'catalog-status';
    page.textContent = result.total ? `${offset+1}–${offset+result.rows.length} de ${result.total}` : '0 resultados';
    previous.disabled = offset === 0; next.disabled = offset + result.rows.length >= result.total;
    issueList.replaceChildren(); for (const issue of result.issues.slice(0,20)) add(issueList,'li','',`${issue.severity || 'aviso'} · ${issue.code || ''} · ${issue.detail || issue.message || issue.source || 'Sem detalhe'}`);
    if (result.issues.length > 20) add(issueList,'li','',`${result.issues.length-20} avisos adicionais no snapshot.`);
    issues.hidden = !result.issues.length;
  }
  async function refreshIndex() {
    if (refresh.disabled) return;
    clearTimeout(timer); offset = 0; const request = ++sequence, projectId = getProjectId(), path = queryPath();
    const isCurrent = () => request === sequence && projectId === getProjectId() && path === queryPath();
    closeDetail(); refresh.disabled = true; previous.disabled = true; next.disabled = true;
    status.className = 'catalog-status'; status.textContent = 'Reconstruindo índice local… Os resultados anteriores podem estar desatualizados.';
    try {
      const result = await refreshCatalogIndex(api,{path,isCurrent}); if (!result) return;
      lastKey = JSON.stringify([search.value.trim(),host.value,ring.value,offset,getProjectId()]);
      showResult(result); status.textContent = `Índice reconstruído · ${coverageText(result)}`;
    } catch (error) {
      if (!isCurrent()) return;
      status.className = 'catalog-status catalog-error'; status.textContent = `Não foi possível atualizar o índice: ${error.message}. Resultados anteriores não foram confirmados.`;
    } finally { refresh.disabled = false; }
  }
  async function load(force = false) {
    sync();
    const query = search.value.trim(), projectId = getProjectId(), key = JSON.stringify([query,host.value,ring.value,offset,projectId]);
    if (!force && key === lastKey) return; lastKey = key;
    const request = ++sequence; closeDetail(); status.textContent = 'Consultando índice local…';
    previous.disabled = true; next.disabled = true; issues.hidden = true;
    try {
      const result = catalogResponse(await api(queryPath())); if (request !== sequence || projectId !== getProjectId()) return;
      showResult(result);
    } catch (error) {
      if (request !== sequence || projectId !== getProjectId()) return;
      status.className = 'catalog-status catalog-error'; status.textContent = `Catálogo indisponível: ${error.message}. Cobertura incompleta; exibindo fallback do repositório.`;
      const queryLower = query.toLocaleLowerCase('pt-BR');
      const rows = (fallback() || []).filter(row => `${row.name || ''} ${row.description || ''}`.toLocaleLowerCase('pt-BR').includes(queryLower));
      renderRows(rows,true); count.textContent = `${rows.length} no fallback`; page.textContent = 'Fallback parcial; filtros de host/anel não verificados.';
    }
  }
  function changed() { offset = 0; sequence++; closeDetail(); clearTimeout(timer); timer = setTimeout(()=>load(true),220); }
  search.addEventListener('input',changed); ring.addEventListener('change',changed); host.addEventListener('change',changed);
  return { sync, load, search:()=>{offset=0;load(true);} };
}

export function mountCopilot({root,draft,api,getProjectId,getNotes,openSkills}) {
  const model = new DraftSession(getProjectId(),draft.value);
  let selected = null, pauseTimer, animationTimer, requestBusy = false, visible = true, composing = false, skin = 'modern';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  root.classList.add('prompt-copilot'); root.setAttribute('aria-label','Prompt Copilot');
  const head = add(root,'div','cp-head'), mascot = add(head,'div','cp-mascot'); mascot.setAttribute('aria-hidden','true');
  const heading = add(head,'div','cp-heading'); add(heading,'strong','','Prompt Copilot');
  const state = add(heading,'small','','Aqui quando precisar.');
  const settings = add(root,'details','cp-settings'); add(settings,'summary','','Preferências do companheiro');
  const settingFields = add(settings,'div','cp-preferences');
  const mode = select(settingFields,'Assistência',[['discreet','Discreto · após pausa'],['active','Ativo · pausa curta'],['off','Off · desligado']]);
  const skinChoice = select(settingFields,'Visual',[['modern','Robô moderno'],['pixel','Robô pixel']]);
  const motion = select(settingFields,'Movimento',[['system','Seguir sistema'],['off','Sem animações']]);
  add(settings,'p','microcopy','Preferências por projeto neste navegador. Rascunhos não são salvos aqui.');
  const provider = mountClassifierControls({root:settings,api,getProjectId,onChange:()=>{
    model.cancel(); requestBusy=false; clearTimeout(pauseTimer); hidePanel(); savePreferences(); updateActions();
  }});
  add(root,'p','cp-provider','Templates locais · metadados + Laya opcional · sem envio remoto');
  const actions = add(root,'div','cp-actions'); actions.setAttribute('role','group'); actions.setAttribute('aria-label','Ações no prompt');
  const scope = add(root,'p','microcopy','Selecione um trecho no pedido, ou peça uma sugestão.');
  const panel = add(root,'div','cp-panel'); panel.hidden = true;
  const followup = add(root,'div','cp-followup'); followup.hidden = true;
  const live = add(root,'p','visually-hidden'); live.setAttribute('role','status'); live.setAttribute('aria-live','polite'); live.setAttribute('aria-atomic','true');
  const undoButton = button(root,'Desfazer última aplicação',()=>{
    sync(); if (!model.undo()) return announce('O rascunho mudou; não há alteração segura para desfazer.');
    draft.value = model.text; hidePanel(); draft.focus(); updateUndo(); announce('Alteração desfeita.');
  },'ghost cp-undo'); undoButton.hidden = true;

  function announce(text) { live.textContent = text; }
  function isVisible() { return visible && !document.hidden && root.getClientRects().length > 0; }
  function expression(value, text, animate = true) {
    root.dataset.state = model.mode === 'off' ? 'muted' : value;
    state.textContent = model.mode === 'off' ? 'Em silêncio · assistência desligada' : text;
    clearTimeout(animationTimer); mascot.classList.remove('cp-pop');
    if (animate && model.mode !== 'off' && isVisible() && !reduced.matches && motion.value !== 'off') {
      mascot.classList.add('cp-pop'); animationTimer = setTimeout(()=>mascot.classList.remove('cp-pop'),700);
    }
  }
  function updateUndo() { undoButton.hidden = !model.receipt; }
  function hidePanel() {
    if (panel.contains(document.activeElement) || followup.contains(document.activeElement)) draft.focus();
    panel.hidden = true; panel.replaceChildren(); followup.hidden = true; followup.replaceChildren();
  }
  function renderRobot() { mascot.innerHTML = robot(skin,'copilot'); } // Static authored SVG only.
  function readPreferences() {
    let saved; try { saved = JSON.parse(localStorage.getItem(`omniforge-copilot:${model.projectId}`) || '{}'); } catch { saved = {}; }
    mode.value = ['off','discreet','active'].includes(saved?.mode) ? saved.mode : 'discreet';
    skin = saved?.skin === 'pixel' ? 'pixel' : 'modern'; skinChoice.value = skin;
    motion.value = saved?.motion === 'off' ? 'off' : 'system'; model.setMode(mode.value); renderRobot();
    provider.setMode(saved?.provider);
    expression('resting','Aqui quando precisar.',false); updateActions();
  }
  function savePreferences() {
    if (model.projectId) try { localStorage.setItem(`omniforge-copilot:${model.projectId}`,JSON.stringify({mode:mode.value,skin,motion:motion.value,provider:provider.mode()})); } catch { /* Storage unavailable: current page still works. */ }
  }
  function sync() {
    const changedProject = model.projectId !== getProjectId();
    if (model.update(draft.value,getProjectId())) {
      clearTimeout(pauseTimer); selected = null; requestBusy = false; hidePanel(); updateUndo();
      if (changedProject) readPreferences(); else expression('resting','Rascunho atualizado.',false);
    }
    updateActions();
  }
  function updateActions() {
    for (const element of actions.querySelectorAll('button')) element.disabled = model.mode === 'off' || !model.projectId || !draft.value.trim();
    scope.textContent = selected ? `Trecho selecionado · ${selected.end-selected.start} unidades UTF-16` : 'Ações sobre o pedido inteiro. Selecione um trecho para limitar.';
  }
  function checkSelection() {
    if (document.activeElement !== draft || composing) return;
    sync(); const start = draft.selectionStart, end = draft.selectionEnd;
    const changed = selected ? selected.start !== start || selected.end !== end : end > start;
    if (changed) { model.cancel(); requestBusy = false; hidePanel(); }
    selected = end > start && boundary(draft.value,start) && boundary(draft.value,end) ? {start,end,revision:model.revision} : null;
    clearTimeout(pauseTimer); updateActions();
    if (selected && model.mode !== 'off') expression('selection','Um trecho · você escolhe a ação.',false);
    else schedule();
  }
  function reject() {
    const ask = model.dismiss(Date.now()); requestBusy = false; hidePanel(); draft.focus();
    expression('dismissed','Entendi · vamos no seu ritmo.');
    if (ask) {
      const question = 'O que mais ajudaria: tornar o objetivo claro, citar contexto ou definir uma pesquisa?';
      followup.hidden = false; add(followup,'p','',question); announce(question);
      for (const [kind,label] of [['clarify','Objetivo'],['context','Contexto'],['research','Pesquisa']]) button(followup,label,()=>suggest(kind));
    } else announce('Sugestão dispensada. Seu pedido foi preservado.');
  }
  function showProposal(captured,replacement,label) {
    if (!model.propose(captured,replacement)) {
      if (model.current(captured)) { panel.hidden = false; panel.replaceChildren(); add(panel,'p','catalog-error','A sugestão excederia o limite de 4.000 caracteres. Selecione um trecho menor.'); }
      return;
    }
    panel.replaceChildren(); panel.hidden = false; followup.hidden = true;
    add(panel,'strong','',`${label} · template local`);
    const original = add(panel,'details','cp-original'); add(original,'summary','','Trecho original'); add(original,'pre','',captured.draft.slice(captured.start,captured.end));
    add(panel,'p','microcopy','Prévia da substituição; campos entre colchetes são perguntas para você preencher.');
    add(panel,'pre','cp-preview',replacement);
    const controls = add(panel,'div','cp-actions');
    button(controls,'Aplicar no rascunho',()=>{
      sync(); if (!model.apply()) { hidePanel(); return announce('Sugestão antiga: o projeto ou rascunho mudou.'); }
      draft.value = model.text; selected = null; hidePanel(); updateUndo(); updateActions();
      draft.focus(); draft.setSelectionRange(captured.start,captured.start+replacement.length);
      expression('accepted','Boa! · você continua no comando.'); announce('Sugestão aplicada ao rascunho; nada foi enviado.');
    },'button');
    button(controls,'Dispensar',reject,'ghost');
    expression('suggestion','Uma ideia · você decide.'); announce(`${label}: prévia pronta para revisar.`);
  }
  async function suggest(kind, passive = false) {
    sync(); clearTimeout(pauseTimer);
    if (model.mode === 'off' || !model.projectId || !draft.value.trim() || composing || !isVisible()) return;
    requestBusy = false;
    const span = selected && selected.revision === model.revision ? selected : {start:0,end:model.text.length};
    const captured = model.capture(span.start,span.end), text = captured.draft.slice(span.start,span.end);
    model.lastSuggestedRevision = model.revision; hidePanel();
    if (kind !== 'skills') { showProposal(captured,localTemplate(kind,text,contextExcerpt(getNotes(),model.projectId)),{clarify:'Estruturar pedido',context:'Citar contexto',research:'Pesquisa e termos'}[kind]); return; }
    requestBusy = true; expression('thinking','Consultando metadados locais…',false);
    try {
      const query = utf8Excerpt(text);
      const params = new URLSearchParams({q:query,host:'codex',ring:'installed',limit:'3',offset:'0'});
      const result = catalogResponse(await api(`/api/skills?${params}`));
      if (!model.current(captured) || !isVisible() || passive && document.activeElement !== draft) return;
      const ranked = await provider.classify({text:query,rows:candidateSkills(result.rows),snapshotId:result.snapshot_id,projectId:captured.projectId});
      if (!model.current(captured) || !isVisible() || passive && document.activeElement !== draft) return;
      const candidates = ranked.rows; panel.replaceChildren(); panel.hidden = false;
      add(panel,'strong','',passive ? 'Pausa boa para revisar seu pedido' : 'Candidatos locais');
      add(panel,'p','microcopy',`${coverageText(result)}. ${ranked.label}`);
      if (!candidates.length) add(panel,'p','','Não encontrei uma skill instalada com correspondência. Posso ajudar a estruturar o pedido.');
      for (const row of candidates) {
        const card = add(panel,'article','cp-skill'); add(card,'strong','',row.name);
        add(card,'p','',clipped(row.metadata?.functional_description || row.description || 'Descrição não informada.',180));
        add(card,'code','',row.source_key || 'Fonte não informada');
        add(card,'small','',`Host: ${strings(row.hosts).join(' / ') || 'desconhecido'} · autoridade não concedida`);
        button(card,'Ver metadados',()=>openSkills(row.name),'ghost');
        button(card,'Citar no pedido',()=>{
          sync(); hidePanel();
          showProposal(captured,`${text}\n\nSkill candidata: ${row.name}\nFonte: ${row.source_key || 'não informada'}\nValidar pré-requisitos e autorização antes do uso.`,'Referência de skill');
        },'ghost');
      }
      const controls = add(panel,'div','cp-actions'); button(controls,'Estruturar pedido',()=>suggest('clarify')); button(controls,'Dispensar',reject,'ghost');
      expression('suggestion','Uma ideia · você decide.'); announce(`${candidates.length} candidatos locais. Nenhuma skill foi executada.`);
    } catch (error) {
      if (!model.current(captured) || !isVisible() || passive && document.activeElement !== draft) return;
      panel.hidden = false; panel.replaceChildren(); add(panel,'p','catalog-error',`Busca indisponível: ${error.message}. Nenhuma recomendação confirmada.`);
      button(panel,'Usar template local',()=>suggest('clarify')); button(panel,'Dispensar',reject,'ghost');
      expression('resting','Catálogo indisponível · templates locais disponíveis.',false); announce('A busca de skills falhou.');
    } finally { if (model.current(captured)) requestBusy = false; }
  }
  function schedule() {
    clearTimeout(pauseTimer);
    if (composing || requestBusy || !model.canPause({visible:isVisible(),focused:document.activeElement===draft,selected:!!selected,now:Date.now()})) return;
    pauseTimer = setTimeout(()=>{
      sync(); if (model.canPause({visible:isVisible(),focused:document.activeElement===draft,selected:!!selected,now:Date.now()})) suggest('skills',true);
    },model.mode === 'active' ? 700 : 1700);
  }
  for (const [kind,label] of [['clarify','Clareza'],['context','Contexto'],['research','Pesquisa'],['skills','Skills']]) button(actions,label,()=>suggest(kind));
  mode.addEventListener('change',()=>{model.setMode(mode.value);requestBusy=false;clearTimeout(pauseTimer);hidePanel();savePreferences();expression('resting','Aqui quando precisar.',false);updateActions();schedule();});
  skinChoice.addEventListener('change',()=>{skin=skinChoice.value;renderRobot();savePreferences();});
  motion.addEventListener('change',()=>{savePreferences();mascot.classList.remove('cp-pop');});
  reduced.addEventListener('change',()=>mascot.classList.remove('cp-pop'));
  draft.addEventListener('input',()=>{sync();schedule();});
  draft.addEventListener('compositionstart',()=>{composing=true;clearTimeout(pauseTimer);model.cancel();hidePanel();});
  draft.addEventListener('compositionend',()=>{composing=false;sync();schedule();});
  draft.addEventListener('select',checkSelection); draft.addEventListener('keyup',checkSelection); draft.addEventListener('pointerup',checkSelection);
  draft.addEventListener('focus',schedule); draft.addEventListener('blur',()=>clearTimeout(pauseTimer));
  draft.form?.addEventListener('reset',()=>queueMicrotask(()=>{sync();readPreferences();}));
  document.addEventListener('pointerdown',event=>{if(event.target!==draft&&!root.contains(event.target)){selected=null;updateActions();}});
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();model.cancel();hidePanel();draft.focus();announce('Painel fechado.');}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(pauseTimer);model.cancel();requestBusy=false;hidePanel();mascot.classList.remove('cp-pop');}else schedule();});
  const observer = new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting===true;if(!visible){clearTimeout(pauseTimer);mascot.classList.remove('cp-pop');}else schedule();}); observer.observe(root);
  readPreferences();
  return {sync, revision(){sync();return model.revision;}, deactivate(){clearTimeout(pauseTimer);model.cancel();requestBusy=false;hidePanel();mascot.classList.remove('cp-pop');}};
}
export async function refreshCatalogIndex(api, {path,isCurrent}) {
  const rebuilt = await api('/api/skills/refresh',{method:'POST',body:{}});
  if (!isCurrent()) return null;
  if (typeof rebuilt?.snapshot_id !== 'string' || !rebuilt.coverage) throw Error('Reconstrução do índice não confirmada.');
  const result = catalogResponse(await api(path));
  if (!isCurrent()) return null;
  if (result.snapshot_id !== rebuilt.snapshot_id) throw Error('O índice mudou durante a atualização. Consulte novamente.');
  return result;
}

function robot(kind, id) {
  if (kind === 'pixel') return `<svg class="robot pixel" viewBox="0 0 40 40" aria-hidden="true" focusable="false" shape-rendering="crispEdges">
    <path fill="var(--robot-dark)" opacity=".25" d="M10 36h20v2H10z"/>
    <path fill="var(--robot-dark)" d="M12 32h6v4h-8v-2h2zm10 0h6v2h2v2h-8z"/>
    <path fill="var(--robot-mid)" d="M12 26h16v7H12z"/><path fill="var(--robot-light)" d="M12 26h16v2H12z"/>
    <path class="arm arm-left" fill="var(--robot-mid)" d="M8 26h4v6H8v-2H6v-2h2z"/><path class="arm arm-right" fill="var(--robot-mid)" d="M28 26h4v2h2v2h-2v2h-4z"/>
    <g class="antenna"><path fill="var(--robot-dark)" d="M19 5h2v6h-2z"/><path fill="var(--eye)" d="M19 1h2v2h2v2h-2v2h-2V5h-2V3h2z"/></g>
    <path fill="var(--robot-dark)" d="M8 10h24v2h2v12h-2v3H8v-3H6V12h2z"/>
    <path fill="var(--robot-light)" d="M10 9h20v2h2v12h-2v2H10v-2H8V11h2z"/>
    <path fill="var(--robot-mid)" d="M10 23h20v2H10zM8 11h2v12H8z"/>
    <path fill="#172130" d="M12 13h16v2h2v7h-2v1H12v-1h-2v-7h2z"/>
    <path fill="#314059" d="M12 13h16v2H12z"/>
    <path class="eye" fill="var(--eye)" d="M14 17h3v4h-3z"/><path class="eye" fill="var(--eye)" d="M23 17h3v4h-3z"/>
    <path class="sleep-line" stroke="var(--eye)" d="M13 20h5m4 0h5"/>
    <path class="smile" fill="var(--eye)" d="M19 21h2v1h-2z"/>
    <path fill="var(--robot-dark)" d="M16 28h8v4h-8z"/><path fill="var(--eye)" d="M17 29h2v1h-1v1h-1zm4 0h2v2h-1v-1h-1z"/>
    <path class="question-mark" fill="var(--accent)" d="M34 6h4v1h1v3h-2v2h-2V9h2V8h-3zm1 8h2v2h-2z"/>
  </svg>`;
  return `<svg class="robot modern" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
    <defs><linearGradient id="shell-${id}" x1=".15" y1="0" x2=".8" y2="1"><stop stop-color="var(--robot-light)"/><stop offset=".55" stop-color="var(--robot-mid)"/><stop offset="1" stop-color="var(--robot-dark)"/></linearGradient><linearGradient id="visor-${id}" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#34405a"/><stop offset="1" stop-color="#111927"/></linearGradient><radialGradient id="floor-${id}"><stop stop-color="var(--robot-dark)" stop-opacity=".38"/><stop offset="1" stop-color="var(--robot-dark)" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="100" cy="181" rx="62" ry="11" fill="url(#floor-${id})"/>
    <path d="M71 158v15q-18 1-20 7h34v-22m30 0v22h34q-2-6-20-7v-15" fill="var(--robot-dark)"/>
    <path d="M67 157v13q-8 2-9 5h26v-18m32 0v18h26q-2-4-9-5v-13" fill="var(--robot-mid)"/>
    <g class="arm arm-left"><path d="M61 134q-15 1-16 17" stroke="var(--robot-dark)" stroke-width="14" fill="none" stroke-linecap="round"/><ellipse cx="42" cy="154" rx="11" ry="13" fill="url(#shell-${id})" transform="rotate(18 42 154)"/></g>
    <g class="arm arm-right"><path d="M139 134q15 1 16 17" stroke="var(--robot-dark)" stroke-width="14" fill="none" stroke-linecap="round"/><ellipse cx="158" cy="154" rx="11" ry="13" fill="url(#shell-${id})" transform="rotate(-18 158 154)"/></g>
    <rect x="63" y="116" width="74" height="49" rx="22" fill="url(#shell-${id})"/><path d="M76 135q24 10 48 0" stroke="var(--robot-light)" stroke-opacity=".3" fill="none"/>
    <rect x="85" y="138" width="30" height="17" rx="7" fill="#263044"/><path d="m96 143-5 3 5 3m8-6 5 3-5 3" stroke="var(--eye)" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="antenna"><path d="M100 51V32" stroke="var(--robot-dark)" stroke-width="6" stroke-linecap="round"/><rect x="94" y="19" width="13" height="13" rx="4" fill="var(--eye)" transform="rotate(45 100.5 25.5)"/><path d="m98 21 4-1" stroke="var(--robot-light)" stroke-width="2" stroke-linecap="round"/></g>
    <rect x="27" y="76" width="21" height="35" rx="10" fill="var(--robot-dark)"/><rect x="152" y="76" width="21" height="35" rx="10" fill="var(--robot-dark)"/>
    <rect x="29" y="78" width="8" height="28" rx="4" fill="var(--robot-mid)"/><rect x="163" y="78" width="8" height="28" rx="4" fill="var(--robot-mid)"/>
    <rect x="38" y="44" width="124" height="91" rx="31" fill="url(#shell-${id})"/>
    <path d="M51 72q0-16 18-18h62q11 0 18 10" fill="none" stroke="var(--robot-light)" stroke-opacity=".65" stroke-width="3" stroke-linecap="round"/>
    <rect x="47" y="61" width="106" height="61" rx="23" fill="url(#visor-${id})" stroke="#141d2b" stroke-opacity=".6"/>
    <path d="M58 79q1-9 11-9h59" fill="none" stroke="#697793" stroke-width="2" stroke-opacity=".35" stroke-linecap="round"/>
    <rect class="eye" x="69" y="83" width="15" height="23" rx="7.5" fill="var(--eye)"/><rect class="eye" x="116" y="83" width="15" height="23" rx="7.5" fill="var(--eye)"/>
    <path class="sleep-line" d="M68 96h17m30 0h17" stroke="var(--eye)" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="62" cy="106" rx="5" ry="2.5" fill="var(--eye)" opacity=".18"/><ellipse cx="139" cy="106" rx="5" ry="2.5" fill="var(--eye)" opacity=".18"/>
    <path class="smile" d="M95 106q5 4 10 0" fill="none" stroke="var(--eye)" stroke-width="2" stroke-linecap="round"/>
    <path class="question-mark" d="M172 44q0-8 7-8t7 7q0 5-7 8v3m0 7v1" stroke="var(--accent)" stroke-width="3" fill="none" stroke-linecap="round"/>
  </svg>`;
}
