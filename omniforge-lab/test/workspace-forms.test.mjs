import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import './support/browser-globals.mjs';
import { local, bindRefresher } from '../app/state.mjs';
import { createWorkspace } from '../app/workspace.mjs';
import { createTasks } from '../app/tasks.mjs';
import { createGraphs } from '../app/graphs.mjs';
import { createAssets } from '../app/assets.mjs';

// Runs the page's real task, composer, memory and inventory handlers (tasks.mjs, workspace.mjs,
// graphs.mjs, assets.mjs) against a minimal DOM seam, wired together the way main.mjs wires them,
// with fetch (not action/api) as the mocked network boundary.
class Element {
  constructor(tag = 'div', className = '', text = '') {
    Object.assign(this, { tag, className, children: [], parent: null, events: {}, attributes: {}, dataset: {}, style: {}, value: '', disabled: false, hidden: false, scrollTop: 0, scrollHeight: 0, clientHeight: 0, _text: String(text) });
  }
  append(child) { child.parent = this; this.children.push(child); }
  replaceChildren() { for (const child of this.children) child.parent = null; this.children = []; this._text = ''; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  get childElementCount() { return this.children.length; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  set innerHTML(_value) { throw Error('Page text must be rendered without HTML injection'); }
  get selectedOptions() { return []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  fire(name) { return Promise.all((this.events[name] || []).map(callback => callback({ currentTarget: this, target: this, preventDefault() {} }))); }
  focus() { doc.activeElement = this; }
  contains(node) { for (let item = node; item; item = item.parent) if (item === this) return true; return false; }
  find(match) { for (const child of this.children) { if (match(child)) return child; const found = child.find(match); if (found) return found; } return null; }
  querySelector(selector) { return this.find(node => node.tag === selector.match(/^[a-z]+/)[0]); }
  querySelectorAll() { return []; }
}
let doc;
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };

function environment() {
  const ids = new Map(), requests = [], calls = [];
  const $ = selector => { if (!ids.has(selector)) ids.set(selector, new Element()); return ids.get(selector); };
  doc = { activeElement: null, createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), querySelectorAll: () => [], querySelector: $, body: { dataset: {} } };
  globalThis.document = doc;
  const env = { $, requests, calls };
  const form = (selector, fields) => {
    const element = $(selector);
    element.tag = 'form'; element.elements = Object.fromEntries(fields.map(name => [name, { value: '' }])); element.append(new Element('button'));
    element.reset = () => { for (const field of Object.values(element.elements)) field.value = ''; };
  };
  form('#task-form', ['title']); form('#coord-form', ['text', 'action']); form('#memory-form', ['scope', 'sessionId', 'source', 'text']);
  Object.assign(local, {
    projectId: 'p', state: { projects: [{ id: 'p' }, { id: 'q' }], sessions: [], tasks: [], skills: [], layout: { split: 50 } },
    notes: [], memoryRevision: null, inventory: null, inventoryProjectId: null, inventoryRequest: 0, view: 'workspace', graph: 'knowledge',
  });
  env.respond = async () => ({ ok: true, status: 200, json: async () => ({ id: 'created' }) });
  globalThis.fetch = (path, options) => {
    requests.push({ path, body: options?.body ? JSON.parse(options.body) : undefined });
    return env.respond();
  };
  bindRefresher(async () => { calls.push('refresh'); });

  const showView = view => calls.push(['view', view]);
  const copilot = { revision: () => 1, sync() {} };
  const catalog = { search() {}, sync() {}, load() {} };
  const memoryPanel = { load() {}, sync() {} };
  const workspace = createWorkspace({ renderAll: () => calls.push('render'), loadMemory: () => calls.push('memory'), clearContext() {}, showView, copilot, storage: { getItem: () => null, setItem() {} } });
  const tasks = createTasks({ showView, arsenal: { focusTask() {} } });
  const graphs = createGraphs({ assignPane: workspace.assignPane, renderWorkspace: workspace.renderWorkspace, catalog, memoryPanel, showView });
  const assets = createAssets();
  return Object.assign(env, { workspace, tasks, graphs, assets });
}

test('task, composer and memory forms send one request while the first submit is in flight', async () => {
  const env = environment();
  const fills = {
    '#task-form': form => { form.elements.title.value = 'Corrigir referência'; },
    '#coord-form': form => { form.elements.text.value = 'Revisar referências'; form.elements.action.value = 'task'; },
    '#memory-form': form => { Object.assign(form.elements, { scope: { value: 'project' }, source: { value: 'manual' }, text: { value: 'Nota' } }); },
  };
  for (const [selector, fill] of Object.entries(fills)) {
    const form = env.$(selector), pending = deferred();
    fill(form); env.respond = () => pending.promise.then(value => ({ ok: true, status: 200, json: async () => value })); env.requests.length = 0;
    const first = form.fire('submit'), second = form.fire('submit');
    await tick();
    assert.equal(env.requests.length, 1, `${selector} must not submit twice`);
    assert.equal(form.querySelector('button').disabled, true);
    pending.resolve({ id: 'created' });
    await Promise.all([first, second]);
    assert.equal(form.querySelector('button').disabled, false);
  }
});

test('composer turns a long draft into a bounded first-line title and keeps the full draft as task details', async () => {
  const env = environment(), form = env.$('#coord-form');
  const draft = `\n  Revisar referências dos assets  \n${'Contexto citado pelo Copilot. '.repeat(40)}`;
  Object.assign(form.elements, { text: { value: draft }, action: { value: 'task' } });
  await form.fire('submit');
  assert.equal(env.requests[0].path, '/api/tasks');
  assert.equal(env.requests[0].body.title, 'Revisar referências dos assets');
  assert.equal(env.requests[0].body.details, draft.trim());
  Object.assign(form.elements, { text: { value: 'x'.repeat(300) }, action: { value: 'task' } });
  await form.fire('submit');
  assert.equal(env.requests[1].body.title.length, 240);
  assert.equal(env.requests[1].body.details.length, 300);
  Object.assign(form.elements, { text: { value: 'Curto' }, action: { value: 'task' } });
  await form.fire('submit');
  assert.equal(env.requests[2].body.title, 'Curto');
  assert.equal(env.requests[2].body.details, undefined);
});

test('task status select sends its revision, restores and refreshes after a conflict, and loads details as text on open', async () => {
  const env = environment();
  local.state.tasks = [{ id: 't1', projectId: 'p', title: 'Race', dependsOn: [], status: 'open', revision: 3, hasDetails: true }];
  env.tasks.renderTasks();
  const list = env.$('#task-list'), select = list.find(node => node.tag === 'select');
  env.respond = async () => ({ ok: false, status: 409, json: async () => ({ error: 'conflito' }) });
  select.value = 'blocked';
  await select.fire('change');
  assert.equal(env.requests[0].body.expectedRevision, 3);
  assert.equal(select.value, 'open');
  assert.ok(env.calls.includes('refresh'));
  const more = list.find(node => node.tag === 'details');
  const detailsFetches = env.requests.filter(request => request.path.endsWith('/details'));
  assert.deepEqual(detailsFetches, [], 'details load only when opened');
  env.requests.length = 0;
  env.respond = async () => ({ ok: true, status: 200, json: async () => ({ id: 't1', details: 'Race\n<b>Contexto completo</b>' }) });
  more.open = true;
  await more.fire('toggle');
  await more.fire('toggle');
  assert.deepEqual(env.requests.map(request => request.path), ['/api/tasks/t1/details'], 'a second toggle does not refetch');
  assert.match(list.textContent, /<b>Contexto completo<\/b>/);
});

test('asset inventory applies only the latest request for the current project and reports skipped folders', async () => {
  const env = environment(), first = deferred(), second = deferred(), button = env.$('#refresh-assets');
  const queue = [first.promise, second.promise];
  env.respond = () => queue.shift().then(value => ({ ok: true, status: 200, json: async () => value }));
  const a = env.assets.loadInventory();
  assert.equal(button.disabled, true);
  local.projectId = 'q';
  const b = env.assets.loadInventory();
  second.resolve({ files: ['b.png'], unreadableDirectories: 2 });
  await b;
  first.reject(Error('Falha do projeto anterior'));
  await a;
  assert.equal(local.inventoryProjectId, 'q');
  assert.deepEqual([...local.inventory.files], ['b.png']);
  assert.equal(env.$('#toast').textContent, 'Inventário parcial: 2 pastas sem leitura ignoradas.');
  assert.equal(button.disabled, false);
});
