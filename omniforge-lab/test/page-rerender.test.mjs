import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Runs the page's real sidebar, task list and coordination log renderers against a minimal DOM seam:
// an SSE state event re-renders them, and the user's choice, keyboard focus and log nodes must survive.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function block(from, to) {
  const start = html.indexOf(from), end = html.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `missing page block: ${from}`);
  return html.slice(start, end);
}
function environment() {
  const doc = { activeElement: null }, ids = new Map();
  class Element {
    constructor(tag = 'div', className = '', text = '') { Object.assign(this, { tag, className, children: [], parent: null, dataset: {}, events: {}, attributes: {}, style: {}, value: '', hidden: false, scrollTop: 0, scrollHeight: 0, _text: String(text) }); }
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
  const $ = selector => { if (!ids.has(selector)) ids.set(selector, new Element()); return ids.get(selector); };
  $('#session-form').hidden = true; $('#session-form').append($('#session-project')); $('#session-project').tag = 'select';
  $('#task-form').append(new Element('button'));
  const local = { projectId: 'a', paneSessions: [null], log: [],
    state: { projects: [{ id: 'a', name: 'Alpha', root: 'A' }, { id: 'b', name: 'Beta', root: 'B' }], sessions: [{ id: 's', projectId: 'a', name: 'Build', status: 'running' }],
      tasks: [{ id: 't', projectId: 'a', title: 'Task one', status: 'open', revision: 1, dependsOn: [] }] } };
  doc.createElement = tag => new Element(tag);
  const ctx = vm.createContext({ document: doc, local, $,
    asArray: value => Array.isArray(value) ? value : [], encodeURIComponent, time: () => '10:00', statusLabel: status => status || '',
    projectById: id => local.state.projects.find(project => project.id === id), taskById: id => local.state.tasks.find(task => task.id === id),
    sessionById: id => local.state.sessions.find(session => session.id === id), currentProjectSessions: () => local.state.sessions.filter(session => session.projectId === local.projectId),
    terminalLayout: { value: { focus: 0 } }, selectProject() {}, assignPane() {}, renderWorkspace() {}, showView() {}, action: async () => null, api: async () => ({}), refresh: async () => {}, arsenal: { focusTask() {} } });
  vm.runInContext(block('    const make = ', '    const asArray') + block('    function fillSelect(', '    const isPtySession') + block('    function renderLog()', '    async function loadMemory()')
    + html.split('\n').find(line => line.startsWith("    for(const name of ['project','session'])")), ctx);
  return { ctx, doc, local, $ };
}

test('an open session form keeps a valid project the user chose across state re-renders', async () => {
  const { ctx, local, $ } = environment(), select = $('#session-project'), form = $('#session-form');
  await $('#toggle-session').fire('click');
  assert.equal(form.hidden, false);
  assert.equal(select.value, 'a', 'opening the form defaults to the current project');
  select.value = 'b';
  ctx.renderSidebar();
  assert.equal(select.value, 'b', 'an SSE re-render must not move the new session to another project');
  local.state.projects = local.state.projects.filter(project => project.id !== 'b');
  ctx.renderSidebar();
  assert.equal(select.value, 'a', 'a removed project falls back to the current one');
  select.value = 'b'; local.state.projects.push({ id: 'b', name: 'Beta', root: 'B' });
  await $('#toggle-session').fire('click'); ctx.renderSidebar();
  assert.equal(select.value, 'a', 'a closed form follows the current project');
});

test('re-rendering the sidebar and task list restores keyboard focus by stable key', () => {
  const { ctx, doc, $ } = environment();
  ctx.renderSidebar(); ctx.renderTasks();
  const targets = [
    ['#project-list', node => node.textContent === 'Beta'],
    ['#session-list', node => node.textContent.startsWith('Build')],
    ['#task-list', node => node.tag === 'select'],
    ['#task-list', node => node.textContent === 'Vincular agente'],
  ];
  for (const [list, match] of targets) {
    const before = $(list).descendants().find(match);
    before.focus();
    ctx.renderSidebar(); ctx.renderTasks();
    assert.notEqual(doc.activeElement, before, `${list} was rebuilt`);
    assert.ok($(list).contains(doc.activeElement) && match(doc.activeElement), `${list} focus returns to the same control`);
  }
});

test('the coordination log appends only new entries instead of re-announcing the whole live region', () => {
  const { ctx, local, $ } = environment(), log = $('#coord-log');
  local.log.push({ who: 'Sistema', text: 'pronto', at: 'x' });
  ctx.renderLog();
  const first = log.firstElementChild;
  ctx.renderLog();
  assert.equal(log.childElementCount, 1);
  assert.equal(log.firstElementChild, first, 'an unchanged entry keeps its node');
  local.log.push({ who: 'Ação local', text: 'tarefa', at: 'y' });
  ctx.renderLog();
  assert.equal(log.childElementCount, 2);
  assert.equal(log.firstElementChild, first);
  assert.match(log.lastElementChild.textContent, /tarefa/);
  for (let index = 0; index < 40; index++) { local.log.push({ who: 'Ação local', text: `item ${index}`, at: 'z' }); ctx.renderLog(); }
  assert.equal(log.childElementCount, 30, 'the page keeps a bounded window of 30 entries');
  assert.match(log.lastElementChild.textContent, /item 39/);
});
