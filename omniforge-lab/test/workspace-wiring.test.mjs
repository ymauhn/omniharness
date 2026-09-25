import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Executes actual page coordination functions, without a browser or renderer.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = (from, to) => html.slice(html.indexOf(from), html.indexOf(to));
function environment() {
  const calls = [], context = { childElementCount: 0 }, local = { projectId: 'a', memoryProjectId: 'a', memoryRevision: 7, workflowRevision: 3, state: { projects: [{ id: 'a' }] } };
  const ctx = vm.createContext({
    local, $: () => context, asArray: value => Array.isArray(value) ? value : [],
    projectById: id => local.state.projects.find(project => project.id === id),
    seedPending: false, windowSeed: new URLSearchParams(), terminalLayout: {},
    clearContext() {}, reconcilePanes() {}, renderAll: () => calls.push('render'), loadMemory: () => calls.push('memory'),
    workflows: { load: () => calls.push('workflows') }, memoryPanel: { load: () => calls.push('memory-panel') },
    renderGraph: () => calls.push('graph'), loadInventory() {}, catalog: { load() {} }, fitTerminals() {}, copilot: { deactivate() {} },
    document: { querySelectorAll: () => [] },
  });
  vm.runInContext(block('    function applyState(', '    function connect()') + block('    function showView(', '    function renderAll()'), ctx);
  return { ctx, local, calls };
}

test('shared state refreshes workflow library only on changed revision within the same project', () => {
  const { ctx, local, calls } = environment();
  const state = { projects: [{ id: 'a' }], memoryRevision: 7, workflowRevision: 4 };
  ctx.applyState(state);
  assert.equal(calls.filter(value => value === 'workflows').length, 1);
  assert.equal(local.workflowRevision, 4);
  ctx.applyState(state);
  assert.equal(calls.filter(value => value === 'workflows').length, 1, 'unrelated state must not refetch library or touch drafts');
  ctx.applyState({ ...state, projects: [{ id: 'b' }], workflowRevision: 5 });
  assert.equal(local.projectId, 'b');
  assert.equal(calls.filter(value => value === 'workflows').length, 1, 'project sync owns its own scoped load');
});

test('navigation opens saved workflows and refreshes scoped memory controls', () => {
  const { ctx, local, calls } = environment();
  ctx.showView('workflows'); assert.equal(local.view, 'workflows');
  assert.ok(calls.includes('workflows'));
  ctx.showView('graphs'); assert.ok(calls.includes('memory-panel'));
  ctx.showView('unknown'); assert.equal(local.view, 'graphs');
});
