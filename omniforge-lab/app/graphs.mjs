// "Memória e grafos" view: the scoped memory notes/context panel and the navigable
// knowledge/capability/task graph. Both live here because the graph reads the same
// visible notes the memory panel loads.
import { $, one, asArray, fillSelect } from './dom.mjs';
import { local, api, action, toast, projectById, sessionById, statusLabel } from './state.mjs';
import { catalogResponse } from '../copilot.mjs';

export function createGraphs({ assignPane, renderWorkspace, catalog, memoryPanel, showView }) {
  function clearContext() {
    local.contextRequest++;
    $('#context-list').replaceChildren();
    $('#context-truncated').hidden = true;
  }

  async function loadMemory() {
    const projectId = local.projectId, request = ++local.memoryRequest;
    if (!projectId) { local.notes = []; local.memoryProjectId = null; renderMemory(); if (local.view === 'graphs') renderGraph(); return; }
    local.memoryProjectId = projectId;
    try {
      const result = await api(`/api/memory?projectId=${encodeURIComponent(projectId)}`);
      if (request !== local.memoryRequest || projectId !== local.projectId) return;
      local.notes = (Array.isArray(result) ? result : asArray(result.notes)).filter(note => note.scope === 'global' || (note.scope === 'project' && note.projectId === projectId));
      renderMemory();
      if (local.view === 'graphs') renderGraph();
    } catch (error) {
      if (request !== local.memoryRequest || projectId !== local.projectId) return;
      local.notes = []; local.memoryProjectId = null; renderMemory();
      if (!local.tokenInvalid) toast(`Memória não carregada: ${error.message}`);
    }
  }

  const visibleNotes = () => local.notes.filter(note => note.scope === 'global' || (note.scope === 'project' && note.projectId === local.projectId));

  function updateMemoryScope() { $('#memory-session').disabled = $('#memory-scope').value !== 'session'; }

  function renderMemory() {
    memoryPanel.sync(local.memoryRevision);
    const choices = local.state.sessions.filter(s => s.projectId === local.projectId).map(s => ({ value: s.id, label: s.name }));
    const memorySelect = $('#memory-session'), memoryChoice = choices.some(item => item.value === memorySelect.value) ? memorySelect.value : choices[0]?.value;
    fillSelect(memorySelect, choices, memoryChoice, 'Selecione sessão');
    const contextSelect = $('#context-session'), previousContextSession = contextSelect.value;
    const contextChoice = choices.some(item => item.value === previousContextSession) ? previousContextSession : choices[0]?.value;
    fillSelect(contextSelect, choices, contextChoice, 'Selecione sessão');
    if (contextSelect.value !== previousContextSession) clearContext();
    updateMemoryScope();
  }

  function makeNode(id, label, kind, source, scope, relation, openView, summary = '') { return { id, label, kind, source, scope, relation, openView, summary }; }

  // Bounded pages of one catalog snapshot: installed first, then catalog candidates. Graph help reads
  // curation from these rows, so a new snapshot replaces it.
  // ponytail: first 16 installed + 8 catalog rows alphabetically, no paging and no typed relations (the
  // list API returns none); the Skills view searches and pages the rest.
  async function loadCapabilities() {
    const request = ++local.capabilityRequest;
    const page = (ring, limit) => api(`/api/skills?${new URLSearchParams({ q: '', ring, limit, offset: '0' })}`).then(catalogResponse);
    let result;
    try {
      const pages = await Promise.all([page('installed', '16'), page('catalog', '8')]);
      if (pages[0].snapshot_id !== pages[1].snapshot_id) throw Error('O índice mudou durante a consulta. Tente novamente.');
      result = { snapshot_id: pages[0].snapshot_id, pages, rows: pages.flatMap(item => item.rows) };
    } catch (error) { result = { error: error.message }; }
    if (request !== local.capabilityRequest) return;
    local.capability = result;
    if (local.view === 'graphs') renderGraph();
  }

  const byMutation = (a, b) => (a.mutationSequence ?? 0) - (b.mutationSequence ?? 0) || String(a.updatedAt ?? a.createdAt ?? '').localeCompare(String(b.updatedAt ?? b.createdAt ?? ''));

  function capabilityGraphModel(project, sessions, notes, tasks) {
    const snapshot = local.capability, rows = asArray(snapshot?.rows);
    const rings = { installed: ['Instalada', 'instalada'], catalog: ['Catálogo', 'catálogo'], remote: ['Remota', 'remota'] };
    const availability = { installed: 'instalada', not_installed: 'não instalada', unreadable: 'fonte ilegível' };
    const rootSummary = 'Skills do snapshot do catálogo com anel e hosts; as arestas indicam presença no índice.';
    const rootSource = snapshot?.snapshot_id ? `Snapshot ${snapshot.snapshot_id.slice(0, 12)}` : 'Índice local do catálogo';
    const skillNode = row => {
      const [ring, short] = rings[row.ring] || ['Anel desconhecido', 'anel desconhecido'];
      const hosts = asArray(row.hosts).join(' / ');
      const label = `${row.name} · ${short}${hosts ? ` · ${hosts}` : ''}`;
      const scope = `${ring} · ${hosts || 'host não informado'}`;
      const status = availability[row.availability?.status || row.availability] || 'desconhecida';
      const relation = `Disponibilidade: ${status}; execução não iniciada`;
      const summary = row.description || 'Descrição funcional não informada.';
      return { ...makeNode(row.skill_id, label, 'skill', row.source_key || 'Origem não informada', scope, relation, 'skills', summary), name: row.name, row };
    };
    const nodes = [makeNode('catalog', 'Índice de skills', 'root', rootSource, 'Compartilhado', 'Índice → skill', null, rootSummary), ...rows.map(skillNode)];
    const empty = snapshot?.error ? `Catálogo indisponível: ${snapshot.error} Atualize o índice em Skills.`
      : snapshot ? 'Nenhuma skill no índice.' : 'Consultando o índice de skills…';
    const intro = rows.length
      ? `${snapshot.pages[0].rows.length} de ${snapshot.pages[0].total} instaladas e ${snapshot.pages[1].rows.length} de ${snapshot.pages[1].total} candidatas do catálogo exibidas ` +
        '(ordem alfabética); busque as demais, inclusive remotas, em Skills. Arestas indicam presença no índice, sem dependências inferidas.'
      : empty;
    return { title: 'Capacidades', intro, empty, nodes, edges: nodes.slice(1).map(n => ['catalog', n.id]) };
  }

  function taskGraphModel(project, sessions, notes, tasks) {
    const shownTasks = tasks.slice(-15), hidden = tasks.length - shownTasks.length;
    const taskNode = t => {
      const dependencies = asArray(t.dependsOn).map(id => tasks.find(other => other.id === id)?.title).filter(Boolean);
      const depSummary = dependencies.length
        ? `Depende de ${dependencies.slice(0, 3).join(', ')}${dependencies.length > 3 ? ' e outras.' : '.'}`
        : 'Sem dependências registradas.';
      const relation = `Estado: ${t.status || 'open'}; dependências explícitas`;
      return makeNode(t.id, t.title, 'task', 'Registro local de tarefas', project?.name || '—', relation, 'tasks', `Estado: ${t.status || 'open'}. ${depSummary}`);
    };
    const rootSummary = `${tasks.length} tarefa(s) registradas neste projeto.`;
    const rootNode = makeNode('project', project?.name || 'Projeto não selecionado', 'root', project?.root || '—', project?.name || '—', 'Projeto → tarefas', null, rootSummary);
    const nodes = [rootNode, ...shownTasks.map(taskNode)];
    const shown = new Set(nodes.map(n => n.id));
    const edges = shownTasks.flatMap(task => {
      const declared = asArray(task.dependsOn);
      return declared.length ? declared.filter(id => shown.has(id)).map(id => [id, task.id]) : [['project', task.id]];
    });
    const hiddenNote = hidden ? ` (as mais recentes; ${hidden} mais antigas estão na lista de Tarefas)` : '';
    const intro = `${shownTasks.length} de ${tasks.length} tarefas exibidas${hiddenNote}. ` +
      'Arestas representam dependências registradas; tarefas sem dependências ligam-se ao projeto.';
    return { title: 'Tarefas', intro, nodes, edges };
  }

  function knowledgeGraphModel(project, sessions, notes) {
    const shownSessions = sessions.slice(-5), shownNotes = notes.slice().sort(byMutation).slice(-9), hasGlobal = shownNotes.some(note => note.scope === 'global');
    const projectNoteCount = notes.filter(n => n.scope !== 'global').length;
    const rootSummary = `${sessions.length} sessão(ões) e ${projectNoteCount} nota(s) visíveis deste projeto.`;
    const rootLabel = project?.name || 'Projeto não selecionado', rootRelation = 'Projeto → sessões e notas do projeto';
    const nodes = [makeNode('project', rootLabel, 'root', project?.root || '—', project?.name || '—', rootRelation, null, rootSummary)];
    if (hasGlobal) {
      const globalCount = shownNotes.filter(n => n.scope === 'global').length;
      nodes.push(makeNode('global', 'Memória global', 'root', 'Notas globais', 'Todas as sessões', 'Escopo global → nota', null, `${globalCount} nota(s) globais visíveis neste grafo.`));
    }
    nodes.push(...shownSessions.map(s => {
      const summary = `Sessão deste projeto. Estado: ${statusLabel(s.status) || 'não informado'}.`;
      return makeNode(s.id, s.name, 'session', `Sessão ${s.id}`, project?.name || '—', 'Sessão pertence ao projeto', 'workspace', summary);
    }));
    nodes.push(...shownNotes.map(n => {
      const label = n.text.length > 28 ? `${n.text.slice(0, 28)}…` : n.text;
      return makeNode(n.id, label, 'note', n.source, n.scope === 'global' ? 'Global' : project?.name || '—', 'Nota registrada com escopo explícito', null, n.text);
    }));
    const edges = [...shownSessions.map(s => ['project', s.id]), ...shownNotes.map(note => [note.scope === 'global' ? 'global' : 'project', note.id])];
    const intro = `${shownNotes.length} de ${notes.length} notas e ${shownSessions.length} de ${sessions.length} sessões exibidas (as mais recentes). ` +
      'Notas de sessão não aparecem neste grafo; consulte-as em "Contexto de uma sessão". Arestas mostram somente vínculos de escopo explícitos.';
    return { title: 'Conhecimento do projeto', intro, nodes, edges };
  }

  function graphModel() {
    const project = projectById(local.projectId), sessions = local.state.sessions.filter(s => s.projectId === local.projectId);
    const notes = visibleNotes(), tasks = local.state.tasks.filter(t => t.projectId === local.projectId);
    if (local.graph === 'capability') return capabilityGraphModel(project, sessions, notes, tasks);
    if (local.graph === 'task') return taskGraphModel(project, sessions, notes, tasks);
    return knowledgeGraphModel(project, sessions, notes);
  }

  let graphHelpHover = null, graphHelpFocus = null, graphHelpActive = null;
  const graphText = (value, limit = 220) => { const text = typeof value === 'string' ? value.trim() : ''; return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text; };

  function paintGraphHelp(node, row) {
    const metadata = row?.curation === 'current' ? row.metadata || {} : {};
    const description = node.kind === 'skill' ? metadata.functional_description || node.summary : node.summary;
    const example = metadata.use_cases?.pt?.[0] || metadata.use_cases?.en?.[0];
    const when = metadata.when_to_use?.[0];
    $('#graph-help-title').textContent = node.label;
    $('#graph-help-summary').textContent = graphText(description || node.relation);
    const usage = $('#graph-help-usage');
    usage.textContent = node.kind === 'skill'
      ? graphText(example ? `Exemplo de uso: ${example}` : when ? `Quando usar: ${when}` : 'Uso: consulte os exemplos no catálogo e cite a skill pelo nome no pedido.', 190)
      : '';
    usage.hidden = node.kind !== 'skill';
    $('#graph-help-docs').textContent = node.kind === 'skill'
      ? `Ajuda: ${graphText(node.source, 105)} · ${graphText(node.scope, 65)}. Selecione o nó e use "Abrir item" para ver metadados e exemplos.`
      : `Fonte: ${graphText(node.source, 105)} · Escopo: ${graphText(node.scope, 65)}.`;
  }
  function clearGraphHelp() { for (const id of ['title', 'summary', 'usage', 'docs']) $(`#graph-help-${id}`).textContent = ''; }
  function resetGraphHelp() {
    graphHelpHover = null; graphHelpFocus = null;
    graphHelpActive?.button.removeAttribute('aria-describedby'); graphHelpActive = null;
    $('#graph-help').hidden = true; clearGraphHelp();
  }
  function positionGraphHelp(button) {
    const panel = $('#graph-help'), rect = button.getBoundingClientRect(), margin = 8, width = panel.offsetWidth, height = panel.offsetHeight;
    // Slightly overlap the anchor so a pointer can enter the scrollable help without crossing a hide-triggering gap.
    const rightSide = rect.right - 2, leftSide = rect.left - width + 2;
    const x = rightSide + width <= window.innerWidth - margin ? rightSide : leftSide >= margin ? leftSide : Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const y = Math.max(margin, Math.min(rect.top, window.innerHeight - height - margin));
    panel.style.left = `${x}px`; panel.style.top = `${y}px`;
  }
  function updateGraphHelp() {
    const next = graphHelpFocus || graphHelpHover, panel = $('#graph-help');
    if (graphHelpActive?.button === next?.button) return;
    graphHelpActive?.button.removeAttribute('aria-describedby'); graphHelpActive = next;
    if (!next) { panel.hidden = true; clearGraphHelp(); return; }
    const { node, button } = next;
    paintGraphHelp(node, node.row); panel.hidden = false; positionGraphHelp(button); button.setAttribute('aria-describedby', 'graph-help');
  }

  function placeNodes(nodes, width) {
    const positions = new Map(), columns = width < 500 ? 2 : width < 740 ? 3 : 4, rest = nodes.slice(1);
    const rows = Math.ceil(rest.length / columns), height = Math.max(420, 150 + rows * 94 + 40);
    if (!nodes.length) return { positions, height };
    positions.set(nodes[0].id, { x: 50, y: 60 / height * 100 });
    rest.forEach((node, index) => {
      const row = Math.floor(index / columns), column = index % columns, count = Math.min(columns, rest.length - row * columns);
      positions.set(node.id, { x: 12 + (column + .5) * 76 / count, y: (150 + row * 94) / height * 100 });
    });
    return { positions, height };
  }

  function renderGraph() {
    const model = graphModel();
    local.graphModels[local.graph] = model;
    $('#graph-title').textContent = model.title;
    $('#graph-intro').textContent = model.intro;
    document.querySelectorAll('[data-graph]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.graph === local.graph)));
    const canvas = $('#graph-canvas'), focusedId = canvas.contains(document.activeElement) ? document.activeElement?.dataset.graphId : null;
    resetGraphHelp(); canvas.replaceChildren();
    if (model.nodes.length === 1) one(canvas, 'div', 'empty', model.empty || 'Adicione dados para visualizar relações.');
    const { positions, height } = placeNodes(model.nodes, canvas.clientWidth || 850);
    canvas.style.height = `${height}px`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    for (const [a, b] of model.edges) {
      const start = positions.get(a), end = positions.get(b);
      if (!start || !end) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      for (const [key, value] of [['x1', start.x], ['y1', start.y], ['x2', end.x], ['y2', end.y]]) line.setAttribute(key, String(value));
      line.setAttribute('stroke', 'var(--accent)'); line.setAttribute('stroke-opacity', '.55'); line.setAttribute('stroke-width', '.4');
      svg.append(line);
    }
    canvas.append(svg);
    for (const node of model.nodes) {
      const pos = positions.get(node.id);
      const button = one(canvas, 'button', 'graph-node', node.label);
      button.type = 'button'; button.style.left = `${pos.x}%`; button.style.top = `${pos.y}%`;
      button.dataset.kind = node.kind; button.dataset.graphId = node.id; button.dataset.selected = String(local.graphNode === node.id);
      button.addEventListener('mouseenter', () => { graphHelpHover = { node, button }; updateGraphHelp(); });
      button.addEventListener('mouseleave', event => { if ($('#graph-help').contains(event.relatedTarget)) return; if (graphHelpHover?.button === button) graphHelpHover = null; updateGraphHelp(); });
      button.addEventListener('focus', () => { graphHelpFocus = { node, button }; updateGraphHelp(); });
      button.addEventListener('blur', () => { if (graphHelpFocus?.button === button) graphHelpFocus = null; updateGraphHelp(); });
      button.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); resetGraphHelp(); } });
      button.addEventListener('click', () => {
        local.graphNode = node.id; renderGraphDetail(node);
        canvas.querySelectorAll('.graph-node').forEach(el => el.dataset.selected = String(el === button));
      });
    }
    $('#graph-help').onmouseleave = () => { graphHelpHover = null; updateGraphHelp(); };
    if (focusedId) [...canvas.querySelectorAll('.graph-node')].find(button => button.dataset.graphId === focusedId)?.focus();
    renderGraphDetail(model.nodes.find(n => n.id === local.graphNode) || model.nodes[0]);
  }

  function renderGraphDetail(node) {
    $('#graph-selection').textContent = node?.label || '—';
    $('#graph-source').textContent = node?.source || '—';
    $('#graph-scope').textContent = node?.scope || '—';
    $('#graph-relation').textContent = node?.relation || '—';
    const open = $('#graph-open');
    open.hidden = !node?.openView;
    open.onclick = () => {
      if (node?.kind === 'skill') { $('#skill-search').value = node.name || node.label; catalog.search(node.row?.ring || 'all'); }
      if (node?.kind === 'session') { assignPane(0, node.id); renderWorkspace(); }
      showView(node.openView);
    };
  }

  $('#memory-scope').addEventListener('change', updateMemoryScope);
  $('#memory-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, submit = form.querySelector('button[type="submit"]'), scope = form.elements.scope.value;
    if (form.busy) return;
    if (scope !== 'global' && !local.projectId) return toast('Selecione um projeto.');
    const body = {
      scope, projectId: scope === 'global' ? null : local.projectId, sessionId: scope === 'session' ? form.elements.sessionId.value : null,
      source: form.elements.source.value, text: form.elements.text.value,
    };
    if (scope === 'session' && !body.sessionId) return toast('Selecione uma sessão.');
    form.busy = submit.disabled = true;
    try {
      const result = await action('/api/memory', body, `Nota ${scope} guardada com fonte.`);
      if (result) { form.elements.text.value = ''; loadMemory(); }
    } finally { form.busy = submit.disabled = false; }
  });
  $('#context-session').addEventListener('change', clearContext);
  $('#load-context').addEventListener('click', async () => {
    const select = $('#context-session'), id = select.value, projectId = local.projectId;
    if (!id || sessionById(id)?.projectId !== projectId) return toast('Selecione uma sessão deste projeto.');
    clearContext();
    const request = local.contextRequest, list = $('#context-list'), indicator = $('#context-truncated');
    const isCurrent = () => request === local.contextRequest && projectId === local.projectId && select.value === id && sessionById(id)?.projectId === projectId;
    one(list, 'div', 'empty', 'Consultando…');
    try {
      const result = await api(`/api/context?sessionId=${encodeURIComponent(id)}`);
      if (!isCurrent()) return;
      const notes = Array.isArray(result) ? result : asArray(result.notes);
      list.replaceChildren(); indicator.hidden = result?.truncated !== true;
      if (!notes.length) one(list, 'div', 'empty', 'Nenhuma nota aplicável a esta sessão.');
      for (const note of notes) { const item = one(list, 'article', 'list-item'); one(item, 'p', '', note.text); one(item, 'div', 'meta', `${note.scope} · ${note.source}`); }
    } catch (error) {
      if (!isCurrent()) return;
      indicator.hidden = true; list.replaceChildren(); one(list, 'div', 'empty', error.message);
    }
  });
  $('#refresh-memory').addEventListener('click', () => { void loadMemory(); void memoryPanel.load(); });
  document.querySelectorAll('[data-graph]').forEach(button => button.addEventListener('click', () => {
    local.graph = button.dataset.graph; local.graphNode = null;
    if (local.graph === 'capability') void loadCapabilities();
    renderGraph();
  }));

  return { clearContext, loadMemory, renderMemory, updateMemoryScope, loadCapabilities, resetGraphHelp, renderGraph };
}
