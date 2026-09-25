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
  assert.throws(() => store.setTaskStatus(next.id, 'done'), /Dependências não concluídas/);
  assert.throws(() => store.addTask({ projectId: foreign.id, title: 'Leak', dependsOn: [base.id] }), /outro projeto/);
  store.setTaskStatus(base.id, 'done');
  store.setTaskStatus(next.id, 'done');
  assert.equal(store.task(next.id).status, 'done');
  assert.throws(() => store.setTaskStatus(base.id, 'open'), /dependentes concluídos/);
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
  assert.equal(store.addProject({ name: 'Visible', root: projectRoot }).name, 'Visible');
  assert.equal(store.snapshot().projects.length, 1);
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
