import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import './support/browser-globals.mjs';
import { local, bindRefresher } from '../app/state.mjs';
import { createFleet, orderRuns, groupTasks, usageText } from '../app/fleet.mjs';
import { createTasks } from '../app/tasks.mjs';

// Runs the real Agentes view and task run controls (fleet.mjs, tasks.mjs) against a minimal DOM seam, with fetch as the
// network boundary: a fake /api/agents that answers from `server.runs` and records every request.
class Element {
  constructor(tag = 'div', className = '', text = '') {
    Object.assign(this, { tag, className, children: [], parent: null, dataset: {}, events: {}, attributes: {}, style: {}, value: '', disabled: false, hidden: false, _text: String(text) });
  }
  append(child) { child.parent = this; this.children.push(child); }
  replaceChildren() { if (this.children.some(child => child.contains(doc.activeElement))) doc.activeElement = null; for (const child of this.children) child.parent = null; this.children = []; this._text = ''; }
  get childElementCount() { return this.children.length; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  set innerHTML(_value) { throw Error('Page text must be rendered without HTML injection'); }
  get selectedOptions() { return []; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  async fire(name) { if (!this.disabled) await Promise.all((this.events[name] || []).map(callback => callback({ currentTarget: this, target: this, preventDefault() {} }))); await tick(); }
  focus() { if (!this.disabled) doc.activeElement = this; }
  contains(node) { for (let item = node; item; item = item.parent) if (item === this) return true; return false; }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector) { return this.descendants().filter(node => selector === '[data-focus-key]' ? 'focusKey' in node.dataset : selector.split(',').includes(node.tag)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
let doc;
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; };
const run = (id, fields = {}) => ({ id, taskId: 't', projectId: 'a', host: 'claude', sessionId: `s-${id}`, state: 'working', detail: '', startedAt: '2026-09-26T10:00:00.000Z',
  endedAt: null, usage: { status: 'unknown', inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null, source: null, reason: 'Execução em andamento' }, ...fields });

function environment() {
  const ids = new Map(), requests = [], opened = [], server = { runs: [], hold: null };
  const $ = selector => { if (!ids.has(selector)) ids.set(selector, new Element()); return ids.get(selector); };
  doc = { activeElement: null, hidden: false, createElement: tag => new Element(tag), querySelectorAll: () => [], querySelector: $ };
  globalThis.document = doc;
  $('#task-form').append(new Element('button'));
  Object.assign(local, {
    projectId: 'a', view: 'fleet', log: [], tokenInvalid: false,
    state: {
      projects: [{ id: 'a', name: 'Alpha', root: 'A' }, { id: 'b', name: 'Beta', root: 'B' }], sessions: [], skills: [], layout: { split: 50 },
      tasks: [{ id: 't', projectId: 'a', title: 'Corrigir README', status: 'running', revision: 3, dependsOn: [] },
        { id: 'u', projectId: 'a', title: 'Revisar testes', status: 'open', revision: 1, dependsOn: [] },
        { id: 'v', projectId: 'b', title: 'Outra', status: 'open', revision: 1, dependsOn: [] }],
    },
  });
  server.respond = async (path, options) => {
    if (path.startsWith('/api/agents')) {
      const projectId = new URL(path, 'http://local').searchParams.get('projectId'), runs = structuredClone(server.runs.filter(item => item.projectId === projectId));
      if (server.hold) await server.hold;
      return { ok: true, status: 200, json: async () => ({ runs }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  globalThis.fetch = (path, options) => { requests.push({ path, body: options?.body ? JSON.parse(options.body) : undefined }); return server.respond(path, options); };
  bindRefresher(async () => {});
  let tasks;
  const fleet = createFleet({ openSession: id => opened.push(id), onChange: () => tasks?.renderTasks() });
  tasks = createTasks({ showView() {}, runControls: fleet.taskControls });
  // The server changes a run and the page receives its SSE `agent` event.
  const emit = async (id, state, detail = '') => {
    const item = server.runs.find(entry => entry.id === id);
    Object.assign(item, { state, detail });
    fleet.accept({ taskId: item.taskId, projectId: item.projectId, runId: id, sessionId: item.sessionId, host: item.host, state, detail, at: 'x' });
    await tick(); await tick();
  };
  const cards = () => $('#fleet-runs').children.filter(node => node.tag === 'article');
  const find = (root, text) => root.descendants().find(node => node.tag === 'button' && node.textContent === text);
  return { $, fleet, tasks, requests, opened, server, emit, cards, find };
}

test('runs are ordered blocked first, then starting/working, idle and done/failed, latest first inside each group', () => {
  const runs = ['done', 'working', 'idle', 'blocked', 'failed', 'starting', 'blocked'].map((state, index) => ({ id: `r${index}`, state }));
  assert.deepEqual(orderRuns(runs).map(item => item.id), ['r3', 'r6', 'r1', 'r5', 'r2', 'r0', 'r4']);
  const tasks = [['1', 'done'], ['2', 'open'], ['3', 'running'], ['4', 'blocked'], ['5', 'open']].map(([id, status]) => ({ id, status }));
  assert.deepEqual(groupTasks(tasks).map(column => [column.title, column.tasks.map(task => task.id)]),
    [['Aberta', ['2', '5']], ['Em execução', ['3']], ['Bloqueada', ['4']], ['Concluída', ['1']]]);
});

test('usage is observed tokens or "desconhecido: <reason>", never a zero for an unknown figure', () => {
  assert.equal(usageText(run('r').usage), 'Uso desconhecido: Execução em andamento');
  assert.equal(usageText(undefined), 'Uso desconhecido: ainda não lido');
  const observed = { status: 'observed', inputTokens: 6011, outputTokens: 6007, cacheReadTokens: 103, cacheCreationTokens: null, source: 'x', reason: null };
  assert.equal(usageText(observed), 'Tokens observados: 6.011 entrada · 6.007 saída · 103 cache lido');
});

test('the grid shows the selected project runs, opens a run terminal and never shows another project', async () => {
  const env = environment(), { $, fleet, server, cards } = env;
  server.runs = [run('old', { state: 'done', detail: '', endedAt: '2026-09-26T10:03:05.000Z', usage: { status: 'observed', inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 } }),
    run('wait', { taskId: 'u', state: 'blocked', detail: 'permission_prompt' }), run('other', { projectId: 'b', taskId: 'v', host: 'codex' })];
  fleet.sync(); await tick(); await tick();
  assert.deepEqual(env.requests.map(request => request.path), ['/api/agents?projectId=a']);
  assert.deepEqual(cards().map(card => card.dataset.state), ['blocked', 'done']);
  const [blocked, done] = cards().map(card => card.textContent);
  assert.match(blocked, /Claude.*Aguardando você · pedido de permissão.*Revisar testes.*Uso desconhecido: Execução em andamento/);
  assert.match(done, /Concluído.*Corrigir README.*Durou 3 min 05 s.*Tokens observados: 5 entrada · 2 saída · 0 cache lido · 0 cache criado/);
  await env.find(cards()[0], 'Abrir terminal').fire('click');
  assert.deepEqual(env.opened, ['s-wait']);
  // Kanban: one column per task status, the task's latest run as a text badge.
  const columns = $('#fleet-board').children.map(column => column.textContent);
  assert.deepEqual(columns.map(text => text.split(' · ')[0]), ['Aberta', 'Em execução', 'Bloqueada', 'Concluída']);
  assert.match(columns[0], /Revisar testes.*Claude · Aguardando você · pedido de permissão/);
  assert.match(columns[1], /Corrigir README.*Claude · Concluído/);
  assert.doesNotMatch(columns.join(''), /Outra/);

  // An older answer that arrives last never overwrites a newer one.
  const gate = deferred();
  server.hold = gate.promise;
  const stale = fleet.load();
  server.hold = null;
  Object.assign(server.runs[1], { state: 'working', detail: '' });
  await fleet.load();
  gate.resolve(); await stale;
  assert.deepEqual(cards().map(card => card.dataset.state), ['working', 'done']);
  // A project switch clears the grid at once; an SSE event of another project is neither shown nor announced.
  local.projectId = 'b'; fleet.sync();
  assert.equal(cards().length, 0);
  $('#fleet-live').textContent = '';
  fleet.accept({ taskId: 'u', projectId: 'a', runId: 'wait', sessionId: 's-wait', host: 'claude', state: 'blocked', detail: 'permission_prompt', at: 'x' });
  assert.equal($('#fleet-live').textContent, '');
  await tick(); await tick();
  assert.deepEqual(cards().map(card => [card.dataset.state, card.textContent.includes('Outra')]), [['working', true]]);
});

test('desktop notifications need the owner click and fire only on blocked/done/failed while the page is hidden', async () => {
  const env = environment(), { $, fleet, server, emit } = env, shown = [];
  let asked = 0;
  globalThis.Notification = class {
    static permission = 'default';
    static async requestPermission() { asked++; return 'granted'; }
    constructor(title, options) { shown.push(`${title} | ${options.body}`); }
  };
  try {
    server.runs = [run('r')];
    fleet.sync(); await tick(); await tick();
    assert.equal(asked, 0, 'never asks on load');
    doc.hidden = true;
    await emit('r', 'blocked', 'permission_prompt');
    assert.deepEqual(shown, [], 'not enabled yet');
    assert.match($('#fleet-live').textContent, /Aguardando você/, 'the live region still announces the meaningful change');
    const toggle = $('#fleet-notify');
    assert.equal(toggle.textContent, 'Ativar notificações');
    await toggle.fire('click');
    assert.equal(asked, 1);
    assert.equal(toggle.textContent, 'Desativar notificações');
    await emit('r', 'working');
    assert.equal($('#fleet-live').textContent.includes('Trabalhando'), false, 'working is not announced');
    await emit('r', 'blocked', 'permission_prompt');
    await emit('r', 'blocked', 'permission_prompt');
    assert.deepEqual(shown, ['OmniForge · Claude: Aguardando você | Corrigir README · pedido de permissão'], 'one notice per transition');
    doc.hidden = false;
    await emit('r', 'idle');
    await emit('r', 'done');
    assert.equal(shown.length, 1, 'a visible page does not notify');
    doc.hidden = true;
    server.runs.push(run('s', { host: 'codex' }));
    await emit('s', 'failed', 'saiu com código 3');
    assert.equal(shown.at(-1), 'OmniForge · Codex: Falhou | Corrigir README · saiu com código 3');
    await toggle.fire('click');
    assert.equal(toggle.textContent, 'Ativar notificações');
    server.runs.push(run('t'));
    await emit('t', 'done');
    assert.equal(shown.length, 2, 'turned off again');
    assert.equal(asked, 1);
  } finally { delete globalThis.Notification; }
});

test('each task runs with Claude or Codex, both disabled while its latest run is active, and shows that run state as text', async () => {
  const env = environment(), { $, fleet, tasks, server, emit, find } = env;
  server.runs = [run('r', { state: 'blocked', detail: 'permission_prompt' })];
  fleet.sync(); await tick(); await tick();
  const card = () => $('#task-list').children.find(item => item.textContent.includes('Corrigir README'));
  assert.equal(find(card(), 'Rodar com Claude').disabled, true);
  assert.equal(find(card(), 'Rodar com Codex').disabled, true);
  assert.match(card().textContent, /Claude · Aguardando você · pedido de permissão/);
  await emit('r', 'done');
  assert.equal(find(card(), 'Rodar com Codex').disabled, false);
  const other = $('#task-list').children.find(item => item.textContent.includes('Revisar testes'));
  assert.equal(find(other, 'Rodar com Claude').disabled, false);
  // Keyboard focus returns to the same control after a re-render.
  find(card(), 'Rodar com Codex').focus(); tasks.renderTasks();
  assert.equal(doc.activeElement?.dataset.focusKey, 'task:t:run-codex');
  server.respond = async path => path.endsWith('/run')
    ? { ok: false, status: 409, json: async () => ({ error: 'A tarefa já tem um agente em execução' }) }
    : { ok: true, status: 200, json: async () => ({ runs: server.runs }) };
  await find(card(), 'Rodar com Codex').fire('click');
  assert.deepEqual(env.requests.filter(request => request.path.endsWith('/run')), [{ path: '/api/tasks/t/run', body: { host: 'codex', expectedRevision: 3 } }]);
  assert.equal($('#toast').textContent, 'A tarefa já tem um agente em execução');
  assert.equal(doc.activeElement?.dataset.focusKey, 'task:t:run-codex', 'a refused run keeps focus on its button');
});

test('a Gauntlet run from the agent SSE is named as such, exposed for the review panel, and keeps the task run buttons disabled', async () => {
  const env = environment(), { $, fleet, server, find, cards } = env;
  server.runs = [run('agente', { state: 'done' })];
  fleet.sync(); await tick(); await tick();
  assert.equal(fleet.gauntletRun('t'), null);
  server.runs.unshift(run('g', { kind: 'gauntlet', state: 'blocked', detail: 'permission_prompt' }));
  fleet.accept({ taskId: 't', projectId: 'a', runId: 'g', sessionId: 's-g', host: 'claude', state: 'blocked', detail: 'permission_prompt', at: 'x', kind: 'gauntlet' });
  assert.deepEqual([fleet.gauntletRun('t').id, fleet.gauntletRun('t').state], ['g', 'blocked'], 'known at once, before the runs are read again');
  await tick(); await tick();
  assert.match(cards()[0].textContent, /^Gauntlet.*Aguardando você/);
  const card = () => $('#task-list').children.find(item => item.textContent.includes('Corrigir README'));
  assert.match(card().textContent, /Gauntlet · Aguardando você/);
  assert.equal(find(card(), 'Rodar com Claude').disabled, true);
  // A finished review over a still idle agent session: the engine refuses a new run, so the buttons stay disabled.
  server.runs = [run('g', { kind: 'gauntlet', state: 'done' }), run('agente', { state: 'idle' })];
  await fleet.load();
  assert.equal(find(card(), 'Rodar com Codex').disabled, true);
});

test('prompt codes from the engine read as pt-BR text; an unknown code stays as sent', async () => {
  const { detailText } = await import('../app/fleet.mjs');
  assert.deepEqual(['permission_prompt', 'trust_prompt', 'hooks_review', 'rate_limit_prompt', 'approval_prompt', 'saiu com código 3'].map(detailText),
    ['pedido de permissão', 'confiança da pasta', 'revisão de hooks', 'aviso de limite de uso', 'aprovação de comando', 'saiu com código 3']);
});
