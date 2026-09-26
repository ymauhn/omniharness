import test from 'node:test';
import assert from 'node:assert/strict';
import './support/browser-globals.mjs';
import { local, bindRefresher } from '../app/state.mjs';
import { make } from '../app/dom.mjs';
import { createWorkspace } from '../app/workspace.mjs';

// Executes the actual workspace.mjs controller functions (terminal panes, PTY input/output,
// replay/SSE) against a DOM seam. No renderer, browser, PTY process, provider or shell command
// is launched by these checks. `local` and the timer globals are the process's real singletons,
// so each environment() resets or replaces exactly what a test can observe.
class Element {
  constructor(tag, className = '', text = '') {
    Object.assign(this, { tag, className, children: [], parent: null, dataset: {}, events: {}, attributes: {}, _text: String(text), value: '', style: { setProperty() {} }, scrollHeight: 100, clientHeight: 100, scrollTop: 0 });
  }
  get isConnected() { return this.root === true || !!this.parent?.isConnected; }
  append(child) { child.parent = this; this.children.push(child); }
  replaceChildren() { for (const child of this.children) child.parent = null; this.children = []; this._text = ''; }
  replaceChild(next, old) { const i = this.children.indexOf(old); assert.ok(i >= 0); old.parent = null; next.parent = this; this.children[i] = next; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  get lastElementChild() { return this.children.at(-1); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  async fire(name) { for (const callback of this.events[name] || []) await callback({ target: this, currentTarget: this, preventDefault() {} }); }
  focus() { doc.activeElement = this; for (let node = this; node; node = node.parent) for (const callback of node.events.focusin || []) callback({ target: this }); }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    if (selector.startsWith('[data-')) return selector.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) in this.dataset;
    return this.tag === selector.replace(/\[.*\]$/, ''); // tag or tag[attr="value"], attribute value itself is not checked
  }
  querySelectorAll(selector) {
    const parts = selector.split(' ');
    return this.children.flatMap(child => [...(child.matches(parts[0]) ? (parts.length > 1 ? child.querySelectorAll(parts.slice(1).join(' ')) : [child]) : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
let doc;

function environment(fetchImpl = async () => { throw Error('Unavailable'); }) {
  doc = { activeElement: null, focused: true, hasFocus() { return this.focused; }, body: { dataset: { theme: 'operations' } } };
  const grid = new Element('div'); grid.root = true;
  doc.querySelectorAll = selector => grid.querySelectorAll(selector);
  const ids = new Map([['#terminal-grid', grid]]);
  const $ = selector => { if (!ids.has(selector)) ids.set(selector, new Element('div')); return ids.get(selector); };
  doc.querySelector = $;
  doc.createElement = tag => new Element(tag);
  doc.createElementNS = (_ns, tag) => new Element(tag);
  globalThis.document = doc;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const timers = new Map(); let timerId = 0;
  globalThis.setTimeout = fn => { timers.set(++timerId, fn); return timerId; };
  globalThis.clearTimeout = id => { timers.delete(id); };
  globalThis.requestAnimationFrame = () => {};

  const sessions = ['a', 'b', 'c', 'd'].map(id => ({ id, projectId: 'p', name: id, status: 'running', host: 'local-shell' }))
    .concat({ id: 'foreign', projectId: 'q', name: 'foreign', status: 'running', host: 'local-shell' });
  Object.assign(local, {
    state: { projects: [{ id: 'p', name: 'p', root: '/p' }, { id: 'q', name: 'q', root: '/q' }], sessions, tasks: [], skills: [], layout: { split: 50 } },
    projectId: 'p', paneSessions: [], ptyViews: new Map(), buffers: new Map(), view: 'workspace', confirmedAcks: new Set(), tokenInvalid: false,
  });

  const requests = [], messages = [];
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    const value = await fetchImpl(path, options);
    return { ok: true, status: 200, json: async () => value };
  };
  bindRefresher(async () => {});
  const workspace = createWorkspace({
    renderAll() {}, loadMemory() {}, clearContext() {}, showView() {}, copilot: { revision: () => 1, sync() {} },
    storage: { getItem: () => null, setItem() {} },
  });
  return { workspace, layout: workspace.layout, streams: workspace.streams, grid, doc, local, $, requests, messages, timers, render: () => workspace.renderWorkspace() };
}

test('actual grid renders N panes, reorders drafts/focus and closes only the view', async () => {
  const env = environment(); env.layout.switchProject('p', env.local.state.sessions); env.layout.add(env.local.state.sessions); env.layout.add(env.local.state.sessions); env.render();
  assert.equal(env.grid.children.length, 4);
  const first = env.grid.children[0], draft = first.querySelector('.command-line input'); draft.value = 'keep this unsent'; draft.focus();
  await first.querySelector('[data-pane-next]').fire('click');
  assert.equal(env.grid.children[1].dataset.sessionId, 'a'); assert.equal(env.grid.children[1].querySelector('.command-line input').value, 'keep this unsent');
  assert.equal(env.doc.activeElement, env.grid.children[1].querySelector('.pane-select'));
  await env.grid.children[1].querySelector('[data-pane-close]').fire('click');
  assert.equal(env.grid.children.length, 3); assert.ok(env.local.state.sessions.some(s => s.id === 'a'));
  assert.ok(!env.requests.some(r => String(r.path).includes('/stop')));
  env.local.projectId = 'q'; env.render(); assert.deepEqual(env.grid.children.map(p => p.dataset.sessionId), ['foreign', '']);
  assert.equal(env.streams.size, 1, 'panes left behind by the project switch prune their terminal streams');
  env.local.projectId = 'p'; env.local.state.sessions = env.local.state.sessions.filter(s => s.id !== 'b'); env.render();
  assert.ok(!env.local.paneSessions.includes('b')); assert.ok(!env.local.paneSessions.includes('foreign'));
});

test('empty panes are rebuilt for a newly selected project so session creation becomes available', () => {
  const env = environment(); env.local.projectId = null; env.render(); const empty = env.grid.children[0];
  assert.equal(empty.querySelectorAll('button').find(b => b.textContent === 'Nova sessão').disabled, true);
  env.local.projectId = 'empty-project'; env.render(); assert.notEqual(env.grid.children[0], empty);
  assert.equal(env.grid.children[0].querySelectorAll('button').find(b => b.textContent === 'Nova sessão').disabled, false);
});

test('a late replay after project switch cannot display content or refill a discarded buffer', async () => {
  const pending = []; const env = environment(path => new Promise(resolve => pending.push({ path, resolve }))); env.render();
  const old = pending.find(p => p.path.includes('/a/output')); assert.ok(old);
  env.local.projectId = 'q'; env.render();
  old.resolve({ sessionId: 'a', projectId: 'p', epoch: 'e1', firstSequence: 1, nextSequence: 2, truncated: false, chunks: [{ sequence: 1, stream: 'stdout', text: 'PRIVATE_A' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!env.local.buffers.has('a')); assert.ok(!env.grid.textContent.includes('PRIVATE_A'));
  assert.throws(() => env.workspace.acceptTerminal({ sessionId: 'foreign', projectId: 'p', epoch: 'e1', sequence: 1, text: 'PRIVATE_A', stream: 'stdout' }));
  assert.ok(!env.grid.textContent.includes('PRIVATE_A'));
});

test('actual replay/SSE controller deduplicates output and reconnect requests the known cursor', async () => {
  const env = environment(async path => {
    const after = Number(new URL(path, 'http://local').searchParams.get('after'));
    return { sessionId: 'a', projectId: 'p', epoch: 'e1', firstSequence: 1, nextSequence: 3, truncated: false, chunks: [1, 2].filter(n => n > after).map(sequence => ({ sequence, text: String(sequence), stream: 'stdout' })) };
  });
  env.layout.switchProject('p', env.local.state.sessions, 'a'); env.render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.local.buffers.get('a'), '12');
  env.workspace.acceptTerminal({ sessionId: 'a', projectId: 'p', epoch: 'e1', sequence: 2, text: '2', stream: 'stdout' }); assert.equal(env.local.buffers.get('a'), '12');
  await env.workspace.replayTerminal('a'); assert.match(env.requests.at(-1).path, /after=2$/); assert.equal(env.local.buffers.get('a'), '12');
});

test('actual controller fetches missing history after a same-tail epoch reset and exposes local retention loss', async () => {
  let epoch = 'old';
  const env = environment(async path => {
    const after = Number(new URL(path, 'http://local').searchParams.get('after'));
    return { sessionId: 'a', projectId: 'p', epoch, firstSequence: 1, nextSequence: 3, truncated: after >= 3, chunks: [1, 2].filter(n => after >= 3 || n > after).map(sequence => ({ sequence, text: `${epoch}${sequence}`, stream: 'stdout' })) };
  });
  env.layout.switchProject('p', env.local.state.sessions, 'a'); env.render(); await new Promise(resolve => setImmediate(resolve)); assert.equal(env.local.buffers.get('a'), 'old1old2');
  const before = env.requests.length; epoch = 'new'; await env.workspace.replayTerminal('a');
  assert.equal(env.local.buffers.get('a'), 'new1new2'); assert.equal(env.requests.length - before, 2);
  assert.match(env.requests.at(-2).path, /after=2$/); assert.match(env.requests.at(-1).path, /after=0$/);
  for (let sequence = 3; sequence <= 18; sequence++) env.workspace.acceptTerminal({ sessionId: 'a', projectId: 'p', epoch, sequence, text: 'x'.repeat(8192), stream: 'stdout' });
  assert.match(env.grid.querySelector('.terminal-replay-status').textContent, /início foi descartado/);
  env.workspace.acceptTerminal({ sessionId: 'a', projectId: 'p', epoch, sequence: 19, text: 'newest', stream: 'stdout' });
  assert.match(env.grid.querySelector('.terminal-replay-status').textContent, /início foi descartado/);
});

test('actual queued input rechecks focus before each bounded write and never sends to a stale pane', async () => {
  let release; const env = environment(() => new Promise(resolve => { release = resolve; })); env.layout.switchProject('p', env.local.state.sessions); env.workspace.reconcilePanes();
  const view = { index: 0, sessionId: 'a', disposed: false, inputFailed: false, queuedInput: 0, writeQueue: Promise.resolve(), term: { options: {} } };
  env.workspace.sendPtyInput(view, 'x'.repeat(8192) + '🤖'); await new Promise(resolve => setImmediate(resolve)); assert.equal(env.requests.length, 1);
  env.doc.focused = false; release({}); await view.writeQueue; assert.equal(env.requests.length, 1); assert.equal(view.queuedInput, 0); assert.match(env.$('#toast').textContent, /interrompida/);
  env.doc.focused = true; env.local.projectId = 'q'; env.workspace.sendPtyInput(view, 'must not send'); await view.writeQueue; assert.equal(env.requests.length, 1);
  env.local.projectId = 'p'; env.workspace.sendPtyInput(view, 'x'.repeat(65537)); assert.equal(env.requests.length, 1); assert.match(env.$('#toast').textContent, /limite/);
});

test('actual display cache preserves Unicode at its retention boundary and ignores retired live output', async () => {
  // The TerminalTranscript instance is now private to workspace.mjs; drive the same epoch-reset and
  // stale-live-ignored scenario through the public accept/replay seam instead of reaching into it.
  let replayResponse = null;
  const env = environment(async () => replayResponse);
  env.layout.switchProject('p', env.local.state.sessions, 'a'); env.render();
  await new Promise(resolve => setImmediate(resolve)); // let the render-triggered initial replay (fed a null response) settle first
  env.workspace.appendOutput('a', '🤖'); for (let i = 0; i < 14; i++) env.workspace.appendOutput('a', 'x'.repeat(8192)); env.workspace.appendOutput('a', 'x'.repeat(5311));
  assert.ok(env.local.buffers.get('a').length <= 120000); assert.equal(env.local.buffers.get('a').isWellFormed(), true);
  env.workspace.acceptTerminal({ sessionId: 'a', projectId: 'p', epoch: 'old', sequence: 1, text: 'old', stream: 'stdout' });
  replayResponse = { sessionId: 'a', projectId: 'p', epoch: 'current', firstSequence: 1, nextSequence: 2, truncated: true, chunks: [{ sequence: 1, text: 'current', stream: 'stdout' }] };
  await env.workspace.replayTerminal('a');
  assert.doesNotThrow(() => env.workspace.acceptTerminal({ sessionId: 'a', projectId: 'p', epoch: 'old', sequence: 2, text: 'delayed old', stream: 'stdout' }));
  assert.equal(env.local.buffers.get('a'), 'current');
});

test('two invalidated replay replies schedule one bounded catch-up even if the stream then goes quiet', async () => {
  let phase = 'initial'; const pending = [];
  const response = (epoch, after) => ({ sessionId: 'a', projectId: 'p', epoch, firstSequence: 1, nextSequence: 2, truncated: false, chunks: after === 0 ? [{ sequence: 1, text: epoch, stream: 'stdout' }] : [] });
  const env = environment(path => {
    const after = Number(new URL(path, 'http://local').searchParams.get('after'));
    return phase === 'initial' ? response('initial', after) : phase === 'stale' ? new Promise(resolve => pending.push(resolve)) : response('latest', after);
  });
  env.layout.switchProject('p', env.local.state.sessions, 'a'); env.render(); await new Promise(resolve => setImmediate(resolve)); phase = 'stale';
  const replaying = env.workspace.replayTerminal('a');
  env.workspace.acceptTerminal({ sessionId: 'a', projectId: 'p', epoch: 'middle', sequence: 1, text: 'middle', stream: 'stdout' }); pending.shift()(response('initial', 1)); await new Promise(resolve => setImmediate(resolve));
  env.workspace.acceptTerminal({ sessionId: 'a', projectId: 'p', epoch: 'latest', sequence: 1, text: 'latest', stream: 'stdout' }); pending.shift()(response('middle', 1)); await replaying;
  assert.equal(env.timers.size, 1, 'a quiet stream still needs exactly one queued catch-up'); phase = 'latest';
  const [timer, run] = env.timers.entries().next().value; env.timers.delete(timer); run(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.local.buffers.get('a'), 'latest'); assert.equal(env.streams.get('a').transcript.pendingEpoch, null); assert.equal(env.timers.size, 0);
});

test('confirmed epoch reset stays visible across catch-up, live output, refresh and local truncation', async () => {
  let epoch = 'initial', finishCatchup, failRefresh = false; const chunks = [{ sequence: 1, text: 'initial', stream: 'stdout' }];
  const response = after => ({ sessionId: 'a', projectId: 'p', epoch, firstSequence: 1, nextSequence: chunks.length + 1, truncated: false, chunks: chunks.filter(c => c.sequence > after) });
  const env = environment(path => {
    if (failRefresh) throw Error('offline');
    const after = Number(new URL(path, 'http://local').searchParams.get('after'));
    return epoch === 'new' && after === 0 ? new Promise(resolve => finishCatchup = () => resolve(response(after))) : response(after);
  });
  env.layout.switchProject('p', env.local.state.sessions, 'a'); env.render(); await new Promise(resolve => setImmediate(resolve));
  const status = () => env.grid.querySelector('.terminal-replay-status').textContent;
  assert.doesNotMatch(status(), /Histórico recente reiniciado/);
  epoch = 'new'; chunks[0].text = 'new'; const reset = env.workspace.replayTerminal('a'); await new Promise(resolve => setImmediate(resolve));
  assert.match(status(), /Histórico recente reiniciado/); assert.match(status(), /possível reinício do servidor ou descarte/); assert.match(status(), /Recuperando lacuna/);
  finishCatchup(); await reset; assert.equal(env.local.buffers.get('a'), 'new'); assert.match(status(), /Histórico recente reiniciado/);
  chunks.push({ sequence: 2, text: 'live', stream: 'stdout' }); env.workspace.acceptTerminal({ sessionId: 'a', projectId: 'p', epoch, ...chunks[1] }); assert.match(status(), /Histórico recente reiniciado/);
  await env.workspace.replayTerminal('a'); env.render(); assert.match(status(), /Histórico recente reiniciado/);
  for (let sequence = 3; sequence <= 18; sequence++) env.workspace.acceptTerminal({ sessionId: 'a', projectId: 'p', epoch, sequence, text: 'x'.repeat(8192), stream: 'stdout' });
  assert.match(status(), /Histórico recente reiniciado/); assert.match(status(), /início foi descartado/);
  failRefresh = true; await env.workspace.replayTerminal('a'); assert.match(status(), /Histórico recente reiniciado/); assert.match(status(), /indisponível/);
});

test('actual fit resizes only the focused live pane and coalesces in-flight requests', async () => {
  let release; const env = environment(() => new Promise(resolve => { release = resolve; })); env.layout.switchProject('p', env.local.state.sessions); env.workspace.reconcilePanes();
  let fits = 0; const view = { index: 0, sessionId: 'a', pane: { isConnected: true }, host: { clientWidth: 400, clientHeight: 300 }, fit: { fit() { fits++; } }, term: { cols: 90, rows: 30 } };
  env.doc.focused = false; env.workspace.fitPty(view); assert.equal(fits, 1); assert.equal(env.requests.length, 0);
  env.doc.focused = true; env.layout.focus(1); env.workspace.fitPty(view); assert.equal(env.requests.length, 0);
  env.layout.focus(0); env.workspace.fitPty(view); env.workspace.fitPty(view); assert.equal(env.requests.length, 1); assert.match(env.requests[0].path, /\/a\/resize$/);
  release({}); await new Promise(resolve => setImmediate(resolve)); env.workspace.fitPty(view); assert.equal(env.requests.length, 1);
  env.local.projectId = 'q'; view.lastSize = null; env.workspace.fitPty(view); assert.equal(env.requests.length, 1);
});

test('xterm keeps Tab for shell completion until Ctrl+M makes Tab move focus; Shift+Tab always leaves without writing to the PTY', async () => {
  const env = environment(); env.local.state.sessions[0].host = 'local-pty'; let term;
  env.workspace.setPtyModules(Promise.resolve({
    Terminal: class { constructor(options) { term = this; this.options = options; } loadAddon() {} open() { this.textarea = make('textarea'); } write() {} dispose() {} onData(fn) { this.input = fn; return { dispose() {} }; } attachCustomKeyEventHandler(fn) { this.keys = fn; } },
    FitAddon: class {},
  }));
  env.layout.switchProject('p', env.local.state.sessions, 'a'); env.render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof term?.keys, 'function', 'the PTY pane installs a key handler');
  const press = (key, extra = {}) => { let prevented = false; const handled = term.keys({ type: 'keydown', key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault() { prevented = true; }, ...extra }); return { handled, prevented }; };
  const hint = env.grid.querySelector('.terminal-tab-mode');
  assert.equal(press('Tab').handled, true, 'by default Tab reaches the shell for completion'); assert.match(hint.textContent, /Ctrl\+M/);
  assert.equal(press('Tab', { shiftKey: true }).handled, false, 'default Shift+Tab leaves without writing ESC[Z to the shell');
  assert.ok(hint.id && term.textarea.attributes['aria-describedby'] === hint.id, 'the focused xterm input points screen readers to the Ctrl+M hint');
  assert.deepEqual(press('m', { ctrlKey: true }), { handled: false, prevented: true }, 'Ctrl+M toggles and never reaches the shell as CR');
  assert.match(hint.textContent, /Tab move o foco/); assert.match(env.$('#toast').textContent, /Tab move o foco/);
  assert.equal(press('Tab').handled, false); assert.equal(press('Tab', { shiftKey: true }).handled, false, 'Shift+Tab leaves without ESC[Z'); assert.equal(press('a').handled, true);
  assert.ok(!env.requests.some(r => String(r.path).includes('/write')));
  press('m', { ctrlKey: true }); assert.equal(press('Tab').handled, true); assert.doesNotMatch(hint.textContent, /Tab move o foco \(/);
});

test('actual session creation selects the first new session but never follows a stale project response', async () => {
  for (const switchAway of [false, true]) {
    const env = environment(); env.local.state.sessions = env.local.state.sessions.filter(s => s.projectId !== 'p'); env.render();
    const form = env.$('#session-form'); form.tag = 'form'; form.hidden = false; form.elements = { projectId: { value: 'p' }, name: { value: 'Created' } };
    const button = new Element('button'); form.append(button); form.reset = () => { form.elements.name.value = ''; };
    let release, created;
    globalThis.fetch = async (path, options) => {
      env.requests.push({ path, options });
      // Only the session POST is deferred; a render triggered from inside release() may itself
      // replay other panes, and those must resolve at once instead of chaining more pending fetches.
      if (path !== '/api/sessions') return { ok: true, status: 200, json: async () => ({ sessionId: 'x', projectId: 'p', epoch: 'e', firstSequence: 1, nextSequence: 1, truncated: false, chunks: [] }) };
      return new Promise(resolve => { release = () => { created = { id: 'new', projectId: 'p', name: 'Created', host: 'local-shell', status: 'running' }; env.local.state.sessions.push(created); env.render(); resolve({ ok: true, status: 200, json: async () => created }); }; });
    };
    const pending = form.fire('submit'); assert.equal(button.disabled, true);
    if (switchAway) { env.local.projectId = 'q'; env.render(); }
    release(); await pending; assert.equal(button.disabled, false);
    if (switchAway) { assert.equal(env.local.projectId, 'q'); assert.deepEqual(env.local.paneSessions, ['foreign', null]); assert.equal(form.hidden, false); }
    else { assert.equal(env.local.paneSessions[0], 'new'); assert.equal(form.hidden, true); }
  }
});
