import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { mountMemoryPanel } from '../memory-panel.mjs';

// Only the actual controller's DOM event contract; no browser/rendering verdict.
function dom() {
  const doc = {};
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.ownerDocument = doc; this._text = ''; }
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; this._text = ''; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    setAttribute() {}
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    async fire(type) { if (!this.disabled) for (const fn of this.events[type] || []) await fn({ target: this, preventDefault() {} }); }
    querySelectorAll(tags) { const wanted = tags.split(','); return this.children.flatMap(child => [...(wanted.includes(child.tag) ? [child] : []), ...child.querySelectorAll(tags)]); }
    querySelector(tags) { return this.querySelectorAll(tags)[0]; }
    contains(value) { return this === value || this.children.some(child => child.contains(value)); }
    focus() { doc.activeElement = this; }
    get value() { return this._value ?? ''; }
    set value(value) { this._value = value; }
  }
  doc.createElement = tag => new Element(tag);
  return { root: new Element('section'), doc };
}

test('mounted memory controls preserve focus/draft through refresh, conflict and explicit reopen', async () => {
  const { root, doc } = dom();
  let revision = 1, projectId = 'p', write;
  const panel = mountMemoryPanel({ root, getProjectId: () => projectId, getSessions: () => [], api: async (_route, options) => {
    if (options) { write = options.body; throw Object.assign(Error('stale'), { status: 409 }); }
    return { notes: [{ id: 'n', scope: 'project', projectId: 'p', sessionId: null, revision, text: `revision ${revision}`, source: 'source', archivedAt: null }] };
  } });
  const button = label => root.querySelectorAll('button').find(node => node.textContent === label);
  panel.sync(1); await setImmediate();
  button('Histórico').focus(); await panel.load();
  assert.equal(doc.activeElement, button('Histórico'));
  await button('Editar').fire('click');
  const field = root.querySelector('textarea'); field.value = 'unsaved correction'; await field.fire('input');
  revision = 2; panel.sync(2); await setImmediate();
  assert.equal(root.querySelector('textarea'), field);
  assert.equal(doc.activeElement, field);
  assert.equal(field.value, 'unsaved correction');
  await root.querySelector('form').fire('submit'); await setImmediate();
  assert.equal(write.expectedRevision, 1);
  assert.equal(write.text, 'unsaved correction');
  assert.match(root.textContent, /Conflito/);
  assert.equal(root.querySelector('textarea').value, 'unsaved correction');
  await button('Cancelar rascunho').fire('click'); await button('Editar').fire('click');
  assert.equal(root.querySelector('textarea').value, 'revision 2');
  projectId = 'q'; panel.sync(2); await setImmediate();
  assert.equal(root.querySelector('textarea'), undefined);
  assert.equal(root.textContent.includes('revision 2'), false);
});

test('history navigation replaces bounded pages instead of accumulating revisions in the DOM', async () => {
  const { root, doc } = dom();
  const history = Array.from({ length: 46 }, (_, index) => ({ revision: index + 1, text: `history ${index + 1}`, operation: 'update', source: 'fixture', updatedAt: 'now' }));
  const panel = mountMemoryPanel({ root, getProjectId: () => 'p', getSessions: () => [], api: async route => {
    if (route.includes('/history')) {
      const offset = Number(new URL(route, 'http://local').searchParams.get('offset'));
      return { noteId: 'n', offset, limit: 20, total: 46, hasMore: offset + 20 < 46, history: history.slice(offset, offset + 20) };
    }
    return { notes: [{ id: 'n', scope: 'project', projectId: 'p', revision: 46, text: 'current', source: 'fixture' }] };
  } });
  const button = label => root.querySelectorAll('button').find(node => node.textContent === label);
  panel.sync(1); await setImmediate(); await button('Histórico').fire('click');
  assert.equal(root.querySelectorAll('details').length, 20);
  assert.match(root.textContent, /1–20 de 46/);
  button('Próximas revisões').focus();
  await button('Próximas revisões').fire('click');
  assert.ok(root.contains(doc.activeElement), 'history paging retains a connected focus target');
  assert.equal(root.querySelectorAll('details').length, 20);
  assert.match(root.textContent, /21–40 de 46/);
  await button('Próximas revisões').fire('click');
  assert.equal(root.querySelectorAll('details').length, 6);
  assert.equal(button('Próximas revisões').disabled, true);
  await button('Revisões anteriores').fire('click');
  assert.equal(root.querySelectorAll('details').length, 20);
  const summary = root.querySelector('summary'); summary.focus();
  await panel.load();
  assert.ok(root.contains(doc.activeElement), 'ordinary refresh retains history summary focus');
});
