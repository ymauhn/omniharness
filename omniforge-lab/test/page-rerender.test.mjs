import test from 'node:test';
import assert from 'node:assert/strict';
import './support/browser-globals.mjs';
import { local, renderLog } from '../app/state.mjs';
import { createWorkspace } from '../app/workspace.mjs';
import { createTasks } from '../app/tasks.mjs';
import { createFleet } from '../app/fleet.mjs';

// Runs the page's real sidebar, task list and coordination log renderers (workspace.mjs, tasks.mjs, fleet.mjs,
// state.mjs) against a minimal DOM seam: an SSE state event re-renders them, and the user's choice,
// keyboard focus and log nodes must survive. `local` is the one real shared module singleton, so each
// environment() resets every field a test touches instead of relying on a fresh module instance.
class Element {
  constructor(tag = 'div', className = '', text = '') {
    Object.assign(this, { tag, className, children: [], parent: null, dataset: {}, events: {}, attributes: {}, style: {}, value: '', hidden: false, scrollTop: 0, scrollHeight: 0, _text: String(text) });
  }
  append(child) { child.parent = this; this.children.push(child); }
  replaceChildren() { for (const child of this.children) child.parent = null; this.children = []; this._text = ''; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get selectedOptions() { return []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  fire(name) { return Promise.all((this.events[name] || []).map(callback => callback({ currentTarget: this, target: this, preventDefault() {} }))); }
  focus() { doc.activeElement = this; }
  contains(node) { for (let item = node; item; item = item.parent) if (item === this) return true; return false; }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector) { return this.descendants().filter(node => selector === '[data-focus-key]' ? 'focusKey' in node.dataset : selector.split(',').includes(node.tag)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
let doc;
function environment() {
  const ids = new Map();
  const $ = selector => { if (!ids.has(selector)) ids.set(selector, new Element()); return ids.get(selector); };
  doc = { activeElement: null, createElement: tag => new Element(tag), querySelectorAll: () => [], querySelector: $ };
  globalThis.document = doc;
  $('#session-form').hidden = true; $('#session-form').append($('#session-project')); $('#session-project').tag = 'select';
  $('#task-form').append(new Element('button'));

  Object.assign(local, {
    projectId: 'a', paneSessions: [null], log: [], buffers: new Map(), ptyViews: new Map(), confirmedAcks: new Set(), view: 'workspace', tokenInvalid: false,
    state: {
      projects: [{ id: 'a', name: 'Alpha', root: 'A' }, { id: 'b', name: 'Beta', root: 'B' }],
      sessions: [{ id: 's', projectId: 'a', name: 'Build', status: 'running' }],
      tasks: [{ id: 't', projectId: 'a', title: 'Task one', status: 'open', revision: 1, dependsOn: [] }],
    },
  });

  const storage = { getItem: () => null, setItem() {} };
  const workspace = createWorkspace({ renderAll() {}, loadMemory() {}, clearContext() {}, showView() {}, copilot: { revision: () => 1, sync() {} }, storage });
  const views = [], pinned = [];
  const arsenal = { focusTask: id => { pinned.push(id); return true; } };
  const tasks = createTasks({ showView: view => views.push(view), runControls: createFleet({ openSession() {} }).taskControls, arsenal });
  return { workspace, tasks, doc, local, $, views, pinned };
}

test('an open session form keeps a valid project the user chose across state re-renders', async () => {
  const { workspace, $ } = environment(), select = $('#session-project'), form = $('#session-form');
  await $('#toggle-session').fire('click');
  assert.equal(form.hidden, false);
  assert.equal(select.value, 'a', 'opening the form defaults to the current project');
  select.value = 'b';
  workspace.renderSidebar();
  assert.equal(select.value, 'b', 'an SSE re-render must not move the new session to another project');
  local.state.projects = local.state.projects.filter(project => project.id !== 'b');
  workspace.renderSidebar();
  assert.equal(select.value, 'a', 'a removed project falls back to the current one');
  select.value = 'b'; local.state.projects.push({ id: 'b', name: 'Beta', root: 'B' });
  await $('#toggle-session').fire('click'); workspace.renderSidebar();
  assert.equal(select.value, 'a', 'a closed form follows the current project');
});

test('re-rendering the sidebar and task list restores keyboard focus by stable key', () => {
  const { workspace, tasks, $ } = environment();
  workspace.renderSidebar(); tasks.renderTasks();
  const targets = [
    ['#project-list', node => node.textContent === 'Beta'],
    ['#session-list', node => node.textContent.startsWith('Build')],
    ['#task-list', node => node.tag === 'select'],
    ['#task-list', node => node.textContent === 'Rodar com Claude'],
    ['#task-list', node => node.textContent === 'Vincular agente'],
  ];
  for (const [list, match] of targets) {
    const before = $(list).descendants().find(match);
    before.focus();
    workspace.renderSidebar(); tasks.renderTasks();
    assert.notEqual(doc.activeElement, before, `${list} was rebuilt`);
    assert.ok($(list).contains(doc.activeElement) && match(doc.activeElement), `${list} focus returns to the same control`);
  }
});

test('the coordination log appends only new entries instead of re-announcing the whole live region', () => {
  const { $ } = environment(), logEl = $('#coord-log');
  local.log.push({ who: 'Sistema', text: 'pronto', at: 'x' });
  renderLog();
  const first = logEl.firstElementChild;
  renderLog();
  assert.equal(logEl.childElementCount, 1);
  assert.equal(logEl.firstElementChild, first, 'an unchanged entry keeps its node');
  local.log.push({ who: 'Ação local', text: 'tarefa', at: 'y' });
  renderLog();
  assert.equal(logEl.childElementCount, 2);
  assert.equal(logEl.firstElementChild, first);
  assert.match(logEl.lastElementChild.textContent, /tarefa/);
  for (let index = 0; index < 40; index++) { local.log.push({ who: 'Ação local', text: `item ${index}`, at: 'z' }); renderLog(); }
  assert.equal(logEl.childElementCount, 30, 'the page keeps a bounded window of 30 entries');
  assert.match(logEl.lastElementChild.textContent, /item 39/);
});

test('a handoff kept across a mid-request re-render cannot be submitted twice', async () => {
  const { tasks, $ } = environment();
  const calls = [];
  let release;
  const realFetch = globalThis.fetch;
  globalThis.fetch = path => { calls.push(path); return new Promise(resolve => { release = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }); }); };
  try {
    tasks.renderTasks();
    const find = key => $('#task-list').descendants().find(node => node.dataset.focusKey === `task:t:${key}`);
    const note = find('handoff-note');
    note.value = 'Teste vermelho pronto'; await note.fire('input');
    const submit = () => note.parent.parent.fire('submit');
    void submit();
    // The server broadcasts state before it answers; the rebuilt form keeps the draft.
    tasks.renderTasks();
    const rebuilt = find('handoff-note');
    assert.notEqual(rebuilt, note);
    assert.equal(rebuilt.value, 'Teste vermelho pronto');
    void rebuilt.parent.parent.fire('submit');
    assert.deepEqual(calls, ['/api/tasks/t/handoff'], 'a second submit while the first is in flight is ignored');
    assert.equal(find('handoff-send').disabled, true);
    release(); await new Promise(resolve => setImmediate(resolve));
    tasks.renderTasks();
    assert.equal(find('handoff-note').value, '', 'the draft is dropped after the confirmed write');
  } finally { globalThis.fetch = realFetch; }
});

test('"Vincular agente" opens the Arsenal on that task and moves keyboard focus there, not to <body>', async () => {
  const { tasks, $, views, pinned } = environment();
  tasks.renderTasks();
  const button = $('#task-list').descendants().find(node => node.textContent === 'Vincular agente');
  button.focus();
  await button.fire('click');
  assert.deepEqual([views, pinned], [['arsenal'], ['t']]);
  // No profile is open in this fake panel, so there is no task picker: focus lands on the Arsenal heading.
  assert.equal(doc.activeElement, $('#arsenal-title'));
});
