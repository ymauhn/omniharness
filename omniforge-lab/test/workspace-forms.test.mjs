import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';

// Runs the page's real task, composer, memory and inventory handlers against a minimal DOM seam.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function block(from, to) {
  const start = html.indexOf(from), end = html.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `missing page block: ${from}`);
  return html.slice(start, end);
}
class Element {
  constructor(tag = 'div', className = '', text = '') { Object.assign(this, { tag, className, children: [], events: {}, attributes: {}, dataset: {}, style: {}, value: '', disabled: false, _text: String(text) }); }
  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  set innerHTML(_value) { throw Error('Task text must be rendered without HTML injection'); }
  get selectedOptions() { return []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  fire(name) { return Promise.all((this.events[name] || []).map(callback => callback({ currentTarget: this, target: this, preventDefault() {} }))); }
  find(match) { for (const child of this.children) { if (match(child)) return child; const found = child.find(match); if (found) return found; } return null; }
  querySelector(selector) { return this.find(node => node.tag === selector.match(/^[a-z]+/)[0]); }
}
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };

function environment() {
  const ids = new Map(), requests = [], apiCalls = [], messages = [], calls = [];
  const $ = selector => { if (!ids.has(selector)) ids.set(selector, new Element()); return ids.get(selector); };
  const form = (selector, fields) => {
    const element = $(selector);
    element.tag = 'form'; element.append(new Element('button'));
    element.elements = Object.fromEntries(fields.map(name => [name, { value: '' }]));
    element.reset = () => { for (const field of Object.values(element.elements)) field.value = ''; };
  };
  form('#task-form', ['title']); form('#coord-form', ['text', 'action']); form('#memory-form', ['scope', 'sessionId', 'source', 'text']);
  const local = { projectId: 'p', state: { projects: [{ id: 'p' }, { id: 'q' }], tasks: [] }, inventory: null, inventoryProjectId: null };
  const env = { $, local, requests, apiCalls, messages, calls, respond: async () => ({ id: 'created' }), apiQueue: [] };
  const make = (tag, className, text) => new Element(tag, className, text);
  env.ctx = vm.createContext({
    local, $, make, one: (parent, ...args) => { const node = make(...args); parent.append(node); return node; }, keepFocus: () => () => {},
    asArray: value => Array.isArray(value) ? value : [], encodeURIComponent,
    projectById: id => local.state.projects.find(project => project.id === id), taskById: id => local.state.tasks.find(task => task.id === id),
    action: (path, body) => { requests.push({ path, body }); return env.respond(path, body); },
    api: path => { apiCalls.push(path); return env.apiQueue.shift(); },
    refresh: async () => { calls.push('refresh'); }, toast: message => messages.push(message),
    renderTasks: () => calls.push('renderTasks'), renderAssets: () => calls.push('renderAssets'), loadMemory: () => calls.push('memory'), updateMemoryScope() {},
    copilot: { revision: () => 1, sync() {} }, arsenal: { focusTask() {} }, showView() {},
  });
  vm.runInContext(block('    function renderTasks()', '    async function loadMemory()') + block('    async function loadInventory()', '    function renderAssets()') + block("    $('#task-form').addEventListener", "    $('#context-session')"), env.ctx);
  return env;
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
    fill(form); env.respond = () => pending.promise; env.requests.length = 0;
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
  env.local.state.tasks = [{ id: 't1', projectId: 'p', title: 'Race', dependsOn: [], status: 'open', revision: 3, hasDetails: true }];
  env.ctx.renderTasks();
  const list = env.$('#task-list'), select = list.find(node => node.tag === 'select');
  env.respond = async () => null;
  select.value = 'blocked';
  await select.fire('change');
  assert.equal(env.requests[0].body.expectedRevision, 3);
  assert.equal(select.value, 'open');
  assert.ok(env.calls.includes('refresh'));
  const more = list.find(node => node.tag === 'details');
  assert.deepEqual(env.apiCalls, [], 'details load only when opened');
  env.apiQueue.push(Promise.resolve({ id: 't1', details: 'Race\n<b>Contexto completo</b>' }));
  more.open = true;
  await more.fire('toggle');
  await more.fire('toggle');
  assert.deepEqual(env.apiCalls, ['/api/tasks/t1/details']);
  assert.match(list.textContent, /<b>Contexto completo<\/b>/);
});

test('asset inventory applies only the latest request for the current project and reports skipped folders', async () => {
  const env = environment(), first = deferred(), second = deferred(), button = env.$('#refresh-assets');
  env.apiQueue.push(first.promise, second.promise);
  const a = env.ctx.loadInventory();
  assert.equal(button.disabled, true);
  env.local.projectId = 'q';
  const b = env.ctx.loadInventory();
  second.resolve({ files: ['b.png'], unreadableDirectories: 2 });
  await b;
  first.reject(Error('Falha do projeto anterior'));
  await a;
  assert.equal(env.local.inventoryProjectId, 'q');
  assert.deepEqual([...env.local.inventory.files], ['b.png']);
  assert.deepEqual(env.messages, ['Inventário parcial: 2 pastas sem leitura ignoradas.']);
  assert.equal(button.disabled, false);
});
