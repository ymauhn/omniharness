import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOmniForgeServer } from '../server.mjs';
import { KeyVault } from '../key-vault.mjs';

function lab(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-v1-routes-'));
  const items = new Map();
  const backend = { async write(target, secret) { items.set(target, secret); }, async read(target) { return items.get(target) ?? null; }, async remove(target) { return items.delete(target); } };
  const app = createOmniForgeServer({ dataDir: path.join(root, 'data'), token: 'v1-routes', keyVault: new KeyVault({ dataDir: path.join(root, 'data'), backend }), ...options });
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const headers = { 'content-type': 'application/json', 'x-omniforge-token': 'v1-routes' };
  const call = async (route, body) => {
    const base = new URL(await app.listen.cached).origin;
    const response = await fetch(`${base}${route}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  app.listen.cached = app.listen();
  return { root, app, call, items };
}

test('the generated mini-tool is reviewed, enabled and run through the API, scoped to its project', async t => {
  const { root, app, call } = lab(t);
  const projectRoot = path.join(root, 'site');
  fs.mkdirSync(path.join(projectRoot, 'img'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'index.html'), '<img src="img/ok.png"><img src="img/missing.png">');
  fs.writeFileSync(path.join(projectRoot, 'img', 'ok.png'), 'x');
  const project = app.store.addProject({ name: 'Site', root: projectRoot });
  const other = app.store.addProject({ name: 'Outro', root: path.join(root, 'data') });
  assert.equal((await call('/api/extensions/generate', { projectId: project.id, request: 'crie um jogo' })).status, 422);
  const generated = await call('/api/extensions/generate', { projectId: project.id, request: 'Verificar links quebrados nos assets' });
  assert.equal(generated.status, 200);
  const source = await call(`/api/extensions/source?projectId=${project.id}&version=1`);
  assert.match(source.body.source, /function check\(input\)/);
  assert.deepEqual(source.body.manifest.capabilities, []);
  let registry = (await call(`/api/extensions?projectId=${project.id}`)).body;
  assert.equal((await call('/api/extensions/enable', { projectId: project.id, version: 1, reviewed: true, expectedRevision: registry.revision })).status, 409);
  assert.equal((await call('/api/extensions/preview', { projectId: project.id, version: 1, expectedRevision: registry.revision })).body.ok, true);
  registry = (await call(`/api/extensions?projectId=${project.id}`)).body;
  assert.equal((await call('/api/extensions/enable', { projectId: project.id, version: 1, reviewed: true, expectedRevision: registry.revision })).status, 200);
  const report = await call('/api/extensions/run', { projectId: project.id });
  assert.deepEqual(report.body.result.missing, [{ file: 'index.html', line: 1, ref: 'img/missing.png' }]);
  assert.deepEqual((await call(`/api/extensions?projectId=${other.id}`)).body.versions, []);
  assert.equal((await call('/api/extensions/run', { projectId: other.id })).body.reason, 'disabled');
});

test('provider keys go to the vault; the API and the state files only ever show a masked suffix', async t => {
  const { root, app, call, items } = lab(t);
  const secret = 'jev-live-0123456789abcdef';
  const stored = await call('/api/keys', { provider: 'jev', secret });
  assert.equal(stored.status, 200);
  assert.equal(stored.body.suffix, 'cdef');
  const listed = await call('/api/keys');
  assert.equal(JSON.stringify(listed.body).includes(secret), false);
  assert.equal(JSON.stringify((await call('/api/state')).body).includes(secret), false);
  for (const file of fs.readdirSync(path.join(root, 'data'))) {
    if (fs.statSync(path.join(root, 'data', file)).isFile()) assert.equal(fs.readFileSync(path.join(root, 'data', file), 'utf8').includes(secret), false, file);
  }
  assert.equal([...items.values()][0], secret);
  assert.equal((await call('/api/keys', { provider: 'jev', secret: 'short' })).status, 400);
  assert.equal((await call('/api/keys/remove', { ref: stored.body.ref })).status, 200);
  assert.equal(items.size, 0);
  assert.equal(app.store.data.projects.length, 0);
});

test('usage shows four separate figures and the Codex quota only after an explicit read', async t => {
  let reads = 0;
  const { call } = lab(t, { codexPath: 'codex.exe', readQuota: async () => { reads++; return { kind: 'subscription-quota', provider: 'codex', status: 'observado', windows: [{ label: 'principal', usedPercent: 12, windowMinutes: 300, resetsAt: null }], source: 'fake', scope: 'conta inteira' }; } });
  const before = await call('/api/usage');
  assert.deepEqual(before.body.figures.map(figure => figure.status), ['não consultado', 'desconhecido', 'desconhecido', 'desconhecido']);
  assert.equal(reads, 0);
  const after = await call('/api/usage/codex-quota', {});
  assert.equal(after.body.figures[0].windows[0].usedPercent, 12);
  assert.equal(reads, 1);
  assert.equal((await call('/api/usage')).body.figures[0].status, 'observado');
});

test('task ownership, handoff and the deterministic replan go through revision-checked routes', async t => {
  const { root, app, call } = lab(t);
  const project = app.store.addProject({ name: 'Orq', root });
  const a = app.store.addTask({ projectId: project.id, title: 'A' });
  const b = app.store.addTask({ projectId: project.id, title: 'B', dependsOn: [a.id] });
  const session = app.store.addSession({ projectId: project.id, name: 'Build' });
  assert.equal((await call(`/api/tasks/${b.id}/assign`, { sessionId: session.id, worktree: root, expectedRevision: 1 })).body.revision, 2);
  assert.equal((await call(`/api/tasks/${b.id}/handoff`, { toHost: 'claude', summary: 'Continuar a partir do teste vermelho.', expectedRevision: 2 })).body.handoffs.length, 1);
  assert.equal((await call(`/api/tasks/${a.id}/status`, { status: 'blocked', expectedRevision: 1 })).status, 200);
  const state = (await call('/api/state')).body;
  const replanned = state.tasks.find(task => task.id === b.id);
  assert.deepEqual([replanned.status, replanned.blockedBy, replanned.sessionId], ['blocked', a.id, session.id]);
  assert.equal((await call(`/api/tasks/${b.id}/assign`, { sessionId: null, expectedRevision: 2 })).status, 409);
});
