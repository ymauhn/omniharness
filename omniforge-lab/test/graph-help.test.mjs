import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { catalogResponse } from '../copilot.mjs';

// Exercise the graph code from the actual page with a minimal DOM event contract.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function block(from, to) {
  const start = html.indexOf(from), end = html.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `missing graph source block: ${from}`);
  return html.slice(start, end);
}
function dom() {
  const ids = new Map(), doc = {};
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.parentElement = null; this.events = {}; this.dataset = {}; this.style = {}; this.attributes = {}; this._text = ''; this.hidden = false; this.className = ''; }
    append(child) { child.parentElement = this; this.children.push(child); }
    replaceChildren() { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(_value) { throw Error('Graph help must render text without HTML injection'); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
    fire(type, data = {}) { for (const callback of this.events[type] || []) callback({ target: this, preventDefault() {}, ...data }); }
    contains(value) { return this === value || this.children.some(child => child.contains(value)); }
    querySelectorAll(selector) { const matches = this.children.flatMap(child => [...(selector === '.graph-node' && child.className === 'graph-node' || selector === child.tag ? [child] : []), ...child.querySelectorAll(selector)]); matches.find = undefined; return matches; }
    getBoundingClientRect() { return this.rect || { left: 100, right: 180, top: 100, bottom: 120 }; }
    focus() { doc.activeElement?.fire('blur'); doc.activeElement = this; this.fire('focus'); }
    get isConnected() { let node = this; while (node) { if (node === doc.body) return true; node = node.parentElement; } return false; }
  }
  doc.body = new Element('body');
  doc.createElement = tag => new Element(tag);
  doc.createElementNS = (_namespace, tag) => new Element(tag);
  doc.querySelectorAll = selector => selector === '[data-graph]' ? tabs : [];
  const addId = (id, parent = doc.body) => { const element = new Element('div'); element.id = id; ids.set(`#${id}`, element); parent.append(element); return element; };
  addId('graph-canvas');
  const help = addId('graph-help');
  help.offsetWidth = 290; help.offsetHeight = 350;
  for (const id of ['graph-help-title', 'graph-help-summary', 'graph-help-usage', 'graph-help-docs']) addId(id, help);
  for (const id of ['graph-title', 'graph-intro', 'graph-selection', 'graph-source', 'graph-scope', 'graph-relation', 'graph-open', 'skill-search']) addId(id);
  ids.get('#graph-canvas').clientWidth = 850;
  const tabs = ['knowledge', 'capability', 'task'].map(graph => { const tab = new Element('button'); tab.dataset.graph = graph; doc.body.append(tab); return tab; });
  return { doc, ids, $: selector => ids.get(selector) };
}
function graphPage(local, api) {
  const page = dom(), calls = [], opened = [];
  const context = vm.createContext({ local, document: page.doc, window: { innerWidth: 800, innerHeight: 420 }, $: page.$, URLSearchParams, catalogResponse,
    catalog: { search: ring => opened.push(['search', page.$('#skill-search').value, ring]) }, showView: view => opened.push(['view', view]),
    api: (route, options) => { calls.push(route); return api(route, options); },
    one: (parent, tag, className, content) => { const element = page.doc.createElement(tag); element.className = className; if (content !== undefined) element.textContent = content; parent.append(element); return element; },
    asArray: value => Array.isArray(value) ? value : [],
    projectById: id => local.state.projects.find(project => project.id === id),
    sessionById: id => local.state.sessions.find(session => session.id === id),
    statusLabel: status => status || '',
  });
  vm.runInContext(block('    function visibleNotes()', '    function renderMemory()') + block('    function makeNode(', '    const catalog=mountCatalog('), context);
  const buttons = () => page.$('#graph-canvas').querySelectorAll('.graph-node');
  return { ...page, context, calls, opened, buttons, byLabel: label => [...buttons()].find(button => button.textContent === label), help: page.$('#graph-help') };
}
const row = (ring, name, extra = {}) => ({ skill_id: `${ring}:${name}`, name, ring, hosts: [], availability: ring === 'installed' ? 'installed' : 'not_installed',
  source_key: `repo:.agents/skills/${name}/SKILL.md`, curation: 'missing', description: `${name} sem curadoria.`, metadata: {}, ...extra });
const snapshot = (id, rows) => ({ snapshot_id: id, rows });
// Answers each bounded ring page from one fixture snapshot, as harness.catalog_api does.
const serve = current => async route => {
  if (current() instanceof Error) throw current();
  const { snapshot_id, rows } = current(), ring = new URL(route, 'http://local').searchParams.get('ring');
  return { snapshot_id, coverage: { complete_for_discovery_scope: true }, issues: [], total: ring === 'installed' ? 114 : 428, rows: rows.filter(item => item.ring === ring) };
};

test('capability graph comes from the catalog snapshot, labels ring and hosts, and never shows stale curation', async () => {
  let current = snapshot('snap-one-000000', [
    row('installed', 'skill-a', { hosts: ['claude', 'codex'], curation: 'current', description: 'Ajuda a planejar tarefas.',
      metadata: { functional_description: 'Planeja <img src=x onerror=alert(1)> tarefas.', use_cases: { pt: ['Organize um plano em etapas.'] } } }),
    row('installed', 'skill-two', { hosts: ['codex'], curation: 'stale', description: 'Ajuda a revisar código.', metadata: { functional_description: 'STALE PRIVATE HELP' } }),
    row('catalog', 'candidate', { source_key: 'catalog:candidate' }),
  ]);
  const local = { view: 'graphs', graph: 'capability', graphNode: null, graphModels: {}, projectId: 'a', capability: null, capabilityRequest: 0,
    state: { projects: [{ id: 'a', name: 'Projeto A', root: 'A' }], sessions: [], tasks: [], skills: [{ id: 'startup', name: 'STARTUP ONLY', source: '.agents/skills/startup/SKILL.md' }] }, notes: [] };
  const { doc, $, context, calls, opened, buttons, byLabel, help } = graphPage(local, serve(() => current));
  context.renderGraph();
  assert.match($('#graph-intro').textContent, /Consultando o índice de skills/);
  await context.loadCapabilities();
  assert.deepEqual(calls, ['/api/skills?q=&ring=installed&limit=16&offset=0', '/api/skills?q=&ring=catalog&limit=8&offset=0'], 'bounded pages, installed first');
  assert.deepEqual([...buttons()].map(button => button.textContent), ['Índice de skills', 'skill-a · instalada · claude / codex', 'skill-two · instalada · codex', 'candidate · catálogo'], 'nodes name their ring and hosts');
  assert.match($('#graph-intro').textContent, /2 de 114 instaladas e 1 de 428 candidatas do catálogo/);
  byLabel('candidate · catálogo').fire('click');
  assert.equal($('#graph-scope').textContent, 'Catálogo · host não informado');
  assert.match($('#graph-relation').textContent, /Disponibilidade: não instalada/);
  $('#graph-open').onclick();
  assert.deepEqual(opened, [['search', 'candidate', 'catalog'], ['view', 'skills']], 'Abrir item searches the ring of the node, not the installed default');
  const skill = byLabel('skill-a · instalada · claude / codex');
  skill.fire('click');
  assert.match($('#graph-scope').textContent, /^Instalada · claude \/ codex$/);
  skill.fire('mouseenter');
  assert.equal(help.hidden, false);
  assert.equal(skill.getAttribute('aria-describedby'), 'graph-help');
  assert.match($('#graph-help-summary').textContent, /<img src=x onerror=alert\(1\)>/, 'curated help renders as text');
  assert.match($('#graph-help-usage').textContent, /Organize um plano em etapas/);
  assert.match($('#graph-help-docs').textContent, /skill-a\/SKILL.md.*claude \/ codex.*Abrir item/);
  assert.equal(help.querySelectorAll('img').length, 0);
  const stale = byLabel('skill-two · instalada · codex');
  stale.focus();
  assert.equal($('#graph-help-title').textContent, 'skill-two · instalada · codex', 'keyboard focus outranks pointer hover');
  assert.match($('#graph-help-summary').textContent, /Ajuda a revisar código/);
  assert.doesNotMatch(help.textContent, /STALE PRIVATE HELP/, 'stale curation is never shown as current');
  assert.equal(skill.getAttribute('aria-describedby'), null);
  stale.fire('blur');
  assert.equal($('#graph-help-title').textContent, 'skill-a · instalada · claude / codex', 'hover returns after focus leaves');
  skill.fire('mouseleave', { relatedTarget: help });
  assert.equal(help.hidden, false, 'the popover can remain open for scrolling');
  help.onmouseleave();
  assert.equal(help.hidden, true);
  skill.focus();
  assert.equal(help.hidden, false);
  skill.fire('keydown', { key: 'Escape' });
  assert.equal(help.hidden, true);
  assert.equal(calls.length, 2, 'help needs no per-node catalog lookups');

  current = snapshot('snap-two-000000', [row('installed', 'skill-a', { hosts: ['claude', 'codex'], curation: 'stale', description: 'Ajuda a planejar tarefas.', metadata: { functional_description: 'OLD CURATED HELP' } })]);
  await context.loadCapabilities();
  assert.equal(doc.activeElement, byLabel('skill-a · instalada · claude / codex'), 'keyboard focus survives a snapshot reload');
  assert.match($('#graph-help-summary').textContent, /Ajuda a planejar tarefas/);
  assert.doesNotMatch(help.textContent, /OLD CURATED HELP|Planeja/, 'a new snapshot replaces curated help');
  assert.equal(byLabel('STARTUP ONLY'), undefined, 'the startup-only repository list is not the capability graph');

  let reads = 0; current = { get snapshot_id() { return `snap-${reads++}`; }, rows: [] };
  await context.loadCapabilities();
  assert.match($('#graph-intro').textContent, /O índice mudou durante a consulta/, 'pages from two snapshots are never mixed');

  current = Object.assign(Error('Catálogo indisponível. Verifique o Python local.'), { status: 503 });
  await context.loadCapabilities();
  assert.equal(buttons().length, 1);
  assert.match($('#graph-canvas').textContent, /Catálogo indisponível/);
});

test('task and knowledge graphs keep project scope, keyboard focus and help across refreshes', () => {
  const local = {
    view: 'graphs', graph: 'task', graphNode: null, graphModels: {}, projectId: 'a',
    state: {
      projects: [{ id: 'a', name: 'Projeto A', root: 'A' }, { id: 'b', name: 'Projeto B', root: 'B' }],
      sessions: [{ id: 'session-a', projectId: 'a', name: 'Sessão A', status: 'running' }, { id: 'session-b', projectId: 'b', name: 'PRIVATE SESSION B' }],
      tasks: [{ id: 'task-parent', projectId: 'a', title: 'Base A', status: 'done', dependsOn: [] },
        { id: 'task-a', projectId: 'a', title: 'Tarefa A', status: 'running', dependsOn: ['task-parent', 'task-b'] },
        { id: 'task-b', projectId: 'b', title: 'PRIVATE TASK B', status: 'blocked', dependsOn: [] }],
    },
    notes: [{ id: 'note-a', scope: 'project', projectId: 'a', text: 'Decisão privada A', source: 'owner A' },
      { id: 'note-b', scope: 'project', projectId: 'b', text: 'PRIVATE NOTE B', source: 'owner B' },
      { id: 'global', scope: 'global', text: 'Nota global autorizada', source: 'global' }],
  };
  const { doc, $, context, byLabel, help } = graphPage(local, async () => ({}));
  context.renderGraph();
  const task = byLabel('Tarefa A'); task.rect = { left: 700, right: 790, top: 390, bottom: 410 }; task.focus();
  assert.match($('#graph-help-summary').textContent, /Estado: running.*Base A/);
  assert.doesNotMatch(help.textContent, /PRIVATE TASK B/);
  assert.match($('#graph-help-docs').textContent, /Projeto A/);
  assert.equal($('#graph-help-usage').hidden, true);
  assert.equal(help.style.left, '412px');
  assert.equal(help.style.top, '62px', 'long help is clamped within a short viewport');
  context.renderGraph();
  assert.equal(doc.activeElement?.textContent, 'Tarefa A', 'keyboard focus survives a graph refresh');
  assert.equal(help.hidden, false);
  task.fire('blur');
  assert.equal(help.hidden, false, 'the refreshed focused node still owns its help');

  local.graph = 'knowledge'; context.renderGraph();
  assert.equal(help.hidden, true, 'switching graphs hides the previous help');
  assert.equal(byLabel('PRIVATE NOTE B'), undefined);
  byLabel('Decisão privada A').focus();
  assert.match($('#graph-help-summary').textContent, /Decisão privada A/);
  assert.match($('#graph-help-docs').textContent, /Projeto A/);
  local.projectId = 'b'; context.renderGraph();
  assert.equal(byLabel('Decisão privada A'), undefined);
  assert.ok(byLabel('PRIVATE NOTE B'));
  assert.doesNotMatch(help.textContent, /Decisão privada A/);
});

test('task and knowledge graphs show the most recent items, say what is hidden, and state that session notes are excluded', () => {
  const tasks = Array.from({ length: 18 }, (_, index) => ({ id: `t${index}`, projectId: 'a', title: `Tarefa ${index}`, status: 'open', dependsOn: index ? [`t${index - 1}`] : [] }));
  const notes = Array.from({ length: 11 }, (_, index) => ({ id: `n${index}`, scope: 'project', projectId: 'a', text: `Nota ${index}`, source: 'fonte', mutationSequence: index + 1 }));
  notes[0].mutationSequence = 99; notes[0].text = 'Nota antiga corrigida agora';
  notes.push({ id: 'session-note', scope: 'session', projectId: 'a', sessionId: 's5', text: 'Nota de sessão', source: 'fonte', mutationSequence: 100 });
  const sessions = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, projectId: 'a', name: `Sessão ${index}`, status: 'running' }));
  const local = { view: 'graphs', graph: 'task', graphNode: null, graphModels: {}, projectId: 'a', notes,
    state: { projects: [{ id: 'a', name: 'Projeto A', root: 'A' }], sessions, tasks } };
  const { $, context, byLabel } = graphPage(local, async () => ({}));
  context.renderGraph();
  assert.ok(byLabel('Tarefa 17'), 'the newest task is reachable');
  assert.equal(byLabel('Tarefa 0'), undefined);
  assert.match($('#graph-intro').textContent, /15 de 18 tarefas.*mais recentes.*3 mais antigas/);
  local.graph = 'knowledge'; context.renderGraph();
  assert.ok(byLabel('Nota antiga corrigida agora'), 'a recently corrected note outranks newer untouched ones');
  assert.equal(byLabel('Nota 1'), undefined);
  assert.equal(byLabel('Nota de sessão'), undefined);
  assert.ok(byLabel('Sessão 6'));
  assert.equal(byLabel('Sessão 0'), undefined);
  assert.match($('#graph-intro').textContent, /9 de 11 notas.*5 de 7 sessões.*Notas de sessão não aparecem/);
});

