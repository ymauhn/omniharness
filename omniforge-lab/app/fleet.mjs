// Agentes view: the selected project's agent runs as a status grid (blocked first) and a kanban of its tasks, live from
// the `agent` and `state` SSE events, plus the run controls and run badge each card of the Tarefas view shows.
// State comes from the engine's run records (hooks and process events); this page never calls a model.
import { $, one, keepFocus } from './dom.mjs';
import { local, api, action, taskById, time } from './state.mjs';

const LABEL = { starting: 'Iniciando', working: 'Trabalhando', blocked: 'Aguardando você', idle: 'Ocioso', done: 'Concluído', failed: 'Falhou' };
const RANK = { blocked: 0, starting: 1, working: 1, idle: 2, done: 3, failed: 3 };
const ACTIVE = new Set(['starting', 'working', 'blocked', 'idle']); // the engine's own active states
const ALERT = new Set(['blocked', 'done', 'failed']);
const HOST = { claude: 'Claude', codex: 'Codex' };
const COLUMNS = [['open', 'Aberta'], ['running', 'Em execução'], ['blocked', 'Bloqueada'], ['done', 'Concluída']];
const USAGE = [['inputTokens', 'entrada'], ['outputTokens', 'saída'], ['cacheReadTokens', 'cache lido'], ['cacheCreationTokens', 'cache criado']];

const hostName = host => HOST[host] ?? host;
// A Gauntlet review runs in a Claude session too; its card says what it is.
const runner = run => (run.kind === 'gauntlet' ? 'Gauntlet' : hostName(run.host));
// The engine's prompt codes (hooks and terminal prompts) in pt-BR; any other detail is already text.
const DETAIL = { permission_prompt: 'pedido de permissão', elicitation_dialog: 'pergunta do agente', trust_prompt: 'confiança da pasta',
  hooks_review: 'revisão de hooks', rate_limit_prompt: 'aviso de limite de uso', approval_prompt: 'aprovação de comando' };
export const detailText = detail => DETAIL[detail] ?? detail;
export const runLabel = run => `${LABEL[run.state] ?? run.state}${run.detail ? ` · ${detailText(run.detail)}` : ''}`;
// Array sort is stable: the API's latest-first order holds inside each group.
export const orderRuns = runs => [...runs].sort((a, b) => (RANK[a.state] ?? 1) - (RANK[b.state] ?? 1));
export const groupTasks = tasks => COLUMNS.map(([status, title]) => ({ status, title, tasks: tasks.filter(task => (task.status || 'open') === status) }));

// A figure the CLI did not record is left out, never shown as 0.
export function usageText(usage) {
  if (usage?.status !== 'observed') return `Uso desconhecido: ${usage?.reason || 'ainda não lido'}`;
  const parts = USAGE.filter(([key]) => Number.isSafeInteger(usage[key])).map(([key, name]) => `${usage[key].toLocaleString('pt-BR')} ${name}`);
  return `Tokens observados: ${parts.join(' · ')}`;
}

// The router's suggestion as text lines: each field's value and source, and why a model answer was not used, with its score.
const SOURCE = { laya: 'Laya', jev: 'Jev', lexical: 'busca lexical' };
const ABSTAIN = { below_threshold: 'confiança insuficiente', none: 'nenhuma opção direta', selected_fit_failed: 'adequação não confirmada' };
const score = probability => (probability === null ? '' : ` · p ${probability.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export function suggestionLines(result) {
  const provider = SOURCE[result.provider];
  const field = (label, { value, source, probability, reason }, shown = value) => {
    if (source !== 'lexical') return `${label}: ${shown} · ${SOURCE[source]}${score(probability)}`;
    const why = reason === 'no_candidates' ? ' (sem candidatas no catálogo)' : reason ? ` (${provider}: ${ABSTAIN[reason] ?? 'sem resposta válida'}${score(probability)})` : '';
    return `${label}: ${value === null ? 'sem sugestão' : `${shown} · ${SOURCE.lexical}`}${why}`;
  };
  return [`Sugestão ${provider ? `de ${provider}` : 'por busca lexical (Laya descarregado)'} em ${result.latencyMs} ms · probabilidades não calibradas · nada foi executado.`,
    field('Host', result.host, hostName(result.host.value)), field('Skill', result.skill, result.skill.name ?? result.skill.value), field('Esforço', result.effort)];
}

function elapsedText(run, now = Date.now()) {
  const start = Date.parse(run.startedAt);
  if (Number.isNaN(start)) return '';
  const seconds = Math.max(0, Math.round(((run.endedAt ? Date.parse(run.endedAt) : now) - start) / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = String(seconds % 60).padStart(2, '0');
  const span = h ? `${h} h ${String(m).padStart(2, '0')} min` : m ? `${m} min ${s} s` : `${seconds % 60} s`;
  return `Início ${time(run.startedAt)} · ${run.endedAt ? 'Durou' : 'Rodando há'} ${span}`;
}

// State as text first; the colour (data-state) only repeats it.
function runBadge(parent, run, withHost = false) {
  const badge = one(parent, 'span', 'run-badge', `${withHost ? `${runner(run)} · ` : ''}${runLabel(run)}`);
  badge.dataset.state = run.state;
  return badge;
}

export function createFleet({ openSession, onChange = () => {} }) {
  let runs = [], projectId, request = 0, loadError = '', notify = false, elapsedNodes = new Map();
  const pending = new Set(), toggle = $('#fleet-notify');
  // Router suggestions by task id ({ pending, result, error, jev, jevAvailable }): they survive every re-render.
  const suggestions = new Map();
  const focusTask = key => [...$('#task-list').querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === key)?.focus();
  const latestRun = taskId => runs.find(run => run.taskId === taskId) ?? null;
  const changed = () => { render(); onChange(); };

  function sync() {
    if (projectId !== local.projectId) { projectId = local.projectId; runs = []; loadError = ''; void load(); }
    render();
  }

  // A newer request, or a project switch, drops an older answer.
  async function load() {
    const id = local.projectId, seq = ++request;
    if (!id) return;
    let result;
    try { result = await api(`/api/agents?projectId=${encodeURIComponent(id)}`); }
    catch (error) { if (seq === request && id === local.projectId) { loadError = `Execuções não carregadas: ${error.message}`; render(); } return; }
    if (seq !== request || id !== local.projectId) return;
    runs = result.runs.filter(run => run.projectId === id);
    loadError = '';
    changed();
  }

  // An SSE `agent` event: shown at once, then the full record (times, usage) is read again.
  function accept(event) {
    if (!event || event.projectId !== local.projectId) return;
    let run = runs.find(item => item.id === event.runId);
    const previous = run?.state;
    if (run) Object.assign(run, { state: event.state, detail: event.detail });
    else runs.unshift(run = { id: event.runId, taskId: event.taskId, projectId: event.projectId, sessionId: event.sessionId, host: event.host, state: event.state, detail: event.detail,
      kind: event.kind });
    if (ALERT.has(run.state) && previous !== run.state) alert(run);
    changed();
    void load();
  }

  function alert(run) {
    const text = `${taskById(run.taskId)?.title ?? 'Tarefa'}${run.detail ? ` · ${detailText(run.detail)}` : ''}`;
    $('#fleet-live').textContent = `${runner(run)}: ${LABEL[run.state]} em ${text}`;
    // Only while the owner is elsewhere, and only after the owner turned notifications on here.
    if (!notify || !document.hidden) return;
    try { new Notification(`OmniForge · ${runner(run)}: ${LABEL[run.state]}`, { body: text, tag: run.id }); }
    catch { /* a browser without the Notification constructor (service-worker only) */ }
  }

  function renderToggle() {
    const supported = typeof Notification !== 'undefined';
    toggle.disabled = !supported;
    toggle.textContent = !supported ? 'Notificações indisponíveis' : notify ? 'Desativar notificações' : 'Ativar notificações';
    $('#fleet-notify-help').textContent = supported && Notification.permission === 'denied' && !notify
      ? 'O navegador bloqueou as notificações deste endereço; libere nas configurações do site.'
      : 'Avisa quando um agente espera você, conclui ou falha, só com esta aba em segundo plano.';
  }
  // The permission prompt appears only from this click, never on load.
  toggle.addEventListener('click', async () => {
    if (typeof Notification === 'undefined') return;
    notify = !notify && await Notification.requestPermission() === 'granted';
    renderToggle();
  });

  function render() {
    const grid = $('#fleet-runs'), restore = keepFocus(grid), mine = orderRuns(runs.filter(run => run.projectId === local.projectId));
    grid.replaceChildren();
    elapsedNodes = new Map();
    $('#fleet-count').textContent = `${mine.length} execuç${mine.length === 1 ? 'ão' : 'ões'}`;
    if (!local.projectId) one(grid, 'p', 'empty', 'Selecione um projeto.');
    else if (!mine.length) one(grid, 'p', 'empty', loadError || 'Nenhum agente rodou neste projeto. Use “Rodar com Claude” ou “Rodar com Codex” em Tarefas.');
    for (const run of mine) {
      const card = one(grid, 'article', 'fleet-run'), head = one(card, 'div', 'fleet-run-head'), title = taskById(run.taskId)?.title ?? 'Tarefa removida';
      card.dataset.state = run.state;
      one(head, 'strong', 'fleet-host', runner(run));
      runBadge(head, run);
      one(card, 'p', 'fleet-task', title);
      elapsedNodes.set(run, one(card, 'p', 'meta', elapsedText(run)));
      one(card, 'p', 'meta', usageText(run.usage));
      const open = one(card, 'button', 'secondary', 'Abrir terminal');
      open.type = 'button'; open.dataset.focusKey = `fleet:${run.id}:open`;
      open.setAttribute('aria-label', `Abrir terminal de ${runner(run)} em ${title}`);
      open.addEventListener('click', () => openSession(run.sessionId));
    }
    restore();
    renderToggle();
    const board = $('#fleet-board');
    board.replaceChildren();
    for (const column of groupTasks(local.state.tasks.filter(task => task.projectId === local.projectId))) {
      const section = one(board, 'section', 'kanban-column');
      section.dataset.status = column.status;
      one(section, 'h3', '', `${column.title} · ${column.tasks.length}`);
      const list = one(section, 'ul', 'kanban-list');
      if (!column.tasks.length) one(list, 'li', 'kanban-empty', 'Nenhuma tarefa');
      for (const task of column.tasks) {
        const item = one(list, 'li', 'kanban-card'), run = latestRun(task.id);
        one(item, 'span', 'kanban-title', task.title);
        if (run) runBadge(item, run, true);
      }
    }
  }

  // Elapsed time of active runs, without rebuilding the grid (focus and screen readers stay put).
  const ticker = setInterval(() => {
    if (local.view === 'fleet') for (const [run, node] of elapsedNodes) if (!run.endedAt) node.textContent = elapsedText(run);
  }, 1000);
  ticker.unref?.();

  // Tarefas view: "Rodar com …" per host, disabled while any run of the task (agent or Gauntlet) is active, as the engine
  // refuses, and the latest run's state. "Sugerir host e skill" marks the suggested host's run button; it never runs anything.
  function taskControls(item, task) {
    const row = one(item, 'div', 'task-run'), run = latestRun(task.id), busy = runs.some(other => other.taskId === task.id && ACTIVE.has(other.state));
    const entry = suggestions.get(task.id) ?? {};
    for (const host of Object.keys(HOST)) {
      const suggested = entry.result?.host.value === host;
      const button = one(row, 'button', suggested ? 'button' : 'secondary', `Rodar com ${hostName(host)}`);
      button.type = 'button'; button.dataset.focusKey = `task:${task.id}:run-${host}`; button.disabled = busy;
      if (suggested) button.setAttribute('aria-describedby', `route-${task.id}`);
      button.addEventListener('click', () => start(task, host));
    }
    if (run) Object.assign(runBadge(row, run, true), { tabIndex: -1 }).dataset.focusKey = `task:${task.id}:run-state`;
    const ask = one(row, 'button', 'secondary', 'Sugerir host e skill');
    ask.type = 'button'; ask.dataset.focusKey = `task:${task.id}:route`; ask.addEventListener('click', () => suggest(task));
    // Shown only once the server reports a Jev key in the vault; one tick covers one request.
    if (entry.jevAvailable) {
      const label = one(row, 'label'), box = one(label, 'input');
      box.type = 'checkbox'; box.checked = Boolean(entry.jev); box.dataset.focusKey = `task:${task.id}:route-jev`;
      box.addEventListener('change', () => { entry.jev = box.checked; });
      one(label, 'span', '', ' Usar Jev nesta sugestão (envia o texto da tarefa à Jev e usa créditos da sua conta Jev; até 3 chamadas)');
    }
    const lines = entry.pending ? ['Sugerindo host e skill…'] : entry.error ? [entry.error] : entry.result ? suggestionLines(entry.result) : [];
    if (lines.length) { const box = one(item, 'div', 'route-suggestion'); box.id = `route-${task.id}`; for (const line of lines) one(box, 'p', 'meta', line); }
    return row; // the task card adds its other task actions to this same row
  }

  // A second click while one is in flight is ignored. Focus never moves: the answer can arrive seconds later, and a
  // keystroke meant for another control must not land on a run button. The styling and aria-describedby mark the host.
  async function suggest(task) {
    const entry = suggestions.get(task.id) ?? {};
    if (entry.pending) return;
    suggestions.set(task.id, { ...entry, pending: true });
    onChange();
    let result = null, error = null;
    try { result = await api(`/api/tasks/${encodeURIComponent(task.id)}/route`, { method: 'POST', body: { jev: Boolean(entry.jev) } }); }
    catch (failure) { error = `Sugestão indisponível: ${failure.message}`; }
    suggestions.set(task.id, { result, error, jev: false, jevAvailable: result ? result.jevAvailable : entry.jevAvailable });
    onChange();
  }

  // Not disabled while in flight (focus would drop to the page); a second click is ignored instead.
  // On success focus moves to the new run's badge, since both run buttons are then disabled.
  async function start(task, host) {
    if (pending.has(task.id)) return;
    pending.add(task.id);
    try {
      const result = await action(`/api/tasks/${encodeURIComponent(task.id)}/run`, { host, expectedRevision: task.revision }, `${hostName(host)} iniciado em “${task.title}”.`);
      if (!result) return;
      await load();
      focusTask(`task:${task.id}:run-state`);
    } finally { pending.delete(task.id); }
  }

  const gauntletRun = taskId => runs.find(run => run.taskId === taskId && run.kind === 'gauntlet') ?? null;
  return { sync, load, accept, render, taskControls, gauntletRun };
}
