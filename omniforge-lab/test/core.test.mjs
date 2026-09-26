import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WorkspaceStore, ShellCoordinator, inventoryAssets } from '../core.mjs';
import { PtyCoordinator } from '../pty.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-lab-test-'));
  const dataDir = path.join(root, 'data');
  const store = new WorkspaceStore(dataDir);
  t.after(() => {
    store.close();
    const relative = path.relative(os.tmpdir(), root);
    if (relative.startsWith('omniforge-lab-test-') && !relative.includes(path.sep)) fs.rmSync(root, { recursive: true, force: true });
  });
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot);
  return { root, projectRoot, store };
}

test('scoped memory is shared only with the matching project and session', t => {
  const { root, projectRoot, store } = fixture(t);
  const otherRoot = path.join(root, 'other');
  fs.mkdirSync(otherRoot);
  const first = store.addProject({ name: 'Game', root: projectRoot });
  const second = store.addProject({ name: 'Agency', root: otherRoot });
  const firstSession = store.addSession({ projectId: first.id, name: 'Build' });
  const sibling = store.addSession({ projectId: first.id, name: 'Review' });
  const otherSession = store.addSession({ projectId: second.id, name: 'Research' });
  store.addNote({ scope: 'global', source: 'owner', text: 'Prefer TDD' });
  store.addNote({ scope: 'project', projectId: first.id, source: 'CONTEXT.md', text: 'Game collision contract' });
  store.addNote({ scope: 'session', projectId: first.id, sessionId: firstSession.id, source: 'run log', text: 'Temporary hypothesis' });
  assert.deepEqual(store.contextFor(firstSession.id).map(note => note.text), ['Prefer TDD', 'Game collision contract', 'Temporary hypothesis']);
  assert.deepEqual(store.contextFor(sibling.id).map(note => note.text), ['Prefer TDD', 'Game collision contract']);
  assert.deepEqual(store.contextFor(otherSession.id).map(note => note.text), ['Prefer TDD']);
  store.close();
  const restored = new WorkspaceStore(path.join(root, 'data'));
  assert.equal(restored.session(firstSession.id).status, 'interrupted');
  assert.equal(restored.contextFor(sibling.id).length, 2);
  restored.close();
});

test('task dependencies are project-scoped and block premature completion', t => {
  const { root, projectRoot, store } = fixture(t);
  const secondRoot = path.join(root, 'second');
  fs.mkdirSync(secondRoot);
  const project = store.addProject({ name: 'Game', root: projectRoot });
  const foreign = store.addProject({ name: 'Agency', root: secondRoot });
  const base = store.addTask({ projectId: project.id, title: 'Failing test' });
  const next = store.addTask({ projectId: project.id, title: 'Fix', dependsOn: [base.id] });
  assert.throws(() => store.setTaskStatus(next.id, 'done', 1), /Dependências não concluídas/);
  assert.throws(() => store.addTask({ projectId: foreign.id, title: 'Leak', dependsOn: [base.id] }), /outro projeto/);
  store.setTaskStatus(base.id, 'done', 1);
  store.setTaskStatus(next.id, 'done', 1);
  assert.equal(store.task(next.id).status, 'done');
  assert.throws(() => store.setTaskStatus(base.id, 'open', 2), /dependentes concluídos/);
});

test('task status writes are revisioned so a stale view cannot overwrite a newer status', t => {
  const { root, projectRoot, store } = fixture(t);
  const project = store.addProject({ name: 'Game', root: projectRoot });
  const task = store.addTask({ projectId: project.id, title: 'Race', details: 'Race\nFull composer draft' });
  assert.equal(task.revision, 1);
  assert.equal(task.details, 'Race\nFull composer draft');
  assert.throws(() => store.addTask({ projectId: project.id, title: 'Too long', details: 'x'.repeat(4001) }), /Detalhes da tarefa inválido/);
  assert.equal(store.setTaskStatus(task.id, 'done', 1).revision, 2);
  assert.throws(() => store.setTaskStatus(task.id, 'blocked', 1), error => error.status === 409 && /Tarefa alterada/.test(error.message));
  assert.throws(() => store.setTaskStatus(task.id, 'blocked'), error => error.status === 400);
  assert.equal(store.task(task.id).status, 'done');
  const saved = store.snapshot();
  delete saved.tasks[0].revision;
  store.close();
  fs.writeFileSync(path.join(root, 'data', 'state.json'), JSON.stringify(saved));
  const migrated = new WorkspaceStore(path.join(root, 'data'));
  try { assert.equal(migrated.setTaskStatus(task.id, 'open', 1).revision, 2); }
  finally { migrated.close(); }
});

test('memory revisions reject competing writes and preserve archived history across restart', t => {
  const { root, projectRoot, store } = fixture(t);
  const project = store.addProject({ name: 'Memory', root: projectRoot });
  const session = store.addSession({ projectId: project.id, name: 'Reader' });
  const binding = { scope: 'project', projectId: project.id };
  const note = store.addNote({ ...binding, source: 'owner', text: 'First fact' });
  assert.equal(note.revision, 1);
  const edited = store.updateNote(note.id, { ...binding, expectedRevision: 1, source: 'review', text: 'Corrected fact' });
  assert.equal(edited.revision, 2);
  assert.equal(edited.createdAt, note.createdAt);
  assert.ok(edited.updatedAt >= edited.createdAt);
  assert.throws(() => store.updateNote(note.id, { ...binding, expectedRevision: 1, source: 'stale reader', text: 'Lost update' }), error => error.status === 409);
  assert.equal(store.contextFor(session.id)[0].text, 'Corrected fact');
  assert.equal(store.contextFor(session.id)[0].revision, 2);
  assert.equal(Object.hasOwn(store.contextFor(session.id)[0], 'history'), false);
  const archived = store.archiveNote(note.id, { ...binding, expectedRevision: 2, source: 'owner forget' });
  assert.equal(archived.revision, 3);
  assert.ok(archived.archivedAt);
  assert.deepEqual(store.contextFor(session.id), []);
  assert.equal(store.snapshot().memoryRevision, 3);
  store.close();
  const restored = new WorkspaceStore(path.join(root, 'data'));
  try {
    assert.deepEqual(restored.notesFor({ projectId: project.id }), []);
    assert.deepEqual(restored.noteHistory(note.id, binding).map(version => version.text), ['First fact', 'Corrected fact', 'Corrected fact']);
    assert.equal(restored.snapshot().memoryRevision, 3);
  } finally { restored.close(); }
});

test('memory mutation and history require the immutable project and session binding', t => {
  const { root, projectRoot, store } = fixture(t);
  const otherRoot = path.join(root, 'other');
  fs.mkdirSync(otherRoot);
  const a = store.addProject({ name: 'A', root: projectRoot });
  const b = store.addProject({ name: 'B', root: otherRoot });
  const sa = store.addSession({ projectId: a.id, name: 'A1' });
  const sibling = store.addSession({ projectId: a.id, name: 'A2' });
  const sb = store.addSession({ projectId: b.id, name: 'B1' });
  const binding = { scope: 'session', projectId: a.id, sessionId: sa.id };
  const note = store.addNote({ ...binding, source: 'private', text: 'PRIVATE_SESSION_FACT' });
  for (const wrong of [{ ...binding, projectId: b.id }, { ...binding, sessionId: sibling.id }, { ...binding, sessionId: sb.id }, { scope: 'project', projectId: a.id }]) {
    for (const operation of [() => store.noteHistory(note.id, wrong), () => store.updateNote(note.id, { ...wrong, expectedRevision: 1, source: 'editor', text: 'overwrite' }), () => store.archiveNote(note.id, { ...wrong, expectedRevision: 1, source: 'owner' })]) {
      assert.throws(operation, error => [400, 404].includes(error.status) && !error.message.includes('PRIVATE_SESSION_FACT'));
    }
  }
  assert.throws(() => store.notesFor({ projectId: b.id, sessionId: sa.id }), error => error.status === 400);
  assert.throws(() => store.contextBriefFor(sa.id, 4000, b.id), error => error.status === 400);
  assert.deepEqual(store.notesFor({ projectId: b.id, sessionId: sb.id }), []);
  assert.deepEqual(store.notesFor({ projectId: a.id, sessionId: sibling.id }), []);
  assert.equal(store.contextFor(sa.id)[0].text, 'PRIVATE_SESSION_FACT');
  assert.equal(store.snapshot().memoryRevision, 1);
});

test('legacy notes migrate without losing identity, scope, source, text or timestamps', t => {
  const { root, projectRoot, store } = fixture(t);
  const project = store.addProject({ name: 'Legacy', root: projectRoot });
  const old = { id: 'legacy-note', scope: 'project', projectId: project.id, sessionId: null, source: 'CONTEXT.md', text: '  Texto antigo 🤖\ncom espaços  ', createdAt: '2025-01-02T03:04:05.000Z' };
  const legacy = store.snapshot();
  legacy.notes = [old];
  delete legacy.memoryRevision;
  store.close();
  fs.writeFileSync(path.join(root, 'data', 'state.json'), JSON.stringify(legacy));
  const migrated = new WorkspaceStore(path.join(root, 'data'));
  try {
    const note = migrated.notesFor({ projectId: project.id })[0];
    for (const [key, value] of Object.entries(old)) assert.equal(note[key], value);
    assert.equal(note.revision, 1);
    assert.equal(note.mutationSequence, 0);
    assert.equal(note.updatedAt, old.createdAt);
    assert.equal(note.archivedAt, null);
    assert.equal(migrated.noteHistory(old.id, { scope: 'project', projectId: project.id })[0].text, old.text);
    assert.equal(migrated.snapshot().memoryRevision, 1);
  } finally { migrated.close(); }
  const reopened = new WorkspaceStore(path.join(root, 'data'));
  try { assert.equal(reopened.noteHistory(old.id, { scope: 'project', projectId: project.id }).length, 1); }
  finally { reopened.close(); }
});

test('versioned notes migrate with existing history intact and use timestamps until a new commit', t => {
  const { root, projectRoot, store } = fixture(t);
  const project = store.addProject({ name: 'Prior versions', root: projectRoot });
  const session = store.addSession({ projectId: project.id, name: 'Reader' });
  const binding = { scope: 'project', projectId: project.id };
  const first = store.addNote({ ...binding, source: 'original source', text: 'First fact' });
  const second = store.addNote({ ...binding, source: 'second source', text: 'Second fact' });
  store.updateNote(first.id, { ...binding, expectedRevision: 1, source: 'saved review', text: 'Saved correction' });
  const saved = store.snapshot();
  saved.notes[0].updatedAt = '2026-09-25T12:00:01.000Z';
  saved.notes[1].updatedAt = '2026-09-25T12:00:00.000Z';
  for (const note of saved.notes) {
    delete note.mutationSequence;
    for (const version of note.history) delete version.mutationSequence;
  }
  store.close();
  fs.writeFileSync(path.join(root, 'data', 'state.json'), JSON.stringify(saved));
  const migrated = new WorkspaceStore(path.join(root, 'data'));
  try {
    assert.deepEqual(migrated.snapshot().notes, saved.notes.map(note => ({ ...note, mutationSequence: 0 })));
    assert.equal(migrated.snapshot().memoryRevision, 3);
    assert.deepEqual(migrated.contextFor(session.id).map(note => note.id), [second.id, first.id]);
    t.mock.method(Date.prototype, 'toISOString', () => '2026-09-25T11:00:00.000Z');
    const updated = migrated.updateNote(second.id, { ...binding, expectedRevision: 1, source: 'new review', text: 'New committed correction' });
    assert.equal(updated.mutationSequence, 4);
    assert.equal(migrated.contextFor(session.id).at(-1).id, second.id);
    assert.deepEqual(migrated.noteHistory(second.id, binding).slice(0, -1), saved.notes[1].history);
  } finally { migrated.close(); }
});

test('failed memory edits and archives roll back content, versions, history and invalidation counter', t => {
  const { projectRoot, store } = fixture(t);
  const project = store.addProject({ name: 'Durable', root: projectRoot });
  const binding = { scope: 'project', projectId: project.id };
  const note = store.addNote({ ...binding, source: 'owner', text: 'Durable fact' });
  const before = store.snapshot();
  const rename = fs.renameSync;
  try {
    fs.renameSync = (source, target) => {
      if (target === store.file) throw new Error('memory disk write failed');
      return rename(source, target);
    };
    assert.throws(() => store.updateNote(note.id, { ...binding, expectedRevision: 1, source: 'editor', text: 'Uncommitted fact' }), /memory disk write failed/);
    assert.deepEqual(store.snapshot(), before);
    assert.throws(() => store.archiveNote(note.id, { ...binding, expectedRevision: 1, source: 'owner forget' }), /memory disk write failed/);
    assert.deepEqual(store.snapshot(), before);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')), before);
  assert.equal(store.updateNote(note.id, { ...binding, expectedRevision: 1, source: 'editor', text: 'Committed fact' }).revision, 2);
});

test('memory validates write bounds and context contains only bounded current versions', t => {
  const { projectRoot, store } = fixture(t);
  const project = store.addProject({ name: 'Bounds', root: projectRoot });
  const session = store.addSession({ projectId: project.id, name: 'Reader' });
  const binding = { scope: 'project', projectId: project.id };
  const note = store.addNote({ ...binding, source: 'owner', text: 'OLD_BODY_ONLY'.repeat(300) });
  const update = { ...binding, expectedRevision: 1, source: 'editor', text: 'Current fact' };
  for (const change of [{ expectedRevision: 0 }, { expectedRevision: 1.5 }, { expectedRevision: '1' }, { text: 'x'.repeat(4001) }, { source: 'x'.repeat(301) }, { source: '' }]) {
    assert.throws(() => store.updateNote(note.id, { ...update, ...change }), error => error.status === 400);
  }
  store.updateNote(note.id, update);
  for (let index = 0; index < 30; index++) store.addNote({ ...binding, source: 'owner', text: `New note ${index}` });
  for (const limit of [128, 4000, 65536, 999999]) {
    const brief = store.contextBriefFor(session.id, limit);
    assert.ok(JSON.stringify(brief).length <= brief.limit);
    assert.ok(brief.notes.length <= 24);
    assert.equal(JSON.stringify(brief).includes('OLD_BODY_ONLY'), false);
    assert.ok(brief.notes.every(item => item.revision >= 1 && !Object.hasOwn(item, 'history')));
  }
  assert.equal(store.notesFor({ projectId: project.id })[0].text, 'Current fact');
  assert.equal(store.snapshot().memoryRevision, 32);
});

test('context prioritizes the latest committed correction over creation order and local revision at equal timestamps', t => {
  const { root, projectRoot, store } = fixture(t);
  t.mock.method(Date.prototype, 'toISOString', () => '2026-09-25T12:00:00.000Z');
  const project = store.addProject({ name: 'Recent corrections', root: projectRoot });
  const session = store.addSession({ projectId: project.id, name: 'Reader' });
  const binding = { scope: 'project', projectId: project.id };
  const notes = Array.from({ length: 31 }, (_, index) => store.addNote({ ...binding, source: 'owner', text: `Fact ${index}` }));
  for (let revision = 1; revision <= 4; revision++) {
    store.updateNote(notes[1].id, { ...binding, expectedRevision: revision, source: 'earlier review', text: `Previous correction ${revision}` });
  }
  const latest = store.updateNote(notes[0].id, { ...binding, expectedRevision: 1, source: 'latest review', text: 'Newest corrected fact' });
  for (const limit of [4000, 65536]) {
    const brief = store.contextBriefFor(session.id, limit);
    assert.equal(brief.notes.at(-1)?.text, 'Newest corrected fact', 'A recent correction of the oldest note must survive the bounded context selection');
    assert.equal(brief.notes.at(-1).id, notes[0].id);
    assert.ok(brief.notes.length <= 24);
    assert.ok(JSON.stringify(brief).length <= brief.limit);
    assert.equal(brief.truncated, true);
  }
  assert.equal(latest.updatedAt, notes[30].updatedAt);
  assert.equal(latest.mutationSequence, 36);
  assert.equal(store.noteHistory(notes[0].id, binding).at(-1).mutationSequence, 36);
  const ids = store.contextFor(session.id, 65536).map(note => note.id);
  store.close();
  const restored = new WorkspaceStore(path.join(root, 'data'));
  try {
    assert.deepEqual(restored.contextFor(session.id, 65536).map(note => note.id), ids);
    assert.equal(restored.snapshot().memoryRevision, 36);
  } finally { restored.close(); }
});

test('restart does not pretend a shell process survived', t => {
  const { root, projectRoot, store } = fixture(t);
  const project = store.addProject({ name: 'Game', root: projectRoot });
  const session = store.addSession({ projectId: project.id, name: 'Build' });
  store.setSessionStatus(session.id, 'running');
  store.close();
  const restored = new WorkspaceStore(path.join(root, 'data'));
  assert.equal(restored.session(session.id).status, 'interrupted');
  assert.throws(() => restored.addSession({ projectId: project.id, name: 'New attempt' }), /sessão incerta/);
  restored.acknowledgeInterruptedSession(session.id, 'Operador inspecionou a árvore de processos e confirmou encerramento');
  assert.equal(restored.addSession({ projectId: project.id, name: 'New attempt' }).status, 'starting');
  restored.close();
});

test('failed persistence does not leak an uncommitted project into later state', t => {
  const { projectRoot, store } = fixture(t);
  const rename = fs.renameSync;
  try {
    fs.renameSync = (source, target) => {
      if (target === store.file) throw new Error('disk write failed');
      return rename(source, target);
    };
    assert.throws(() => store.addProject({ name: 'Invisible', root: projectRoot }), /disk write failed/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(store.snapshot().projects.length, 0);
  assert.deepEqual(fs.readdirSync(store.dataDir).filter(name => name.endsWith('.tmp')), []);
  assert.equal(store.addProject({ name: 'Visible', root: projectRoot }).name, 'Visible');
  assert.equal(store.snapshot().projects.length, 1);
});

test('state is flushed before it replaces state.json and a torn state.json falls back to the last good backup', t => {
  const { root, projectRoot, store } = fixture(t);
  const dataDir = path.join(root, 'data');
  const rename = fs.renameSync;
  const opened = t.mock.method(fs, 'openSync');
  const synced = t.mock.method(fs, 'fsyncSync');
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === store.file) {
      const fd = opened.mock.calls.findLast(call => call.arguments[0] === source)?.result;
      assert.ok(fd !== undefined && synced.mock.calls.some(call => call.arguments[0] === fd), 'new state must be fsynced before it replaces state.json');
    }
    return rename(source, target);
  });
  const project = store.addProject({ name: 'Kept', root: projectRoot });
  store.addTask({ projectId: project.id, title: 'Lost with the torn write' });
  store.close();
  fs.writeFileSync(store.file, Buffer.alloc(fs.statSync(store.file).size));
  const warn = t.mock.method(console, 'warn', () => {});
  const restored = new WorkspaceStore(dataDir);
  try {
    assert.deepEqual(restored.snapshot().projects.map(item => item.id), [project.id]);
    assert.equal(restored.snapshot().tasks.length, 0);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], /state\.json\.bak/);
    assert.ok(fs.readdirSync(dataDir).some(name => name.startsWith('state.json.corrupt-')));
    assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).projects.length, 1);
  } finally { restored.close(); }
});

test('an unverifiable lock owner fails closed and names the lock and the manual recovery', t => {
  const { root, store } = fixture(t);
  const dataDir = path.join(root, 'data');
  store.close();
  const lock = path.join(dataDir, 'state.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 4242, nonce: 'elevated-or-reused' }));
  t.mock.method(process, 'kill', () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }); });
  assert.throws(() => new WorkspaceStore(dataDir), error => error.status === 409 && error.message.includes(lock) && /renomeie/.test(error.message));
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).nonce, 'elevated-or-reused');
  assert.equal(fs.existsSync(path.join(dataDir, 'state.recovery.lock')), false);
});

test('second coordinator cannot overwrite an active local state writer', t => {
  const { root, projectRoot, store } = fixture(t);
  store.addProject({ name: 'First', root: projectRoot });
  assert.throws(() => new WorkspaceStore(path.join(root, 'data')), /Outra instância/);
  store.close();
  const reopened = new WorkspaceStore(path.join(root, 'data'));
  assert.equal(reopened.snapshot().projects.length, 1);
  reopened.close();
});

test('two crash recoverers cannot both acquire the same state writer lock', t => {
  const { root, store } = fixture(t);
  const dataDir = path.join(root, 'data');
  store.close();
  fs.writeFileSync(path.join(dataDir, 'state.lock'), JSON.stringify({ pid: 99999999, nonce: 'old-owner' }));
  const rename = fs.renameSync;
  let contenderRejected = false;
  try {
    fs.renameSync = (source, destination) => {
      if (source === path.join(dataDir, 'state.lock')) {
        assert.throws(() => new WorkspaceStore(dataDir), /Recuperação local em andamento/);
        contenderRejected = true;
      }
      return rename(source, destination);
    };
    const recovered = new WorkspaceStore(dataDir);
    assert.equal(contenderRejected, true);
    assert.throws(() => new WorkspaceStore(dataDir), /Outra instância/);
    recovered.close();
  } finally {
    fs.renameSync = rename;
  }
});

test('unavailable shell does not report a running session', async t => {
  const { projectRoot, store } = fixture(t);
  const project = store.addProject({ name: 'Game', root: projectRoot });
  const session = store.addSession({ projectId: project.id, name: 'Unavailable' });
  const shells = new ShellCoordinator(store, { shell: 'omni-shell-that-does-not-exist.exe' });
  const errorEvent = once(shells, 'terminal');
  assert.throws(() => shells.start(session.id), /indisponível/);
  await errorEvent;
  assert.equal(store.session(session.id).status, 'interrupted');
});

test('asset inventory stays in the chosen project and skips ignored directories', async t => {
  const { projectRoot } = fixture(t);
  fs.writeFileSync(path.join(projectRoot, 'hero.png'), 'x');
  fs.mkdirSync(path.join(projectRoot, 'node_modules'));
  fs.writeFileSync(path.join(projectRoot, 'node_modules', 'vendor.png'), 'x');
  const result = await inventoryAssets(projectRoot);
  assert.deepEqual(result.files, ['hero.png']);
  assert.deepEqual(result.counts, { '.png': 1 });
  assert.equal(result.truncated, false);
});

test('asset inventory skips unreadable subdirectories and reports an unavailable project root', async t => {
  const { projectRoot } = fixture(t);
  fs.writeFileSync(path.join(projectRoot, 'hero.png'), 'x');
  fs.mkdirSync(path.join(projectRoot, 'locked'));
  fs.writeFileSync(path.join(projectRoot, 'locked', 'hidden.png'), 'x');
  const opendir = fs.promises.opendir;
  t.mock.method(fs.promises, 'opendir', (dir, ...rest) => path.basename(dir) === 'locked' ? Promise.reject(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })) : opendir(dir, ...rest));
  const result = await inventoryAssets(projectRoot);
  assert.deepEqual(result.files, ['hero.png']);
  assert.equal(result.unreadableDirectories, 1);
  assert.equal(result.truncated, true);
  await assert.rejects(inventoryAssets(path.join(projectRoot, 'moved')), error => error.status === 409 && /Pasta do projeto indisponível/.test(error.message));
});

test('asset inventory bounds a media-sparse traversal', async t => {
  const { projectRoot } = fixture(t);
  for (let index = 0; index < 20; index++) fs.writeFileSync(path.join(projectRoot, `source-${index}.txt`), 'x');
  const result = await inventoryAssets(projectRoot, { maxEntries: 3 });
  assert.equal(result.scannedEntries, 3);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.files, []);
});

test('context brief bounds tiny-note metadata as well as text', t => {
  const { projectRoot, store } = fixture(t);
  const project = store.addProject({ name: 'OmniHarness', root: projectRoot });
  const session = store.addSession({ projectId: project.id, name: 'Brief' });
  for (let index = 0; index < 100; index++) store.data.notes.push({
    id: `note-${index}`, scope: 'project', projectId: project.id, sessionId: null,
    source: 'a'.repeat(300), text: 'x', createdAt: '2026-09-25T00:00:00Z',
  });
  const brief = store.contextBriefFor(session.id);
  assert.equal(brief.truncated, true);
  assert.ok(brief.notes.length <= 24);
  assert.ok(JSON.stringify(brief).length <= brief.limit);
});

test('two live line-oriented shells preserve distinct project directories', async t => {
  const { root, projectRoot, store } = fixture(t);
  const otherRoot = path.join(root, 'other');
  fs.mkdirSync(otherRoot);
  const a = store.addProject({ name: 'A', root: projectRoot });
  const b = store.addProject({ name: 'B', root: otherRoot });
  const sa = store.addSession({ projectId: a.id, name: 'Shell A' });
  const sb = store.addSession({ projectId: b.id, name: 'Shell B' });
  const shells = new ShellCoordinator(store);
  const outputs = new Map([[sa.id, ''], [sb.id, '']]);
  shells.on('terminal', event => outputs.set(event.sessionId, outputs.get(event.sessionId) + event.text));
  try {
    shells.start(sa.id);
    shells.start(sb.id);
    const command = process.platform === 'win32' ? 'Write-Output $PWD.Path' : 'pwd';
    shells.command(sa.id, command);
    shells.command(sb.id, command);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && (!outputs.get(sa.id).includes(projectRoot) || !outputs.get(sb.id).includes(otherRoot))) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(outputs.get(sa.id).toLowerCase().includes(projectRoot.toLowerCase()), JSON.stringify([...outputs]));
    assert.ok(outputs.get(sb.id).toLowerCase().includes(otherRoot.toLowerCase()), JSON.stringify([...outputs]));
    assert.ok(!outputs.get(sa.id).includes(otherRoot));
    assert.ok(!outputs.get(sb.id).includes(projectRoot));
  } finally {
    for (const id of [...shells.processes.keys()]) shells.command(id, 'exit');
    const end = Date.now() + 3000;
    while (shells.processes.size && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
    if (shells.processes.size) await shells.closeAll();
  }
});

test('PowerShell 7 preserves a non-ASCII project path in terminal output', async t => {
  if (process.platform !== 'win32') return;
  const { root, store } = fixture(t);
  const projectRoot = path.join(root, 'café');
  fs.mkdirSync(projectRoot);
  const project = store.addProject({ name: 'Café', root: projectRoot });
  const session = store.addSession({ projectId: project.id, name: 'Unicode' });
  const shells = new PtyCoordinator(store);
  let output = '';
  shells.on('terminal', event => { if (event.sessionId === session.id) output += event.text; });
  try {
    shells.start(session.id);
    const readyBy = Date.now() + 10000;
    while (Date.now() < readyBy && store.session(session.id).status !== 'running') await new Promise(resolve => setTimeout(resolve, 25));
    while (Date.now() < readyBy && !output.includes('PS ')) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(output.includes('PS '), output);
    shells.command(session.id, "Write-Output ('UNICODE_MARK ' + $PWD.Path)");
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !output.includes(`UNICODE_MARK ${projectRoot}`)) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(output.includes(`UNICODE_MARK ${projectRoot}`), output);
  } finally {
    await shells.closeAll();
  }
});
