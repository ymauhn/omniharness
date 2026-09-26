import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowLayout, insertWorkflowPrompt, WorkflowRequests, mountWorkflows } from '../workflow-panel.mjs';
import { workflowPresets } from '../workflows.mjs';

test('DAG layout shows fan-in after its prerequisites without collapsing parallel nodes', () => {
  const nodes = [{ id: 'review', dependsOn: ['test', 'audit'] }, { id: 'test', dependsOn: [] }, { id: 'audit', dependsOn: [] }];
  const layout = workflowLayout(nodes), positions = new Map(layout.positions.map(node => [node.id, node]));
  assert.equal(layout.edges.length, 2);
  assert.ok(positions.get('review').x > positions.get('test').x);
  assert.equal(positions.get('test').x, positions.get('audit').x);
  assert.notEqual(positions.get('test').y, positions.get('audit').y);
  assert.throws(() => workflowLayout([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]));
  assert.throws(() => workflowLayout([{ id: 'a', dependsOn: ['missing'] }]));
});

test('prompt insertion preserves existing draft, notifies Copilot input and refuses stale project or overflow', () => {
  let project = 'a', inputs = 0, focused = false, notified = 0;
  const draft = { value: 'Original', maxLength: 30, dispatchEvent: event => { assert.equal(event.type, 'input'); inputs++; }, focus: () => focused = true };
  const options = { draft, prompt: 'Next 🤖', expectedProjectId: 'a', getProjectId: () => project, notify: () => notified++ };
  assert.equal(insertWorkflowPrompt(options), 'Original\n\nNext 🤖');
  assert.equal(inputs, 1); assert.equal(focused, true); assert.equal(notified, 1);
  project = 'b'; assert.throws(() => insertWorkflowPrompt(options), /projeto/);
  project = 'a'; assert.throws(() => insertWorkflowPrompt({ ...options, prompt: 'x'.repeat(30) }), /limite/);
  assert.equal(draft.value, 'Original\n\nNext 🤖'); assert.equal(inputs, 1);
});

test('request epoch rejects edit-selection and A to B to A project races', () => {
  let project = 'a'; const requests = new WorkflowRequests(() => project), old = requests.capture();
  project = 'b'; requests.sync(); project = 'a'; requests.sync();
  assert.equal(old.current(), false);
  const newer = requests.capture(); requests.invalidate(); assert.equal(newer.current(), false);
  assert.equal(requests.capture().current(), true);
});

// Node-only DOM seam. This exercises the actual controller; not visual evidence.
function stubDocument() {
  const doc = {};
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.parent = null; this._text = ''; this.attributes = {}; this.style = {}; this.classList = { add: value => this.className = value }; }
    append(child) { child.parent = this; this.children.push(child); }
    contains(element) { return this === element || this.children.some(child => child.contains(element)); }
    replaceChildren() { if (this.children.some(child => child.contains(doc.activeElement))) doc.activeElement = doc.body; this.children.forEach(child => child.parent = null); this.children = []; this._text = ''; }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, action) { (this.events[name] ??= []).push(action); }
    dispatchEvent(event) { return Promise.all((this.events[event.type] ?? []).map(action => action(event))); }
    click() { if (this.disabled) return Promise.resolve(); this.focus(); return this.dispatchEvent({ type: 'click', target: this }); }
    focus() { doc.activeElement = this; }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tagName === tag.toUpperCase() ? [child] : []), ...child.querySelectorAll(tag)]); }
    querySelector(tag) { return this.querySelectorAll(tag)[0] ?? null; }
  }
  doc.createElement = tag => new Element(tag); doc.createElementNS = (_, tag) => new Element(tag); doc.body = new Element('body'); doc.activeElement = doc.body;
  return doc;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const findButton = (root, text) => root.querySelectorAll('button').find(button => button.textContent.startsWith(text));

function ui(t, api, getProjectId = () => 'a', extra = {}) {
  const previous = globalThis.document, doc = stubDocument(); globalThis.document = doc;
  const root = doc.createElement('section'), draft = doc.createElement('textarea'); draft.value = 'Existing'; draft.maxLength = 4000;
  doc.body.append(root); doc.body.append(draft);
  const controller = mountWorkflows({ root, api, getProjectId, draft, ...extra });
  t.after(() => { controller.destroy(); globalThis.document = previous; });
  return { root, draft, controller, doc };
}

test('actual UI separates suggested drafts from saved task actions and inserts only on explicit request', async t => {
  const preset = workflowPresets()[0], calls = []; let saved = null, copied = '', created = null;
  const api = async (url, options) => {
    calls.push([url, options]);
    if (url.startsWith('/api/workflows/presets')) return { projectId: 'a', rows: [preset] };
    if (url === '/api/workflows' && options?.method === 'POST') return saved = { id: 'w1', projectId: 'a', revision: 1, version: 1, archivedAt: null, definition: options.body.definition };
    if (url.endsWith('/tasks')) return { id: 'run1', taskIds: { 'step-1': 't1' } };
    return { projectId: 'a', rows: saved ? [saved] : [], runs: [] };
  };
  const { root, draft, doc } = ui(t, api, undefined, { clipboard: async text => copied = text, onTasksCreated: run => created = run });
  await tick(); await findButton(root, 'Do bug').click();
  assert.equal(findButton(root, 'Criar 1 tarefa').disabled, true);
  assert.equal(calls.filter(([, options]) => options?.method === 'POST').length, 0);
  await findButton(root, 'Copiar prompt').click(); assert.equal(copied, preset.definition.nodes[0].prompt);
  await findButton(root, 'Inserir no chat').click(); assert.equal(draft.value, `Existing\n\n${preset.definition.nodes[0].prompt}`);
  await findButton(root, 'Salvar no projeto').click(); assert.match(root.textContent, /marque a confirmação/);
  root.querySelectorAll('input').find(input => input.type === 'checkbox').checked = true;
  await findButton(root, 'Salvar no projeto').click(); await tick();
  assert.equal(findButton(root, 'Criar 1 tarefa').disabled, false);
  assert.equal(doc.activeElement.tagName, 'H2', 'save restores focus outside replaced form');
  await findButton(root, 'Criar 1 tarefa').click();
  assert.equal(created.id, 'run1');
  assert.ok(calls.find(([url]) => url.endsWith('/tasks'))[1].body.requestId);
  assert.equal(calls.filter(([url]) => /dispatch|command|classify|enable/.test(url)).length, 0);
});

test('late response from an old project cannot repopulate saved workflows in another project', async t => {
  let project = 'a', resolve;
  const old = new Promise(yes => resolve = yes);
  const api = url => {
    const requested = new URL(`http://localhost${url}`).searchParams.get('projectId');
    if (url.includes('/presets')) return Promise.resolve({ projectId: requested, rows: [] });
    if (requested === 'a') return old;
    return Promise.resolve({ projectId: 'b', rows: [], runs: [] });
  };
  const { root, controller } = ui(t, api, () => project);
  project = 'b'; controller.sync(); await tick();
  resolve({ projectId: 'a', rows: [{ id: 'private', definition: { title: 'PRIVATE_A' } }], runs: [] }); await tick();
  assert.equal(root.textContent.includes('PRIVATE_A'), false);
  assert.match(root.textContent, /0 workflows salvos/);
});

test('task response loss retries the same request identity and draft edits disable task creation', async t => {
  const value = workflowPresets()[0].definition, ids = []; let attempts = 0;
  const row = { id: 'w1', projectId: 'a', version: 1, revision: 1, archivedAt: null, definition: value };
  const api = async (url, options) => {
    if (url.endsWith('/tasks')) { ids.push(options.body.requestId); if (++attempts === 1) throw Error('private raw backend details'); return { id: 'run', taskIds: { 'step-1': 't' } }; }
    return { projectId: 'a', rows: url.includes('/presets') ? [] : [row], runs: [] };
  };
  const { root } = ui(t, api); await tick(); await findButton(root, value.title).click();
  await findButton(root, 'Criar 1 tarefa').click(); assert.doesNotMatch(root.textContent, /private raw/);
  await findButton(root, 'Criar 1 tarefa').click(); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  const prompt = root.querySelectorAll('textarea').find(node => node.value === value.nodes[0].prompt); prompt.value = 'Unsaved revision'; await prompt.dispatchEvent({ type: 'input' });
  assert.equal(findButton(root, 'Criar 1 tarefa').disabled, true);
});

test('a pending old-project mutation cannot block or unlock a new project mutation', async t => {
  let project = 'a', finishA, finishB;
  const pendingA = new Promise(resolve => finishA = resolve), pendingB = new Promise(resolve => finishB = resolve);
  const value = workflowPresets()[0].definition, requests = [];
  const api = async (url, options) => {
    const selected = options?.body?.projectId ?? new URL(url, 'http://local').searchParams.get('projectId');
    if (options) { requests.push(selected); return selected === 'a' ? pendingA : pendingB; }
    return { projectId: selected, rows: url.includes('/presets') ? [] : [{ id: `w-${selected}`, projectId: selected, version: 1, revision: 1, archivedAt: null, definition: value }], runs: [] };
  };
  const { root, controller } = ui(t, api, () => project);
  await tick(); await findButton(root, value.title).click();
  const first = findButton(root, 'Criar 1 tarefa').click();
  project = 'b'; controller.sync(); await tick(); await findButton(root, value.title).click();
  const secondButton = findButton(root, 'Criar 1 tarefa');
  assert.ok(secondButton, 'new project remains usable during the old request');
  const second = secondButton.click();
  assert.deepEqual(requests, ['a', 'b']);
  finishA({ id: 'a-run', taskIds: { a: 'a-task' } }); await first;
  await secondButton.click(); assert.deepEqual(requests, ['a', 'b'], 'old completion must not unlock the new submission');
  finishB({ id: 'b-run', taskIds: { b: 'b-task' } }); await second;
});

test('archive freezes the displayed version until its result is known', async t => {
  const value = workflowPresets()[0].definition;
  const row = { id: 'w1', projectId: 'a', version: 1, revision: 1, archivedAt: null, definition: value };
  let finish;
  const pending = new Promise(resolve => finish = resolve);
  const { root } = ui(t, async (url, options) => options ? pending : { projectId: 'a', rows: url.includes('/presets') ? [] : [row], runs: [] });
  await tick(); await findButton(root, value.title).click();
  const archived = findButton(root, 'Arquivar fluxo').click();
  assert.ok(root.querySelectorAll('textarea').every(field => field.disabled));
  finish({ ...row, revision: 2, archivedAt: 'now' }); await archived;
  assert.ok(root.querySelectorAll('textarea').every(field => field.disabled));
  assert.equal(root.querySelectorAll('textarea').some(field => field.value === value.nodes[0].prompt), true);
});

test('completing a node request preserves another selected node and permits a deliberate new run', async t => {
  const value = workflowPresets()[0].definition, ids = [];
  const row = { id: 'w1', projectId: 'a', version: 1, revision: 1, archivedAt: null, definition: value };
  let finish;
  const pending = new Promise(resolve => finish = resolve);
  const api = async (url, options) => {
    if (options) { ids.push(options.body.requestId); return ids.length === 1 ? pending : { id: 'next', taskIds: { 'step-1': 't2' } }; }
    return { projectId: 'a', rows: url.includes('/presets') ? [] : [row], runs: [] };
  };
  const { root } = ui(t, api); await tick(); await findButton(root, value.title).click();
  const creating = findButton(root, 'Criar 1 tarefa').click();
  await root.querySelectorAll('button').find(node => node.className === 'wf-node' && node.textContent.includes('step-2')).click();
  finish({ id: 'first', taskIds: { 'step-1': 't1' } }); await creating;
  assert.equal(findButton(root, 'Criar 2 tarefas').disabled, false, 'node A completion must not disable B');
  await root.querySelectorAll('button').find(node => node.className === 'wf-node' && node.textContent.includes('step-1')).click();
  await findButton(root, 'Criar 1 tarefa').click();
  assert.equal(ids.length, 2); assert.notEqual(ids[0], ids[1], 'confirmed run retires its retry identity');
});

test('an uncertain task request preserves its identity across project switches', async t => {
  let project = 'a'; const value = workflowPresets()[0].definition, ids = [];
  const api = async (url, options) => {
    if (options) { ids.push(options.body.requestId); throw Error('response lost'); }
    const requested = new URL(url, 'http://local').searchParams.get('projectId');
    return { projectId: requested, rows: url.includes('/presets') ? [] : [{ id: 'w1', projectId: requested, version: 1, revision: 1, archivedAt: null, definition: value }], runs: [] };
  };
  const { root, controller } = ui(t, api, () => project); await tick(); await findButton(root, value.title).click();
  await findButton(root, 'Criar 1 tarefa').click();
  project = 'b'; controller.sync(); await tick(); project = 'a'; controller.sync(); await tick();
  await findButton(root, value.title).click(); await findButton(root, 'Criar 1 tarefa').click();
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
});

test('a revision conflict keeps the draft and offers a reviewed save on top of the current version', async t => {
  const value = workflowPresets()[0].definition, saves = [];
  let server = { id: 'w1', projectId: 'a', version: 1, revision: 1, archivedAt: null, definition: value }, created;
  const api = async (url, options) => {
    if (url === '/api/workflows' && options) return created = { ...server, id: 'w2', version: 1, revision: 1, archivedAt: null, definition: options.body.definition };
    if (url.endsWith('/update')) {
      saves.push(options.body.expectedRevision);
      if (options.body.expectedRevision !== server.revision) throw Object.assign(Error('Workflow alterado; recarregue antes de continuar'), { status: 409 });
      return server = { ...server, version: server.version + 1, revision: server.revision + 1, definition: options.body.definition };
    }
    return { projectId: 'a', rows: url.includes('/presets') ? [] : [server], runs: [] };
  };
  const { root } = ui(t, api); await tick(); await findButton(root, value.title).click();
  const prompt = root.querySelectorAll('textarea').find(node => node.value === value.nodes[0].prompt); prompt.value = 'Draft edit'; await prompt.dispatchEvent({ type: 'input' });
  server = { ...server, version: 2, revision: 2, definition: { ...value, title: 'Other window' } };
  const review = () => root.querySelectorAll('input').find(input => input.type === 'checkbox');
  review().checked = true; await findButton(root, 'Salvar nova versão').click();
  assert.deepEqual(saves, [1]); assert.match(root.textContent, /versão 2/);
  await findButton(root, 'Salvar rascunho sobre a versão 2').click();
  assert.equal(!!review().checked, false, 'the rebased draft needs a fresh review');
  assert.ok(root.querySelectorAll('textarea').some(node => node.value === 'Draft edit'), 'draft kept');
  await findButton(root, 'Salvar nova versão').click(); assert.deepEqual(saves, [1], 'no save without the review confirmation');
  review().checked = true; await findButton(root, 'Salvar nova versão').click();
  assert.deepEqual(saves, [1, 2]); assert.equal(server.version, 3); assert.equal(server.definition.nodes[0].prompt, 'Draft edit');
  const again = root.querySelectorAll('textarea').find(node => node.value === 'Draft edit'); again.value = 'After archive'; await again.dispatchEvent({ type: 'input' });
  server = { ...server, revision: 4, archivedAt: 'now' };
  review().checked = true; await findButton(root, 'Salvar nova versão').click(); assert.match(root.textContent, /arquivou/);
  await findButton(root, 'Salvar rascunho como novo workflow').click();
  review().checked = true; await findButton(root, 'Salvar no projeto').click();
  assert.equal(created.definition.nodes[0].prompt, 'After archive'); assert.deepEqual(saves, [1, 2, 3]);
});

test('capacity limits show their own server message instead of a revision conflict', async t => {
  const value = workflowPresets()[0].definition, row = { id: 'w1', projectId: 'a', version: 1, revision: 1, archivedAt: null, definition: value };
  const api = async (url, options) => {
    if (options) throw Object.assign(Error('Limite de 256 snapshots de tarefas neste projeto atingido; nada foi salvo'), { status: 507 });
    return { projectId: 'a', rows: url.includes('/presets') ? [] : [row], runs: [] };
  };
  const { root } = ui(t, api); await tick(); await findButton(root, value.title).click();
  await findButton(root, 'Criar 1 tarefa').click();
  assert.match(root.textContent, /Limite de 256 snapshots/); assert.doesNotMatch(root.textContent, /mudou/);
});

test('a step can be removed and its dependents keep the remaining chain', async t => {
  const preset = workflowPresets()[0]; let body;
  const api = async (url, options) => {
    if (options) { body = options.body; return { id: 'w1', projectId: 'a', revision: 1, version: 1, archivedAt: null, definition: options.body.definition }; }
    return { projectId: 'a', rows: url.includes('/presets') ? [preset] : [], runs: [] };
  };
  const { root } = ui(t, api); await tick(); await findButton(root, 'Do bug').click();
  const node = id => root.querySelectorAll('button').find(item => item.className === 'wf-node' && item.textContent.includes(id));
  await node('step-2').click(); await findButton(root, 'Remover etapa').click();
  assert.equal(node('step-2'), undefined);
  root.querySelectorAll('input').find(input => input.type === 'checkbox').checked = true;
  await findButton(root, 'Salvar no projeto').click();
  assert.deepEqual(body.definition.nodes.map(item => [item.id, item.dependsOn]), [['step-1', []], ['step-3', ['step-1']]]);
  await node('step-3').click(); await findButton(root, 'Remover etapa').click();
  assert.equal(findButton(root, 'Remover etapa').disabled, true, 'the last step stays');
});

test('delayed workflow history preserves focus after the user returns to the composer', async t => {
  const definition = workflowPresets()[0].definition;
  const row = { id: 'w1', projectId: 'a', version: 1, revision: 1, archivedAt: null, definition };
  let finish;
  const pending = new Promise(resolve => finish = resolve);
  const { root, draft, doc } = ui(t, async url => url.startsWith('/api/workflows/w1?') ? pending : { projectId: 'a', rows: url.includes('/presets') ? [] : [row], runs: [] });
  await tick(); await findButton(root, definition.title).click();
  const loading = findButton(root, 'Ver versões e tarefas').click();
  draft.focus(); finish({ workflow: { revisions: [] }, runs: [] }); await loading;
  assert.equal(doc.activeElement, draft, 'history must not interrupt typing elsewhere');
  await findButton(root, 'Ver versões e tarefas').click();
  assert.equal(doc.activeElement.tagName, 'SUMMARY', 'explicit action still focuses its loaded history');
});
