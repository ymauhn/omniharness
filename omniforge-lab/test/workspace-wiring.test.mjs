import test from 'node:test';
import assert from 'node:assert/strict';
import './support/browser-globals.mjs';
import { local } from '../app/state.mjs';
import { createNavigation } from '../app/navigation.mjs';

// Executes the real applyState/showView coordination functions (navigation.mjs) against fake
// feature-module and panel dependencies, without a browser or renderer.
function environment() {
  const calls = [], context = { childElementCount: 0 };
  globalThis.document = { querySelectorAll: () => [], querySelector: () => context };
  Object.assign(local, {
    projectId: 'a', memoryProjectId: 'a', memoryRevision: 7, workflowRevision: 3, view: 'workspace', graph: 'knowledge', inventoryProjectId: null,
    state: { projects: [{ id: 'a' }], sessions: [], tasks: [], skills: [], layout: { split: 50 } }, notes: [],
  });
  const workspace = {
    seededProjectId: () => null, reconcilePanes() {}, renderSidebar() {}, renderWorkspace() {}, fitTerminals() {},
  };
  const tasks = { renderTasks() {} };
  const graphs = {
    clearContext() {}, loadMemory: () => calls.push('memory'), renderMemory() {}, renderGraph: () => calls.push('graph'),
    loadCapabilities() {}, resetGraphHelp() {},
  };
  const assets = { loadInventory() {}, renderAssets() {} };
  const catalog = { sync() {}, load() {}, search() {} };
  const copilot = { sync() {}, deactivate() {} };
  const workflows = { sync() {}, load: () => calls.push('workflows') };
  const fleet = { sync() {}, load: () => calls.push('fleet') };
  const extensionsPanel = { sync() {}, load() {} };
  const usagePanel = { load() {} };
  const memoryPanel = { load: () => calls.push('memory-panel') };
  const reviewPanel = { sync() {} };
  const nav = createNavigation({ workspace, tasks, graphs, assets, catalog, copilot, workflows, fleet, extensionsPanel, usagePanel, memoryPanel, reviewPanel });
  return { nav, local, calls };
}

test('shared state refreshes workflow library only on changed revision within the same project', () => {
  const { nav, local, calls } = environment();
  const state = { projects: [{ id: 'a' }], memoryRevision: 7, workflowRevision: 4 };
  nav.applyState(state);
  assert.equal(calls.filter(value => value === 'workflows').length, 1);
  assert.equal(local.workflowRevision, 4);
  nav.applyState(state);
  assert.equal(calls.filter(value => value === 'workflows').length, 1, 'unrelated state must not refetch library or touch drafts');
  nav.applyState({ ...state, projects: [{ id: 'b' }], workflowRevision: 5 });
  assert.equal(local.projectId, 'b');
  assert.equal(calls.filter(value => value === 'workflows').length, 1, 'project sync owns its own scoped load');
});

test('navigation opens saved workflows and refreshes scoped memory controls', () => {
  const { nav, local, calls } = environment();
  nav.showView('workflows'); assert.equal(local.view, 'workflows');
  assert.ok(calls.includes('workflows'));
  nav.showView('graphs'); assert.ok(calls.includes('memory-panel'));
  nav.showView('fleet'); assert.ok(calls.includes('fleet'), 'entering Agentes reloads the runs');
  nav.showView('arsenal'); assert.equal(local.view, 'fleet', 'the Arsenal view is cut from the page');
  nav.showView('unknown'); assert.equal(local.view, 'fleet');
});
