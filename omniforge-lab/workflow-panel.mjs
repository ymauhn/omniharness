// Local workflow editor and DAG viewer. No terminal input, host dispatch or
// evaluator calls occur here. Prompt text is always rendered as text.
const PILLARS = { engineering: 'Engenharia', 'orchestration-os': 'Orquestração', 'science-thesis': 'Ciência', 'education-community': 'Educação', 'technical-marketing': 'Marketing técnico' };
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const add = (parent, tag, className, text) => { const node = el(tag, className, text); parent.append(node); return node; };
const button = (parent, text, action, className = 'secondary') => { const node = add(parent, 'button', className, text); node.type = 'button'; node.addEventListener('click', action); return node; };
const lines = value => value.split('\n').map(item => item.trim()).filter(Boolean);
// Server messages for these statuses are fixed validation, conflict or capacity (507) texts.
const errorText = error => [400, 409, 413, 507].includes(error?.status) ? error.message : 'Operação não confirmada. Verifique o servidor e tente novamente.';

export function workflowLayout(nodes) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > 16 || new Set(nodes.map(node => node.id)).size !== nodes.length) throw Error('Grafo inválido');
  const byId = new Map(nodes.map(node => [node.id, node])), levels = new Map(), active = new Set();
  function visit(node) {
    if (!node || !Array.isArray(node.dependsOn) || active.has(node.id)) throw Error('Dependência inválida ou ciclo');
    if (levels.has(node.id)) return levels.get(node.id);
    active.add(node.id);
    const level = node.dependsOn.length ? 1 + Math.max(...node.dependsOn.map(id => visit(byId.get(id)))) : 0;
    active.delete(node.id); levels.set(node.id, level); return level;
  }
  nodes.forEach(visit);
  const rows = new Map(), positions = [];
  for (const node of nodes) {
    const level = levels.get(node.id), row = rows.get(level) ?? 0; rows.set(level, row + 1);
    positions.push({ id: node.id, x: 24 + level * 230, y: 24 + row * 104, level });
  }
  return { positions, width: 48 + (1 + Math.max(...levels.values())) * 230 - 26, height: 48 + Math.max(...rows.values()) * 104 - 20, edges: nodes.flatMap(node => node.dependsOn.map(from => ({ from, to: node.id }))) };
}

export function insertWorkflowPrompt({ draft, prompt, expectedProjectId, getProjectId, notify = () => {} }) {
  if (!expectedProjectId || expectedProjectId !== getProjectId()) throw Error('Selecione novamente o workflow deste projeto');
  const next = draft.value ? `${draft.value}\n\n${prompt}` : prompt;
  if (next.length > (draft.maxLength > 0 ? draft.maxLength : 4000)) throw Error('O prompt ultrapassa o limite do compositor; copie ou reduza o texto');
  draft.value = next;
  draft.dispatchEvent(new Event('input', { bubbles: true }));
  notify(); draft.focus(); return next;
}

// Public async seam: switching A → B → A must invalidate an old A result too.
export class WorkflowRequests {
  constructor(getProjectId) { this.getProjectId = getProjectId; this.projectId = getProjectId(); this.epoch = 0; }
  sync() { if (this.projectId === this.getProjectId()) return false; this.projectId = this.getProjectId(); this.epoch++; return true; }
  invalidate() { this.epoch++; }
  capture() { this.sync(); const projectId = this.projectId, epoch = this.epoch; return { projectId, current: () => { this.sync(); return epoch === this.epoch && projectId === this.projectId; } }; }
}

function blank() {
  return { title: 'Novo workflow', summary: 'Descreva o resultado verificável deste fluxo.', pillar: 'engineering', triggerPrompt: 'Defina a tarefa e os critérios de aceite.', inputs: [], outputs: [], hosts: ['codex', 'claude'], source: 'Autoria local; informe a referência', authority: 'manual-task-only', nodes: [{ id: 'step-1', title: 'Primeira etapa', prompt: 'Descreva o pedido desta etapa.', dependsOn: [], skills: [] }] };
}

export function mountWorkflows({ root, api, getProjectId, draft, onTasksCreated = () => {}, onInsert = () => {}, clipboard = text => navigator.clipboard.writeText(text) }) {
  root.classList.add('wf-panel');
  const scope = new WorkflowRequests(getProjectId);
  const state = { projectId: getProjectId(), rows: [], presets: [], runs: [], editing: null, selected: null, selectedNode: null, dirty: false, busy: false, loading: 0, requests: new Map(), destroyed: false };
  const toolbar = add(root, 'div', 'wf-toolbar');
  const newButton = button(toolbar, '+ Novo workflow', () => openDraft(null, blank()), 'button');
  const refreshButton = button(toolbar, 'Atualizar lista', () => load());
  const status = add(root, 'p', 'wf-status', 'Selecione um projeto.'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const layout = add(root, 'div', 'wf-layout');
  const library = add(layout, 'aside', 'wf-library'); library.setAttribute('aria-label', 'Workflows salvos e sugestões');
  const detail = add(layout, 'section', 'card wf-detail');
  const heading = add(detail, 'h2', 'wf-detail-heading', 'Seu próximo fluxo, com contexto.'); heading.tabIndex = -1;
  const body = add(detail, 'div', 'wf-detail-body');
  const say = message => { status.textContent = message; };
  function usable() { if (state.projectId !== getProjectId()) { sync(); return false; } return !state.destroyed && getProjectId() && !state.busy; }
  function resetDetail() { body.replaceChildren(); heading.textContent = 'Seu próximo fluxo, com contexto.'; add(body, 'p', 'wf-hint', 'Abra uma sugestão para revisar, ou um fluxo salvo para ver os prompts e criar sua fila de tarefas.'); }
  function renderLibrary() {
    library.replaceChildren();
    const saved = add(library, 'section', 'wf-group'); add(saved, 'h2', '', `Salvos no projeto · ${state.rows.length}`);
    if (!state.rows.length) add(saved, 'p', 'wf-hint', 'Seus fluxos revisados ficam aqui.');
    for (const row of state.rows) {
      const item = button(saved, '', () => selectSaved(row), 'wf-library-item'); item.setAttribute('aria-pressed', String(state.selected?.id === row.id));
      add(item, 'strong', '', row.definition.title); add(item, 'span', 'wf-meta', `${PILLARS[row.definition.pillar]} · v${row.version}${row.archivedAt ? ' · arquivado' : ''}`);
    }
    const presets = add(library, 'section', 'wf-group'); add(presets, 'h2', '', 'Sugestões · revisar antes de salvar');
    for (const row of state.presets) {
      const item = button(presets, '', () => openDraft(null, row.definition), 'wf-library-item');
      add(item, 'strong', '', row.definition.title); add(item, 'span', 'wf-meta', `${PILLARS[row.definition.pillar]} · template original`);
    }
  }
  async function load() {
    if (state.projectId !== getProjectId()) { sync(); return; }
    scope.sync(); const ticket = scope.capture(), request = ++state.loading;
    newButton.disabled = !ticket.projectId; refreshButton.disabled = !ticket.projectId;
    if (!ticket.projectId || state.destroyed) { if (!state.destroyed) say('Selecione um projeto.'); return; }
    say('Consultando workflows deste projeto…');
    try {
      const q = `?projectId=${encodeURIComponent(ticket.projectId)}`;
      const [saved, presets] = await Promise.all([api(`/api/workflows${q}`), api(`/api/workflows/presets${q}`)]);
      if (!ticket.current() || request !== state.loading || state.destroyed) return;
      if (saved.projectId !== ticket.projectId || presets.projectId !== ticket.projectId || !Array.isArray(saved.rows) || !Array.isArray(saved.runs) || !Array.isArray(presets.rows)) throw Error('Resposta inválida');
      state.rows = saved.rows; state.runs = saved.runs; state.presets = presets.rows; renderLibrary();
      say(state.dirty ? 'Lista atualizada; seu rascunho foi mantido. Salvar ainda verifica conflitos de versão.' : `${state.rows.length} workflows salvos. Sugestões não executam ações.`);
    } catch (error) { if (ticket.current() && request === state.loading && !state.destroyed) say(errorText(error)); }
  }
  function openDraft(row, definition) {
    if (!usable()) return;
    if (state.dirty) { say('Salve ou descarte explicitamente o rascunho antes de abrir outro workflow.'); return; }
    scope.invalidate(); state.selected = row; state.editing = structuredClone(definition); state.selectedNode = definition.nodes[0]?.id; state.dirty = !row;
    renderDetail(); renderLibrary(); heading.focus();
  }
  function selectSaved(row) { openDraft(row, row.definition); }
  function markDirty() { state.dirty = true; if (reviewCheck) reviewCheck.checked = false; if (taskButton) taskButton.disabled = true; }
  let reviewCheck, taskButton, nodePanel, graph, saveButton, saveActions, historyPanel;
  function field(parent, label, value, max, update, multiline = false) {
    const wrapper = add(parent, 'label', 'wf-field', label), input = add(wrapper, multiline ? 'textarea' : 'input');
    input.value = value; input.maxLength = max; input.disabled = !!state.selected?.archivedAt;
    input.addEventListener('input', () => { update(input.value); markDirty(); });
    return input;
  }
  function renderDetail() {
    const restoreFocus = body.contains(document.activeElement);
    body.replaceChildren(); heading.textContent = state.editing.title;
    const value = state.editing;
    add(body, 'p', 'wf-hint', `${state.selected ? `Salvo · versão ${state.selected.version}` : 'Rascunho · ainda não salvo'} · 1–16 nós · até 24 KiB · execução manual`);
    const metadata = add(body, 'details', 'wf-metadata'); add(metadata, 'summary', '', 'Identidade, entradas e saídas');
    const fields = add(metadata, 'div', 'wf-fields');
    field(fields, 'Nome', value.title, 120, text => value.title = text);
    const pillarLabel = add(fields, 'label', 'wf-field', 'Pilar'), pillar = add(pillarLabel, 'select');
    for (const [key, label] of Object.entries(PILLARS)) { const option = add(pillar, 'option', '', label); option.value = key; }
    pillar.value = value.pillar; pillar.disabled = !!state.selected?.archivedAt; pillar.addEventListener('change', () => { value.pillar = pillar.value; markDirty(); });
    field(fields, 'Resumo', value.summary, 600, text => value.summary = text, true);
    field(fields, 'Prompt de acionamento (somente texto)', value.triggerPrompt, 3500, text => value.triggerPrompt = text, true);
    field(fields, 'Entradas · uma por linha, até 8', value.inputs.join('\n'), 1448, text => value.inputs = lines(text), true);
    field(fields, 'Saídas · uma por linha, até 8', value.outputs.join('\n'), 1448, text => value.outputs = lines(text), true);
    field(fields, 'Hosts sugeridos · codex, claude ou local; um por linha', value.hosts.join('\n'), 50, text => value.hosts = lines(text), true);
    field(fields, 'Fonte / autoria declarada', value.source, 300, text => value.source = text);
    add(fields, 'p', 'wf-hint', 'Compatibilidade e fonte são declarações deste workflow. Referências a skills não instalam ferramentas nem concedem permissões.');
    const triggerActions = add(metadata, 'div', 'wf-actions');
    button(triggerActions, 'Copiar acionamento', () => copy(value.triggerPrompt)); button(triggerActions, 'Inserir acionamento no chat', () => insert(value.triggerPrompt));
    const graphHeader = add(body, 'div', 'wf-toolbar'); add(graphHeader, 'h3', '', 'Mapa do fluxo');
    const append = button(graphHeader, '+ Etapa', () => {
      if (value.nodes.length >= 16) return say('O limite é de 16 nós por workflow.');
      let index = 1; while (value.nodes.some(node => node.id === `step-${index}`)) index++;
      const node = { id: `step-${index}`, title: `Etapa ${index}`, prompt: 'Descreva o pedido desta etapa.', dependsOn: state.selectedNode ? [state.selectedNode] : [], skills: [] };
      value.nodes.push(node); state.selectedNode = node.id; markDirty(); renderGraph(); renderNode();
    }); append.disabled = !!state.selected?.archivedAt;
    graph = add(body, 'div', 'wf-graph-scroll'); graph.setAttribute('aria-label', 'Diagrama de dependências; use Tab para selecionar um nó');
    nodePanel = add(body, 'section', 'wf-node-detail'); renderGraph(); renderNode();
    const footer = add(body, 'div', 'wf-save');
    const checkLabel = add(footer, 'label', 'wf-check'); reviewCheck = add(checkLabel, 'input'); reviewCheck.type = 'checkbox';
    add(checkLabel, 'span', '', 'Revisei prompts, dependências e referências desta versão.');
    const actions = saveActions = add(footer, 'div', 'wf-actions');
    saveButton = button(actions, state.selected ? 'Salvar nova versão' : 'Salvar no projeto', save, 'button'); saveButton.disabled = !!state.selected?.archivedAt;
    button(actions, 'Descartar rascunho', () => { state.dirty = false; state.editing = null; state.selected = null; scope.invalidate(); renderLibrary(); resetDetail(); newButton.focus(); });
    if (state.selected) {
      button(actions, 'Ver versões e tarefas', history);
      const archive = button(actions, 'Arquivar fluxo', archiveSelected); archive.disabled = !!state.selected.archivedAt;
    }
    add(footer, 'p', 'wf-hint', 'Criar tarefas apenas registra a fila local. Cada tarefa começa aberta. Envio a hosts, avaliação e conclusão continuam explícitos.');
    if (restoreFocus) heading.focus();
  }
  function renderGraph() {
    graph.replaceChildren();
    let layout;
    try { layout = workflowLayout(state.editing.nodes); } catch { add(graph, 'p', 'wf-hint', 'Dependências incompletas ou cíclicas. Corrija o nó selecionado antes de salvar.'); return; }
    const canvas = add(graph, 'div', 'wf-canvas'); canvas.style.width = `${layout.width}px`; canvas.style.height = `${layout.height}px`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`); svg.setAttribute('aria-hidden', 'true');
    const positions = new Map(layout.positions.map(position => [position.id, position]));
    for (const edge of layout.edges) {
      const from = positions.get(edge.from), to = positions.get(edge.to), line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', `M ${from.x + 200} ${from.y + 38} C ${from.x + 225} ${from.y + 38}, ${to.x - 25} ${to.y + 38}, ${to.x} ${to.y + 38}`); svg.append(line);
    }
    canvas.append(svg);
    state.editing.nodes.forEach((node, index) => {
      const position = positions.get(node.id), item = button(canvas, '', () => {
        state.selectedNode = node.id;
        for (const child of canvas.querySelectorAll('button')) child.setAttribute('aria-pressed', String(child === item));
        renderNode(); nodePanel.querySelector('h3')?.focus();
      }, 'wf-node');
      item.style.left = `${position.x}px`; item.style.top = `${position.y}px`; item.setAttribute('aria-pressed', String(node.id === state.selectedNode));
      item.title = `${node.title}\nDepende de: ${node.dependsOn.join(', ') || 'nenhum'}\n${node.prompt}`;
      add(item, 'span', 'wf-step', String(index + 1).padStart(2, '0')); add(item, 'strong', '', node.title); add(item, 'span', 'wf-meta', node.id);
    });
  }
  async function copy(prompt) {
    const ticket = scope.capture();
    try { await clipboard(prompt); if (ticket.current()) say('Prompt copiado. Nenhuma ação executada.'); }
    catch { if (ticket.current()) say('Não foi possível copiar. Selecione o texto do prompt e copie manualmente.'); }
  }
  function insert(prompt) {
    try { insertWorkflowPrompt({ draft, prompt, expectedProjectId: state.projectId, getProjectId, notify: onInsert }); say('Prompt acrescentado ao compositor. Revise antes de enviar.'); }
    catch (error) { say(error.message); }
  }
  function renderNode() {
    nodePanel.replaceChildren();
    const node = state.editing.nodes.find(node => node.id === state.selectedNode);
    if (!node) return;
    const title = add(nodePanel, 'h3', '', `Etapa ${node.id}`); title.tabIndex = -1;
    const name = field(nodePanel, 'Título da etapa', node.title, 120, text => { node.title = text; }); name.addEventListener('change', renderGraph);
    field(nodePanel, 'Prompt desta etapa', node.prompt, 3500, text => node.prompt = text, true);
    const deps = field(nodePanel, 'IDs dos pré-requisitos · separados por vírgula', node.dependsOn.join(', '), 1280, text => node.dependsOn = text.split(',').map(id => id.trim()).filter(Boolean));
    deps.addEventListener('change', renderGraph);
    field(nodePanel, 'Referências de skills · uma por linha, até 8', node.skills.join('\n'), 1928, text => node.skills = lines(text), true);
    const actions = add(nodePanel, 'div', 'wf-actions');
    button(actions, 'Copiar prompt', () => copy(node.prompt)); button(actions, 'Inserir no chat', () => insert(node.prompt));
    let count = 0;
    try { const seen = new Set(), visit = current => { if (seen.has(current.id)) return; seen.add(current.id); for (const dep of current.dependsOn) visit(state.editing.nodes.find(node => node.id === dep)); }; workflowLayout(state.editing.nodes); visit(node); count = seen.size; } catch {}
    const retry = state.selected && state.requests.has(`${scope.projectId}/${state.selected.id}/${state.selected.revision}/${node.id}`);
    taskButton = button(actions, `Criar ${count || 'as'} tarefa${count === 1 ? '' : 's'} até este nó${retry ? ' · retomar envio' : ''}`, () => createTasks(node.id), 'button');
    taskButton.disabled = !state.selected || state.dirty || !!state.selected.archivedAt || !count;
    const remove = button(actions, 'Remover etapa', () => {
      const nodes = state.editing.nodes; nodes.splice(nodes.indexOf(node), 1);
      // Dependents inherit the removed step's prerequisites, so a chain stays a chain.
      for (const item of nodes) item.dependsOn = [...new Set(item.dependsOn.flatMap(dep => dep === node.id ? node.dependsOn : [dep]))];
      state.selectedNode = nodes[0].id; markDirty(); renderGraph(); renderNode(); nodePanel.querySelector('h3')?.focus();
    }); remove.disabled = !!state.selected?.archivedAt || state.editing.nodes.length < 2;
    add(nodePanel, 'p', 'wf-hint', `${count ? `${count} nó(s), incluindo os pré-requisitos.` : 'Corrija as dependências.'} O prompt e a versão ficam vinculados às tarefas. Nenhum modelo é iniciado.`);
  }
  async function mutate(path, input, success, conflict) {
    if (!usable()) return;
    const ticket = scope.capture(), operation = {}; state.busy = true; state.operation = operation;
    // Archival must refer to the displayed saved version, never in-flight edits.
    const frozen = path.endsWith('/archive') ? ['input', 'textarea', 'select', 'button'].flatMap(tag => [...body.querySelectorAll(tag)]).map(node => [node, node.disabled]) : [];
    for (const [node] of frozen) node.disabled = true;
    try {
      const result = await api(path, { method: 'POST', body: { projectId: ticket.projectId, ...input } });
      if (!ticket.current() || state.destroyed) return;
      await success(result, ticket); return result;
    } catch (error) { if (ticket.current() && !state.destroyed) { const reason = errorText(error); say(reason); if (error?.status === 409) await conflict?.(ticket, reason); } }
    finally {
      for (const [node, disabled] of frozen) node.disabled = disabled;
      if (state.operation === operation) { state.busy = false; state.operation = null; }
    }
  }
  async function save() {
    if (!reviewCheck.checked) return say('Revise esta versão e marque a confirmação antes de salvar.');
    const selected = state.selected, captured = JSON.stringify(state.editing);
    const path = selected ? `/api/workflows/${selected.id}/update` : '/api/workflows';
    await mutate(path, { definition: JSON.parse(captured), reviewed: true, ...(selected ? { expectedRevision: selected.revision } : {}) }, async row => {
      if (JSON.stringify(state.editing) !== captured) { say('Versão salva; alterações digitadas durante o envio continuam no rascunho.'); state.selected = row; return; }
      state.selected = row; state.editing = structuredClone(row.definition); state.dirty = false;
      renderDetail(); say(`Versão ${row.version} salva neste projeto.`); void load();
    }, selected && (async (ticket, reason) => {
      // Another window saved or archived: keep the draft and offer an explicit base change that still needs a fresh review.
      await load(); const current = state.rows.find(row => row.id === selected.id);
      if (!ticket.current() || state.selected !== selected) return;
      if (!current || current.revision === selected.revision) return say(reason);
      const base = current.archivedAt ? null : current; renderDetail();
      button(saveActions, base ? `Salvar rascunho sobre a versão ${base.version}` : 'Salvar rascunho como novo workflow', () => {
        if (!usable() || state.selected !== selected) return;
        state.selected = base; renderDetail(); renderLibrary();
        say(`Rascunho mantido ${base ? `sobre a versão ${base.version}; salvar cria a versão ${base.version + 1}` : 'como novo workflow'}. Revise e marque a confirmação antes de salvar.`);
      }, 'button');
      say(`${base ? `Outra janela salvou a versão ${base.version}` : 'Outra janela arquivou este workflow'}. Seu rascunho continua aqui e nada foi sobrescrito; compare em "Ver versões e tarefas".`);
    }));
  }
  async function createTasks(nodeId) {
    if (state.dirty || !state.selected || state.selected.archivedAt) return say('Salve e revise o workflow antes de criar tarefas.');
    const selected = state.selected, key = `${scope.projectId}/${selected.id}/${selected.revision}/${nodeId}`, submittedButton = taskButton;
    if (!state.requests.has(key) && state.requests.size >= 128) return say('Há 128 envios sem confirmação. Retome-os pela versão original antes de iniciar outros.');
    if (!state.requests.has(key)) state.requests.set(key, crypto.randomUUID());
    submittedButton.textContent = submittedButton.textContent.replace(/ · (retomar envio|nova execução)$/, '') + ' · retomar envio';
    await mutate(`/api/workflows/${selected.id}/tasks`, { expectedRevision: selected.revision, nodeId, requestId: state.requests.get(key) }, async (run, ticket) => {
      state.requests.delete(key);
      say(`${Object.keys(run.taskIds).length} tarefas da etapa ${nodeId} registradas · snapshot ${run.id}. Nenhum modelo iniciado.`);
      submittedButton.textContent = submittedButton.textContent.replace(/ · retomar envio$/, '') + ' · nova execução';
      try { await onTasksCreated(run); } catch { if (ticket.current()) say('Tarefas registradas; atualização da tela pendente. Atualize a lista, sem repetir o envio.'); }
    });
  }
  async function archiveSelected() {
    if (state.dirty) return say('Salve ou descarte o rascunho antes de arquivar.');
    await mutate(`/api/workflows/${state.selected.id}/archive`, { expectedRevision: state.selected.revision }, async row => {
      state.selected = row; renderDetail(); say('Workflow arquivado; versões e tarefas preservadas.'); void load();
    });
  }
  async function history(event) {
    const initiatingControl = event?.currentTarget ?? event?.target;
    const ticket = scope.capture(), selected = state.selected;
    if (!selected) return;
    try {
      const result = await api(`/api/workflows/${selected.id}?projectId=${encodeURIComponent(ticket.projectId)}`);
      if (!ticket.current() || state.selected?.id !== selected.id) return;
      const panel = historyPanel && body.contains(historyPanel) ? historyPanel : add(body, 'details', 'wf-history'); historyPanel = panel; panel.replaceChildren(); panel.open = true;
      add(panel, 'summary', '', 'Versões e snapshots de tarefas');
      for (const version of result.workflow.revisions) {
        const row = add(panel, 'details'); add(row, 'summary', '', `v${version.version} · ${version.savedAt} · ${version.hash.slice(0, 12)}`);
        add(row, 'pre', '', JSON.stringify(version.definition, null, 2));
      }
      for (const run of result.runs) add(panel, 'p', 'wf-meta', `Snapshot ${run.id} · v${run.version} · tarefas ${Object.values(run.taskIds).join(', ')} · sem despacho`);
      if (!result.runs.length) add(panel, 'p', 'wf-hint', 'Nenhuma tarefa criada por este fluxo.');
      if (initiatingControl && document.activeElement === initiatingControl) panel.querySelector('summary')?.focus();
    } catch (error) { if (ticket.current()) say(errorText(error)); }
  }
  function sync() {
    if (state.destroyed) return;
    if (state.projectId === getProjectId()) return;
    scope.sync(); scope.invalidate(); state.projectId = getProjectId();
    state.rows = []; state.presets = []; state.runs = []; state.editing = null; state.selected = null; state.dirty = false; state.busy = false; state.operation = null;
    renderLibrary(); resetDetail(); void load();
  }
  resetDetail(); void load();
  return { sync, load, destroy() { state.destroyed = true; scope.invalidate(); root.replaceChildren(); } };
}
