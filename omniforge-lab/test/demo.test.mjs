import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOmniForgeServer } from '../server.mjs';
import { seedDemo, startDemo } from '../demo.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-demo-test-'));
  const repoRoot = path.join(root, 'repo');
  const tempRoot = path.join(root, 'temp');
  fs.mkdirSync(path.join(repoRoot, '.omniforge-lab'), { recursive: true });
  fs.mkdirSync(tempRoot);
  const sentinel = path.join(repoRoot, '.omniforge-lab', 'state.json');
  fs.writeFileSync(sentinel, 'owner-state-must-remain-untouched');
  const apps = [];
  t.after(async () => {
    for (const app of apps) await app.close();
    const actual = fs.realpathSync.native(root);
    assert.equal(path.dirname(actual), fs.realpathSync.native(os.tmpdir()));
    assert.match(path.basename(actual), /^omniforge-demo-test-/);
    fs.rmSync(actual, { recursive: true });
  });
  return { repoRoot, tempRoot, sentinel, apps };
}

function stubPtys(apps, checkListen = () => {}) {
  return options => {
    const app = createOmniForgeServer(options);
    apps.push(app);
    const starts = [];
    const listen = app.listen.bind(app);
    app.shells.start = id => {
      assert.equal(app.store.session(id).status, 'starting');
      starts.push(id);
      app.store.setSessionStatus(id, 'running', 10000 + starts.length);
    };
    app.listen = async () => {
      checkListen(app, starts);
      return listen();
    };
    return app;
  };
}

test('demo seeds the checkout, starts both sessions before listening, and keeps projects scoped', async t => {
  const { repoRoot, tempRoot, sentinel, apps } = fixture(t);
  const demo = await startDemo({ repoRoot, tempRoot, createServer: stubPtys(apps, (app, starts) => {
    assert.deepEqual(starts.map(id => app.store.session(id).name), ['Build', 'Pesquisa']);
    assert.ok(starts.every(id => app.store.session(id).status === 'running'));
  }) });
  const { app, fixture: seeded, dataDir } = demo;
  assert.equal(path.dirname(dataDir), fs.realpathSync.native(tempRoot));
  assert.match(path.basename(dataDir), /^omniforge-demo-/);
  assert.equal(seeded.main.name, 'OmniHarness · Demo');
  assert.equal(seeded.main.root, fs.realpathSync.native(repoRoot));
  assert.equal(seeded.isolated.name, 'Projeto isolado · Demo');
  assert.equal(seeded.isolated.root, path.join(dataDir, 'projeto-isolado'));
  assert.deepEqual(seeded.tasks.map(task => task.status), ['open', 'open', 'open']);
  assert.deepEqual(seeded.tasks.map(task => task.dependsOn), [[], [seeded.tasks[0].id], [seeded.tasks[1].id]]);
  assert.deepEqual(seeded.sessions.map(session => session.projectId), [seeded.main.id, seeded.main.id]);
  const buildNotes = app.store.notesFor({ projectId: seeded.main.id, sessionId: seeded.sessions[0].id });
  assert.equal(buildNotes.filter(note => note.scope === 'session').length, 2);
  assert.ok(buildNotes.some(note => note.source.includes('decisão aceita')));
  assert.ok(buildNotes.some(note => note.source.includes('citação rejeitada')));
  assert.ok(!buildNotes.some(note => note.text.includes('MARCADOR_ISOLADO_DEMO')));
  const otherNotes = app.store.notesFor({ projectId: seeded.isolated.id });
  assert.equal(otherNotes.length, 1);
  assert.match(otherNotes[0].text, /MARCADOR_ISOLADO_DEMO/);
  assert.ok(!app.store.contextBriefFor(seeded.sessions[0].id).notes.some(note => note.text.includes('MARCADOR_ISOLADO_DEMO')));
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'owner-state-must-remain-untouched');

  const denied = await fetch(new URL('/api/state', demo.url));
  assert.equal(denied.status, 403);
  const stateResponse = await fetch(new URL('/api/state', demo.url), { headers: { 'x-omniforge-token': app.token } });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.projects.length, 2);
  assert.equal(state.sessions.length, 2);
  assert.equal(state.tasks.length, 3);
});

test('each launch gets new data and a seeded store refuses reseeding without mutation', async t => {
  const { repoRoot, tempRoot, sentinel, apps } = fixture(t);
  const createServer = stubPtys(apps);
  await assert.rejects(startDemo({ repoRoot, tempRoot: path.join(repoRoot, '.omniforge-lab'), createServer }), /fora do repositório/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'owner-state-must-remain-untouched');
  const first = await startDemo({ repoRoot, tempRoot, createServer });
  const second = await startDemo({ repoRoot, tempRoot, createServer });
  assert.notEqual(first.dataDir, second.dataDir);
  assert.notEqual(first.fixture.main.id, second.fixture.main.id);
  const before = fs.readFileSync(path.join(first.dataDir, 'state.json'), 'utf8');
  assert.throws(() => seedDemo(first.app, { repoRoot, dataDir: first.dataDir }), /não repetir a semeadura/);
  assert.equal(fs.readFileSync(path.join(first.dataDir, 'state.json'), 'utf8'), before);

  await first.app.close();
  apps.splice(apps.indexOf(first.app), 1);
  const reopened = createOmniForgeServer({ repoRoot, dataDir: first.dataDir });
  apps.push(reopened);
  assert.throws(() => seedDemo(reopened, { repoRoot, dataDir: first.dataDir }), /não repetir a semeadura/);
  assert.equal(reopened.store.snapshot().projects.length, 2);
  assert.equal(second.app.store.snapshot().projects.length, 2);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'owner-state-must-remain-untouched');
});

test('startup plus shutdown failure retains data path and both underlying errors', async t => {
  const { repoRoot, tempRoot } = fixture(t);
  const createServer = options => {
    const app = createOmniForgeServer(options);
    let starts = 0;
    app.shells.start = () => { if (++starts === 2) throw new Error('second PTY unavailable'); };
    const close = app.close.bind(app);
    app.close = async () => { await close(); throw new Error('shutdown PID 123 unconfirmed'); };
    return app;
  };
  await assert.rejects(startDemo({ repoRoot, tempRoot, createServer }), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.dataDir, /omniforge-demo-/);
    assert.ok(fs.existsSync(error.dataDir));
    assert.deepEqual(error.errors.map(item => item.message), ['second PTY unavailable', 'shutdown PID 123 unconfirmed']);
    return true;
  });
});
