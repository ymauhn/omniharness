import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryPanelController } from '../memory-panel.mjs';

const note = (overrides = {}) => ({ id: 'n', scope: 'project', projectId: 'p', sessionId: null,
  revision: 1, text: 'original', source: 'evidence', archivedAt: null, ...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('memory edits bind exact immutable revision and retain a conflicting draft', async () => {
  let body, updated = false;
  const controller = new MemoryPanelController({ api: async (route, options) => {
    if (options) { body = options.body; throw Object.assign(Error('conflict'), { status: 409 }); }
    return { notes: [note({ revision: updated ? 2 : 1, text: updated ? 'other session' : 'original' })] };
  } });
  controller.select('p'); await controller.load(); controller.edit('n');
  controller.editor.text = 'my draft'; controller.editor.source = 'new evidence';
  updated = true; await controller.load();
  assert.equal(controller.editor.text, 'my draft');
  assert.equal(controller.editor.note.revision, 1);
  assert.match(controller.message, /outra sessão/);
  await controller.save();
  assert.deepEqual(body, { scope: 'project', projectId: 'p', sessionId: null, expectedRevision: 1, text: 'my draft', source: 'new evidence' });
  assert.equal(controller.editor.text, 'my draft');
  assert.equal(controller.busy, false);
  assert.match(controller.message, /Conflito/);
  controller.cancel(); controller.edit('n');
  assert.equal(controller.editor.note.revision, 2);
});

test('late reads/history/mutations never repopulate another selected project', async () => {
  const pending = deferred();
  const controller = new MemoryPanelController({ api: () => pending.promise });
  controller.select('p'); const loading = controller.load(); controller.select('q');
  pending.resolve({ notes: [note()] }); await loading;
  assert.deepEqual(controller.notes, []);
  controller.select('p'); controller.notes = [note()];
  const history = deferred(); controller.api = () => history.promise;
  const inspecting = controller.inspect('n'); controller.select('q');
  history.resolve({ history: [{ text: 'private history' }] }); await inspecting;
  assert.equal(controller.history, null);
  controller.select('p'); controller.notes = [note()]; controller.edit('n');
  const saved = deferred(); controller.api = () => saved.promise;
  const saving = controller.save(); controller.select('q');
  controller.notes = [note({ id: 'q-note', projectId: 'q' })]; controller.edit('q-note');
  saved.resolve({}); await saving;
  assert.equal(controller.editor.note.id, 'q-note');
  assert.equal(controller.busy, false);
});

test('history and archive use exact session binding; archived notes stay readable, never editable', async () => {
  const routes = [], selected = note({ scope: 'session', sessionId: 's' });
  let archived = false, changes = 0;
  const controller = new MemoryPanelController({ changed: () => changes++, api: async (route, options) => {
    routes.push({ route, options });
    if (options) { archived = true; return {}; }
    if (route.includes('/history')) return { noteId: 'n', offset: 0, limit: 20, total: 1, hasMore: false, history: [{ revision: 1, text: 'original' }] };
    return { notes: [selected, note({ id: 'foreign', projectId: 'q' }), note({ id: 'sibling', scope: 'session', sessionId: 'other' })]
      .map(item => ({ ...item, archivedAt: archived ? 'now' : null })) };
  } });
  controller.select('p', 's'); await controller.load();
  assert.deepEqual(controller.notes.map(item => item.id), ['n']);
  await controller.inspect('n');
  assert.match(routes.at(-1).route, /scope=session&projectId=p&sessionId=s/);
  controller.edit('n', 'archive'); controller.editor.source = 'owner archive reason'; await controller.save();
  assert.equal(changes, 1); assert.deepEqual(controller.notes, []);
  const write = routes.find(item => item.options);
  assert.equal(write.route, '/api/memory/n/archive');
  assert.deepEqual(write.options.body, { scope: 'session', projectId: 'p', sessionId: 's', expectedRevision: 1, source: 'owner archive reason' });
  controller.select('p', 's', true); await controller.load();
  controller.edit('n'); assert.equal(controller.editor, null);
  await controller.inspect('n'); assert.equal(controller.history.rows[0].text, 'original');
});

test('duplicate submissions are refused and out-of-order list responses are ignored', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const controller = new MemoryPanelController({ api: () => (++calls === 1 ? first.promise : second.promise) });
  controller.select('p'); const a = controller.load(), b = controller.load();
  second.resolve({ notes: [note({ revision: 2 })] }); await b;
  first.resolve({ notes: [note()] }); await a;
  assert.equal(controller.notes[0].revision, 2);
  const write = deferred(); calls = 0; controller.api = (_route, options) => { if (options) { calls++; return write.promise; } return { notes: [] }; };
  controller.edit('n'); const saving = controller.save(); await controller.save();
  assert.equal(calls, 1); write.resolve({}); await saving;
  assert.equal(controller.editor, null);
});
