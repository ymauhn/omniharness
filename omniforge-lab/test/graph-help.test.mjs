import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

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

test('graph nodes show scoped hover and keyboard help, curated usage, and safe text', async () => {
  const { doc, ids, $ } = dom();
  let resolveSecond;
  const calls = [];
  const local = {
    graph: 'capability', graphNode: null, graphModels: {}, projectId: 'a',
    state: {
      projects: [{ id: 'a', name: 'Projeto A', root: 'A' }, { id: 'b', name: 'Projeto B', root: 'B' }],
      sessions: [{ id: 'session-a', projectId: 'a', name: 'Sessão A', status: 'running' }, { id: 'session-b', projectId: 'b', name: 'PRIVATE SESSION B' }],
      tasks: [{ id: 'task-parent', projectId: 'a', title: 'Base A', status: 'done', dependsOn: [] },
        { id: 'task-a', projectId: 'a', title: 'Tarefa A', status: 'running', dependsOn: ['task-parent', 'task-b'] },
        { id: 'task-b', projectId: 'b', title: 'PRIVATE TASK B', status: 'blocked', dependsOn: [] }],
      skills: [{ id: 'skill-a', name: 'Skill A', source: '.agents/skills/skill-a/SKILL.md', description: 'Ajuda a planejar tarefas.' },
        { id: 'skill-two', name: 'Skill Two', source: '.agents/skills/skill-two/SKILL.md', description: 'Ajuda a revisar código.' },
        { id: 'skill-retry', name: 'Skill Retry', source: '.agents/skills/skill-retry/SKILL.md', description: 'Descrição local de fallback.' }],
    },
    notes: [{ id: 'note-a', scope: 'project', projectId: 'a', text: 'Decisão privada A', source: 'owner A' },
      { id: 'note-b', scope: 'project', projectId: 'b', text: 'PRIVATE NOTE B', source: 'owner B' },
      { id: 'global', scope: 'global', text: 'Nota global autorizada', source: 'global' }],
  };
  let retryCount = 0;
  const api = route => {
    calls.push(route);
    if (route.includes('Skill+Two')) return new Promise(resolve => { resolveSecond = resolve; });
    if (route.includes('Skill+Retry')) {
      if (++retryCount === 1) return Promise.reject(new Error('catalog temporarily unavailable'));
      return Promise.resolve({ rows: [{ source_key: 'repo:.agents/skills/skill-retry/SKILL.md', curation: 'current',
        metadata: { functional_description: 'Ajuda curada recuperada.' } }] });
    }
    return Promise.resolve({ rows: [
      { source_key: 'repo:.agents/skills/other/SKILL.md', curation: 'current', metadata: { functional_description: 'PRIVATE WRONG SOURCE' } },
      { source_key: 'repo:.agents/skills/skill-a/SKILL.md', curation: 'current', metadata: {
        functional_description: 'Planeja <img src=x onerror=alert(1)> tarefas.', use_cases: { pt: ['Organize um plano em etapas.'] },
      } },
    ] });
  };
  const context = vm.createContext({ local, document: doc, window: { innerWidth: 800, innerHeight: 420 }, $, api, URLSearchParams,
    one: (parent, tag, className, content) => { const element = doc.createElement(tag); element.className = className; if (content !== undefined) element.textContent = content; parent.append(element); return element; },
    asArray: value => Array.isArray(value) ? value : [],
    projectById: id => local.state.projects.find(project => project.id === id),
    sessionById: id => local.state.sessions.find(session => session.id === id),
    statusLabel: status => status || '',
  });
  vm.runInContext(block('    function visibleNotes()', '    function renderMemory()') + block('    function makeNode(', '    const catalog=mountCatalog('), context);
  const buttons = () => $('#graph-canvas').querySelectorAll('.graph-node');
  const byLabel = label => [...buttons()].find(button => button.textContent === label);
  const help = $('#graph-help');

  context.renderGraph();
  const skill = byLabel('Skill A');
  skill.fire('mouseenter');
  assert.equal(help.hidden, false);
  assert.equal(skill.getAttribute('aria-describedby'), 'graph-help');
  assert.match($('#graph-help-summary').textContent, /Ajuda a planejar tarefas/);
  assert.match($('#graph-help-usage').textContent, /Uso:/);
  assert.match($('#graph-help-docs').textContent, /skill-a\/SKILL.md.*Abrir item/);
  await setImmediate();
  assert.match($('#graph-help-summary').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match($('#graph-help-usage').textContent, /Organize um plano em etapas/);
  assert.doesNotMatch(help.textContent, /PRIVATE WRONG SOURCE/);
  assert.equal(help.querySelectorAll('img').length, 0);
  assert.equal(calls.length, 1);
  const focusedOther = byLabel('Skill Two');
  focusedOther.focus();
  assert.equal($('#graph-help-title').textContent, 'Skill Two', 'keyboard focus outranks pointer hover');
  assert.equal(focusedOther.getAttribute('aria-describedby'), 'graph-help');
  assert.equal(skill.getAttribute('aria-describedby'), null);
  await setImmediate();
  focusedOther.fire('blur');
  assert.equal($('#graph-help-title').textContent, 'Skill A', 'hover returns after focus leaves');
  skill.fire('mouseleave', { relatedTarget: help });
  assert.equal(help.hidden, false, 'the popover can remain open for scrolling');
  help.onmouseleave();
  assert.equal(help.hidden, true);
  skill.fire('mouseenter');
  skill.fire('mouseleave');
  assert.equal(help.hidden, true);
  assert.equal(skill.getAttribute('aria-describedby'), null);
  skill.focus();
  assert.equal(help.hidden, false);
  assert.equal(calls.filter(route => route.includes('Skill+A')).length, 1, 'catalog metadata is reused on keyboard focus');
  skill.fire('keydown', { key: 'Escape' });
  assert.equal(help.hidden, true);

  byLabel('Skill Two').fire('mouseenter');
  assert.equal(help.hidden, false);
  local.graph = 'task'; context.renderGraph();
  assert.equal(help.hidden, true);
  resolveSecond({ rows: [{ source_key: 'repo:.agents/skills/skill-two/SKILL.md', curation: 'current', metadata: { functional_description: 'STALE PRIVATE HELP' } }] });
  await setImmediate();
  assert.doesNotMatch(help.textContent, /STALE PRIVATE HELP/);

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
  assert.equal(byLabel('PRIVATE NOTE B'), undefined);
  byLabel('Decisão privada A').focus();
  assert.match($('#graph-help-summary').textContent, /Decisão privada A/);
  assert.match($('#graph-help-docs').textContent, /Projeto A/);
  local.projectId = 'b'; context.renderGraph();
  assert.equal(byLabel('Decisão privada A'), undefined);
  assert.ok(byLabel('PRIVATE NOTE B'));
  assert.doesNotMatch(help.textContent, /Decisão privada A/);

  local.graph = 'capability'; context.renderGraph();
  const retry = byLabel('Skill Retry'); retry.fire('mouseenter');
  await setImmediate();
  assert.match($('#graph-help-summary').textContent, /Descrição local de fallback/);
  retry.fire('mouseleave'); retry.fire('mouseenter');
  await setImmediate();
  assert.equal(retryCount, 2, 'a failed metadata request is not cached forever');
  assert.match($('#graph-help-summary').textContent, /Ajuda curada recuperada/);
});
