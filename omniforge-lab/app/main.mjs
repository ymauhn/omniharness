// Composition root: builds every panel and feature module, wires the page chrome that is not
// owned by any single view (theme, navigation, resize), and starts the state/SSE bootstrap.
// This is the only module that talks to the network and the real EventSource; every other
// app/*.mjs file exports a plain factory a test can import and drive on its own.
import { $ } from './dom.mjs';
import { local, api, toast, log, safeTheme, bindRefresher, connect, taskById } from './state.mjs';
import { createWorkspace } from './workspace.mjs';
import { createTasks } from './tasks.mjs';
import { createGraphs } from './graphs.mjs';
import { createAssets } from './assets.mjs';
import { createNavigation } from './navigation.mjs';
import { createReviewPanel } from './review-panel.mjs';
import { mountCopilot, mountCatalog } from '../copilot.mjs';
import { mountMemoryPanel } from '../memory-panel.mjs';
import { mountWorkflows } from '../workflow-panel.mjs';
import { createFleet } from './fleet.mjs';
import { mountExtensionsPanel } from '../extensions-panel.mjs';
import { mountUsagePanel } from '../usage-panel.mjs';

let nav; // assigned once every module below is built; callbacks only read it after that.

const getProjectId = () => local.projectId;
const openSkills = name => { $('#skill-search').value = name; catalog.search('installed'); nav.showView('skills'); };
const catalog = mountCatalog({ root: $('#skill-catalog'), search: $('#skill-search'), list: $('#skill-list'), count: $('#skills-count'), api, fallback: () => local.state.skills, getProjectId });
const copilot = mountCopilot({ root: $('#prompt-copilot'), draft: $('#coord-text'), api, getProjectId, getNotes: () => local.notes, openSkills });
const onMemoryChanged = () => { void refresh().catch(error => toast(error.message)); void graphs.loadMemory(); };
const memoryPanel = mountMemoryPanel({ root: $('#memory-list'), api, getProjectId, getSessions: () => local.state.sessions, onChanged: onMemoryChanged });
const onTasksCreated = async run => { log('Workflow', `Snapshot ${run.id}: tarefas criadas sem iniciar modelos.`); await refresh(); };
const workflows = mountWorkflows({ root: $('#workflow-panel'), api, getProjectId, draft: $('#coord-text'), onInsert: () => nav.showView('workspace'), onTasksCreated });
const extensionsPanel = mountExtensionsPanel({ root: $('#extensions-panel'), api, getProjectId, toast });
const usagePanel = mountUsagePanel({ root: $('#usage-panel'), api, toast });

const showView = view => nav.showView(view);
const workspace = createWorkspace({ renderAll: () => nav.renderAll(), loadMemory: () => graphs.loadMemory(), clearContext: () => graphs.clearContext(), showView, copilot });
// "Abrir terminal" on a run: its Lab session goes to the focused pane, like a session picked in the rail.
const openSession = id => {
  const index = workspace.layout.value.focus;
  if (!workspace.assignPane(index, id)) return;
  workspace.renderWorkspace(); showView('workspace');
  $('#terminal-grid').children[index]?.querySelector('.pane-select')?.focus();
};
const fleet = createFleet({ openSession, onChange: () => tasks.renderTasks() });
const reviewPanel = createReviewPanel({ root: $('#review-panel'), api, getProjectId, getTask: taskById, toast });
const tasks = createTasks({ showView, runControls: fleet.taskControls, reviewPanel });
const graphs = createGraphs({ assignPane: workspace.assignPane, renderWorkspace: workspace.renderWorkspace, catalog, memoryPanel, showView });
const assets = createAssets();
nav = createNavigation({ workspace, tasks, graphs, assets, catalog, copilot, workflows, fleet, extensionsPanel, usagePanel, memoryPanel, reviewPanel });

async function refresh() { nav.applyState(await api('/api/state')); }
bindRefresher(refresh);

$('#theme').addEventListener('change', event => {
  const theme = safeTheme(event.target.value);
  document.body.dataset.theme = theme;
  workspace.applyTheme();
  try { localStorage.setItem('omniforge-theme', theme); } catch { /* private mode or storage disabled */ }
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => nav.showView(button.dataset.view)));

let resizePending = false;
window.addEventListener('resize', () => {
  workspace.fitTerminals();
  if (local.view !== 'graphs' || resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => { resizePending = false; graphs.renderGraph(); });
});

try { const theme = safeTheme(localStorage.getItem('omniforge-theme')); document.body.dataset.theme = theme; $('#theme').value = theme; } catch { /* private mode or storage disabled */ }
log('Sistema', 'OmniForge Lab pronto para conectar ao serviço local.', 'PTY interativo quando disponível; nenhum agente iniciado.');
try { await refresh(); }
catch (error) { if (!local.tokenInvalid) { $('#connection').dataset.state = 'error'; $('#connection').textContent = 'Reconectando'; toast(error.message); } nav.renderAll(); }
if (!local.tokenInvalid) connect({
  // A reconnect may have missed agent events: the runs are read again.
  onOpen: () => { for (const id of local.paneSessions) if (id) workspace.replayTerminal(id); void fleet.load(); },
  onTerminal: payload => workspace.acceptTerminal(payload),
  onState: state => nav.applyState(state),
  onAgent: event => fleet.accept(event),
  onEvidence: event => reviewPanel.onEvidence(event),
});
