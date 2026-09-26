// Cross-view wiring: applying a fresh /api/state snapshot, the full re-render sweep, and
// switching the visible view. Depends on every feature module and the existing panels, so it
// takes them all as an explicit, injected surface instead of importing them (no cycles).
import { $, asArray } from './dom.mjs';
import { local, projectById } from './state.mjs';

const VIEWS = ['workspace', 'tasks', 'workflows', 'fleet', 'graphs', 'skills', 'assets', 'usage'];

export function createNavigation({ workspace, tasks, graphs, assets, catalog, copilot, workflows, fleet, extensionsPanel, usagePanel, memoryPanel }) {
  function renderSkills() { catalog.sync(); if (local.view === 'skills') catalog.load(); }

  function renderAll() {
    copilot.sync(); workflows.sync(); fleet.sync();
    if (local.view === 'assets') extensionsPanel.sync();
    workspace.renderSidebar(); workspace.renderWorkspace(); tasks.renderTasks(); graphs.renderMemory(); renderSkills(); assets.renderAssets(); graphs.renderGraph();
    const project = projectById(local.projectId);
    $('#top-context').textContent = project ? `Projeto: ${project.name}  /  ${project.root}` : 'Adicione uma pasta de projeto para começar';
    $('#workspace-scope').textContent = project ? `${project.name} · ${project.root}` : 'Nenhum projeto selecionado';
    $('#coord-scope').textContent = project ? `Ações no projeto ${project.name}` : 'Selecione um projeto';
  }

  function showView(view) {
    if (!VIEWS.includes(view)) return;
    if (view === 'assets') void extensionsPanel.load();
    if (view === 'usage') void usagePanel.load();
    const leavingGraph = local.view === 'graphs' && view !== 'graphs';
    local.view = view;
    if (leavingGraph) graphs.resetGraphHelp();
    document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `view-${view}`; });
    document.querySelectorAll('[data-view]').forEach(el => { el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
    if (view === 'assets' && local.projectId !== local.inventoryProjectId) assets.loadInventory();
    if (view === 'graphs') { if (local.graph === 'capability') void graphs.loadCapabilities(); graphs.renderGraph(); graphs.loadMemory(); memoryPanel.load(); }
    if (view === 'skills') catalog.load();
    if (view === 'workflows') workflows.load();
    if (view === 'fleet') void fleet.load();
    if (view === 'workspace') workspace.fitTerminals(); else copilot.deactivate();
  }

  function applyState(state) {
    const previousProjectId = local.projectId, previousMemoryRevision = local.memoryRevision, previousWorkflowRevision = local.workflowRevision;
    const contextWasShown = $('#context-list').childElementCount > 0;
    local.memoryRevision = Number.isSafeInteger(state.memoryRevision) ? state.memoryRevision : null;
    local.workflowRevision = Number.isSafeInteger(state.workflowRevision) ? state.workflowRevision : null;
    local.state = { projects: asArray(state.projects), sessions: asArray(state.sessions), tasks: asArray(state.tasks), skills: asArray(state.skills), layout: state.layout || { split: 50 } };
    if (!projectById(local.projectId)) local.projectId = local.state.projects.find(p => p.id === workspace.seededProjectId())?.id || local.state.projects[0]?.id || null;
    if (local.projectId !== previousProjectId) graphs.clearContext();
    workspace.reconcilePanes();
    if (local.memoryProjectId !== local.projectId || local.memoryRevision !== previousMemoryRevision) { local.notes = []; graphs.loadMemory(); }
    renderAll();
    if (local.projectId === previousProjectId && local.workflowRevision !== previousWorkflowRevision) void workflows.load();
    if (contextWasShown && local.projectId === previousProjectId && local.memoryRevision !== previousMemoryRevision && $('#context-session').value) $('#load-context').click();
  }

  return { applyState, renderAll, showView };
}
