// Shared app state, the local API/SSE transport and the small cross-cutting notices (toast, log).
// One `local` object per page load: every other module imports it from here, exactly like the
// original inline script closed over one shared `local`.
import { $, one } from './dom.mjs';
import { sessionsForProject } from '../pane-scope.mjs';

// The launch token lives in this origin's storage (port-scoped, unlike cookies) and travels as a header.
let authToken = new URLSearchParams(location.search).get('token');
if (authToken) {
  try { localStorage.setItem('omniforge-token', authToken); } catch { /* private mode or storage disabled */ }
  const clean = new URL(location.href);
  clean.searchParams.delete('token');
  history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`);
} else {
  try { authToken = localStorage.getItem('omniforge-token'); } catch { /* private mode or storage disabled */ }
}

export const local = {
  state: { projects: [], sessions: [], tasks: [], skills: [], layout: { split: 50 } },
  notes: [], memoryProjectId: null, memoryRequest: 0, memoryRevision: null, contextRequest: 0, projectId: null,
  paneSessions: [null, null], view: 'workspace', graph: 'knowledge', graphNode: null, graphModels: {},
  capability: null, capabilityRequest: 0, buffers: new Map(), ptyViews: new Map(), confirmedAcks: new Set(),
  log: [], inventory: null, inventoryProjectId: null, source: null, tokenInvalid: false,
  authProbePending: false, toastTimer: null,
};

export const projectById = id => local.state.projects.find(item => item.id === id);
export const sessionById = id => local.state.sessions.find(item => item.id === id);
export const taskById = id => local.state.tasks.find(item => item.id === id);
export const currentProjectSessions = () => sessionsForProject(local.state.sessions, local.projectId);
export const statusLabel = status => ({
  starting: 'iniciando', running: 'em execução', stopping: 'encerrando', stopped: 'shell encerrado', interrupted: 'interrompida',
})[status] || status || '';
export const time = value => {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};
export const safeTheme = value => (['operations', 'atelier', 'bridge'].includes(value) ? value : 'operations');

export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(local.toastTimer);
  local.toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

// Append-only: role=log/aria-live re-announces every node it receives, so rendered entries are never rebuilt.
export function renderLog() {
  const container = $('#coord-log'), last = container.lastElementChild?.logItem;
  if (!local.log.includes(last)) container.replaceChildren();
  if (!local.log.length) {
    const entry = one(container, 'div', 'log-entry');
    one(entry, 'strong', '', 'Coordenador local');
    one(entry, 'div', '', 'Crie uma tarefa ou salve uma decisão para iniciar o registro de ações.');
    one(entry, 'small', 'detail', 'Este log é da página atual.');
    return;
  }
  for (const item of local.log.slice(local.log.indexOf(last) + 1).slice(-30)) {
    const entry = one(container, 'div', 'log-entry');
    entry.logItem = item;
    const heading = one(entry, 'div', 'who');
    one(heading, 'span', '', item.who);
    const stamp = one(heading, 'time', '', time(item.at));
    stamp.dateTime = item.at;
    one(entry, 'div', '', item.text);
    if (item.detail) one(entry, 'small', 'detail', item.detail);
  }
  while (container.childElementCount > 30) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
}

export function log(who, text, detail = '') {
  local.log.push({ who, text, detail, at: new Date().toISOString() });
  if (local.log.length > 80) local.log.shift();
  renderLog();
}

function invalidateToken() {
  if (local.tokenInvalid) return;
  local.tokenInvalid = true;
  local.source?.close();
  $('#connection').dataset.state = 'error';
  $('#connection').textContent = 'Novo URL necessário';
  const message = 'Token local inválido. Abra o novo endereço exibido pelo servidor OmniForge.';
  toast(message);
  log('Conexão', message);
}

export async function api(path, { method = 'GET', body } = {}) {
  const options = { method, headers: { 'X-OmniForge-Token': authToken || '' } };
  if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  let response;
  try { response = await fetch(path, options); }
  catch { throw Error('Servidor local indisponível'); }
  let result;
  try { result = await response.json(); }
  catch { result = {}; }
  if (!response.ok) {
    if (response.status === 403) invalidateToken();
    const error = Error(response.status === 403 ? 'Token local inválido. Abra o novo endereço do servidor.' : result.error || result.message || `Falha HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

// The full state-refresh cycle (applyState, renderAll, ...) lives above this module; it is
// bound once at bootstrap so `action`/`connect` can trigger it without importing it.
let refresher = async () => {};
export function bindRefresher(fn) { refresher = fn; }
export function refreshState() { return refresher(); }

export async function action(path, body, success) {
  let result;
  try { result = await api(path, { method: 'POST', body }); }
  catch (error) { toast(error.message); log('Erro', error.message); return null; }
  if (success) log('Ação local', typeof success === 'function' ? success(result) : success);
  try { await refresher(); }
  catch (error) { const message = `Ação confirmada, mas a atualização da tela falhou: ${error.message}`; toast(message); log('Aviso', message); }
  return result;
}

export function connect({ onOpen, onTerminal, onState, onArsenal, onEvidence } = {}) {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(authToken || '')}`);
  local.source = source;
  source.onopen = () => {
    if (local.tokenInvalid) return;
    $('#connection').dataset.state = 'connected';
    $('#connection').textContent = 'Conectado';
    onOpen?.();
  };
  source.onerror = async () => {
    if (local.tokenInvalid) return;
    $('#connection').dataset.state = 'error';
    $('#connection').textContent = 'Reconectando';
    if (local.authProbePending) return;
    local.authProbePending = true;
    try { await refresher(); }
    catch { /* 403 is handled by api; network errors allow SSE retry */ }
    finally { local.authProbePending = false; }
  };
  source.addEventListener('terminal', event => {
    try { onTerminal?.(JSON.parse(event.data)); }
    catch { /* malformed or foreign events are ignored */ }
  });
  source.addEventListener('state', event => {
    try { onState?.(JSON.parse(event.data)); }
    catch { toast('Atualização de estado inválida.'); }
  });
  source.addEventListener('arsenal', event => {
    try { onArsenal?.(JSON.parse(event.data)); }
    catch { /* A later explicit refresh remains available. */ }
  });
  source.addEventListener('evidence', event => {
    try { onEvidence?.(JSON.parse(event.data)); }
    catch { /* The panel's refresh button remains available. */ }
  });
  return source;
}
