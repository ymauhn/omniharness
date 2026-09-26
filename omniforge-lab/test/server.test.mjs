import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOmniForgeServer } from '../server.mjs';

test('local API requires a token and preserves project/task/memory boundaries', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-lab-api-'));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const projectRoot = path.join(root, 'game');
  fs.mkdirSync(projectRoot);
  const app = createOmniForgeServer({ dataDir: path.join(root, 'data'), repoRoot, token: 'test-token' });
  const url = await app.listen();
  const base = new URL(url).origin;
  t.after(async () => {
    await app.close();
    const relative = path.relative(os.tmpdir(), root);
    if (relative.startsWith('omniforge-lab-api-') && !relative.includes(path.sep)) fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal((await fetch(`${base}/api/state`)).status, 403);
  const initial = await fetch(url);
  assert.equal(initial.status, 200);
  const html = await initial.text();
  const browserScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(browserScript?.includes("from '/pane-scope.mjs'"));
  const parsed = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: browserScript, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const auth = { 'x-omniforge-token': 'test-token' };
  assert.equal((await fetch(`${base}/api/state`, { headers: auth })).status, 200);
  const paneModule = await fetch(`${base}/pane-scope.mjs`);
  assert.equal(paneModule.status, 200);
  assert.match(paneModule.headers.get('content-type'), /text\/javascript/);
  assert.match(await paneModule.text(), /export function reconcilePaneSessions/);
  assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  const eventsAbort = new AbortController();
  const events = await fetch(`${base}/api/events?token=test-token`, { headers: { accept: 'text/event-stream' }, signal: eventsAbort.signal });
  assert.equal(events.status, 200);
  eventsAbort.abort();
  const post = async (route, value) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-omniforge-token': 'test-token' }, body: JSON.stringify(value) });
  const projectResponse = await post('/api/projects', { name: 'Game', root: projectRoot });
  assert.equal(projectResponse.status, 200);
  const project = await projectResponse.json();
  const task = await (await post('/api/tasks', { projectId: project.id, title: 'Test first' })).json();
  const dependent = await (await post('/api/tasks', { projectId: project.id, title: 'Then fix', dependsOn: [task.id] })).json();
  assert.equal((await post(`/api/tasks/${dependent.id}/status`, { status: 'done', expectedRevision: 1 })).status, 409);
  assert.equal((await post(`/api/tasks/${task.id}/status`, { status: 'done', expectedRevision: 1 })).status, 200);
  assert.equal((await post(`/api/tasks/${dependent.id}/status`, { status: 'done', expectedRevision: 1 })).status, 200);
  assert.equal((await post('/api/memory', { scope: 'project', projectId: project.id, source: 'CONTEXT.md', text: 'Test with fixtures' })).status, 200);
  const state = await (await fetch(`${base}/api/state`, { headers: auth })).json();
  assert.equal(state.projects.length, 1);
  assert.equal(state.tasks.length, 2);
  assert.equal(state.tasks[1].status, 'done');
  assert.equal(Object.hasOwn(state, 'notes'), false);
  const selectedMemory = await (await fetch(`${base}/api/memory?projectId=${project.id}`, { headers: auth })).json();
  assert.equal(selectedMemory.notes[0].source, 'CONTEXT.md');
  const otherRoot = path.join(root, 'other');
  fs.mkdirSync(otherRoot);
  const other = await (await post('/api/projects', { name: 'Other', root: otherRoot })).json();
  assert.equal((await post('/api/memory', { scope: 'project', projectId: other.id, source: 'private', text: 'OTHER_PROJECT_SECRET' })).status, 200);
  const firstMemory = await (await fetch(`${base}/api/memory?projectId=${project.id}`, { headers: auth })).json();
  assert.equal(JSON.stringify(firstMemory).includes('OTHER_PROJECT_SECRET'), false);
  const snapshot = await (await fetch(`${base}/api/state`, { headers: auth })).text();
  assert.equal(snapshot.includes('OTHER_PROJECT_SECRET'), false);
  assert.equal((await post('/api/layout', { split: 10 })).status, 400);
  const utf8 = Buffer.from(JSON.stringify({ scope: 'global', source: 'usuário', text: 'decisão de física: café' }), 'utf8');
  const split = utf8.indexOf(Buffer.from('é', 'utf8')) + 1;
  const splitResponse = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/memory`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-omniforge-token': 'test-token' } }, response => {
      const parts = [];
      response.on('data', part => parts.push(part));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(parts).toString('utf8')) }));
    });
    request.on('error', reject);
    request.write(utf8.subarray(0, split));
    setTimeout(() => request.end(utf8.subarray(split)), 10);
  });
  assert.equal(splitResponse.status, 200);
  assert.equal(splitResponse.body.text, 'decisão de física: café');
});

test('task status rejects a stale window, long drafts keep details and inventory survives folder failures', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-lab-api-'));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const projectRoot = path.join(root, 'game');
  fs.mkdirSync(path.join(projectRoot, 'locked'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'hero.png'), 'x');
  const app = createOmniForgeServer({ dataDir: path.join(root, 'data'), repoRoot, token: 'test-token' });
  const base = new URL(await app.listen()).origin;
  t.after(async () => {
    await app.close();
    const relative = path.relative(os.tmpdir(), root);
    if (relative.startsWith('omniforge-lab-api-') && !relative.includes(path.sep)) fs.rmSync(root, { recursive: true, force: true });
  });
  const headers = { 'content-type': 'application/json', 'x-omniforge-token': 'test-token' };
  const post = (route, value) => fetch(`${base}${route}`, { method: 'POST', headers, body: JSON.stringify(value) });
  const get = route => fetch(`${base}${route}`, { headers });
  const project = await (await post('/api/projects', { name: 'Game', root: projectRoot })).json();
  const draft = `Revisar referências\n${'Contexto citado pelo Copilot. '.repeat(40)}`;
  const task = await (await post('/api/tasks', { projectId: project.id, title: 'Revisar referências', details: draft })).json();
  assert.equal(task.revision, 1);
  assert.equal(task.details, draft.trim());
  assert.equal((await post(`/api/tasks/${task.id}/status`, { status: 'done', expectedRevision: 1 })).status, 200);
  const stale = await post(`/api/tasks/${task.id}/status`, { status: 'blocked', expectedRevision: 1 });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /Tarefa alterada/);
  assert.equal((await post(`/api/tasks/${task.id}/status`, { status: 'blocked' })).status, 400);
  const [saved] = (await (await get('/api/state')).json()).tasks;
  assert.equal(saved.status, 'done');
  assert.equal(saved.revision, 2);
  assert.equal(saved.hasDetails, true);
  assert.equal(Object.hasOwn(saved, 'details'), false);
  assert.deepEqual(await (await get(`/api/tasks/${task.id}/details`)).json(), { id: task.id, details: draft.trim() });
  assert.equal((await get('/api/tasks/unknown/details')).status, 404);
  assert.equal((await fetch(`${base}/api/tasks/${task.id}/details`)).status, 403);
  const opendir = fs.promises.opendir;
  t.mock.method(fs.promises, 'opendir', (dir, ...rest) => path.basename(dir) === 'locked' ? Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' })) : opendir(dir, ...rest));
  const partial = await get(`/api/inventory?projectId=${project.id}`);
  assert.equal(partial.status, 200);
  const inventory = await partial.json();
  assert.deepEqual(inventory.files, ['hero.png']);
  assert.equal(inventory.unreadableDirectories, 1);
  fs.renameSync(projectRoot, path.join(root, 'moved'));
  const missing = await get(`/api/inventory?projectId=${project.id}`);
  assert.equal(missing.status, 409);
  assert.match((await missing.json()).error, /Pasta do projeto indisponível/);
});

test('tasks with long details keep every event-stream window connected', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-lab-api-'));
  const app = createOmniForgeServer({ dataDir: path.join(root, 'data'), token: 'test-token' });
  const base = new URL(await app.listen()).origin;
  const controller = new AbortController();
  t.after(async () => {
    controller.abort(); await app.close();
    const relative = path.relative(os.tmpdir(), root);
    if (relative.startsWith('omniforge-lab-api-') && !relative.includes(path.sep)) fs.rmSync(root, { recursive: true, force: true });
  });
  const headers = { 'content-type': 'application/json', 'x-omniforge-token': 'test-token' };
  const project = app.store.addProject({ name: 'Detalhes', root });
  const events = await fetch(`${base}/api/events`, { headers, signal: controller.signal });
  const reader = events.body.getReader(), decoder = new TextDecoder();
  let received = '';
  while (!received.includes('event: state')) received += decoder.decode((await reader.read()).value, { stream: true });
  // Each Copilot-structured task may carry a 4,000-character draft; six of them once pushed state events past 16 KiB.
  for (let i = 1; i <= 6; i++) {
    const response = await fetch(`${base}/api/tasks`, { method: 'POST', headers, body: JSON.stringify({ projectId: project.id, title: `Detalhada ${i}`, details: `Detalhada ${i}\n${'x'.repeat(3980)}` }) });
    assert.equal(response.status, 200);
  }
  const deadline = Date.now() + 5000;
  while (!received.includes('Detalhada 6') && Date.now() < deadline) {
    const { value, done } = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve({ done: true }), 1000))]);
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  assert.ok(received.includes('Detalhada 6'), `stream ended after ${received.length} characters`);
  assert.equal(received.includes('x'.repeat(100)), false);
  await reader.cancel();
});

test('the credential is never an ambient cookie, and each instance accepts only its own token from its own Host', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-lab-cookie-'));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const first = createOmniForgeServer({ dataDir: path.join(root, 'first'), repoRoot, token: 'first-token' });
  const second = createOmniForgeServer({ dataDir: path.join(root, 'second'), repoRoot, token: 'second-token' });
  t.after(async () => {
    await first.close();
    await second.close();
    const relative = path.relative(os.tmpdir(), root);
    if (relative.startsWith('omniforge-lab-cookie-') && !relative.includes(path.sep)) fs.rmSync(root, { recursive: true, force: true });
  });
  const firstUrl = await first.listen();
  const secondUrl = await second.listen();
  // Cookies ignore ports, so any other 127.0.0.1 service could read one. The shell is public; the API is not.
  for (const response of [await fetch(firstUrl), await fetch(new URL(firstUrl).origin)]) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const firstBase = new URL(firstUrl).origin;
  const secondBase = new URL(secondUrl).origin;
  assert.equal((await fetch(`${firstBase}/api/state`, { headers: { cookie: 'OmniForgeAuth_0123456789abcdef=first-token' } })).status, 403);
  assert.equal((await fetch(`${firstBase}/api/state?token=first-token`)).status, 403);
  assert.equal((await fetch(`${firstBase}/api/state`, { headers: { 'x-omniforge-token': 'first-token' } })).status, 200);
  assert.equal((await fetch(`${secondBase}/api/state`, { headers: { 'x-omniforge-token': 'first-token' } })).status, 403);
  assert.equal((await fetch(`${secondBase}/api/state`, { headers: { 'x-omniforge-token': 'second-token' } })).status, 200);
  const sse = new AbortController();
  t.after(() => sse.abort());
  assert.equal((await fetch(`${firstBase}/api/events?token=second-token`, { signal: sse.signal })).status, 403);
  assert.equal((await fetch(`${firstBase}/api/events?token=first-token`, { signal: sse.signal })).status, 200);
  // DNS rebinding: a foreign name that resolves to loopback still sends its own Host header.
  const { port } = new URL(firstUrl);
  const rebound = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/state', headers: { host: `rebind.example:${port}`, 'x-omniforge-token': 'first-token' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(rebound, 403);
});

test('memory API versions competing writes, denies mismatched scopes and explicitly forgets with retained history', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-lab-memory-api-'));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const app = createOmniForgeServer({ dataDir: path.join(root, 'data'), repoRoot, token: 'memory-test-token' });
  const url = await app.listen();
  const base = new URL(url).origin;
  t.after(async () => {
    await app.close();
    const relative = path.relative(os.tmpdir(), root);
    if (relative.startsWith('omniforge-lab-memory-api-') && !relative.includes(path.sep)) fs.rmSync(root, { recursive: true, force: true });
  });
  const headers = { 'content-type': 'application/json', 'x-omniforge-token': 'memory-test-token' };
  const post = (route, value, extraHeaders = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(value) });
  const get = route => fetch(`${base}${route}`, { headers });
  const makeProject = async name => {
    const projectRoot = path.join(root, name);
    fs.mkdirSync(projectRoot);
    return (await post('/api/projects', { name, root: projectRoot })).json();
  };
  const a = await makeProject('A');
  const b = await makeProject('B');
  const sa = app.store.addSession({ projectId: a.id, name: 'A reader' });
  const sibling = app.store.addSession({ projectId: a.id, name: 'A sibling' });
  const sb = app.store.addSession({ projectId: b.id, name: 'B reader' });
  const binding = { scope: 'session', projectId: a.id, sessionId: sa.id };
  const note = await (await post('/api/memory', { ...binding, source: 'owner', text: 'ORIGINAL_PRIVATE_FACT' })).json();
  assert.equal(note.revision, 1);
  const update = { ...binding, expectedRevision: 1, source: 'owner correction', text: 'UPDATED_PRIVATE_FACT' };
  const updatePath = `/api/memory/${note.id}/update`;
  const historyPath = `/api/memory/${note.id}/history?${new URLSearchParams(binding)}`;
  assert.equal((await fetch(`${base}${updatePath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) })).status, 403);
  assert.equal((await post(updatePath, update, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await fetch(`${base}${updatePath}`, { method: 'POST', headers: { cookie: 'OmniForgeAuth_0123456789abcdef=memory-test-token', 'content-type': 'application/json' }, body: JSON.stringify(update) })).status, 403);
  const competing = await Promise.all([post(updatePath, update, { origin: base }), post(updatePath, { ...update, text: 'COMPETING_PRIVATE_FACT' })]);
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
  const winner = await competing.find(response => response.status === 200).json();
  assert.equal(winner.revision, 2);
  const state = await (await get('/api/state')).json();
  assert.equal(state.memoryRevision, 2);
  assert.equal(Object.hasOwn(state, 'notes'), false);
  assert.equal(JSON.stringify(state).includes('_PRIVATE_FACT'), false);
  for (const wrong of [{ ...binding, projectId: b.id }, { ...binding, sessionId: sibling.id }, { ...binding, sessionId: sb.id }]) {
    const failed = await post(updatePath, { ...update, ...wrong, expectedRevision: 2 });
    assert.ok([400, 404].includes(failed.status));
    assert.equal((await failed.text()).includes('_PRIVATE_FACT'), false);
    const history = await get(`/api/memory/${note.id}/history?${new URLSearchParams(wrong)}`);
    assert.ok([400, 404].includes(history.status));
    assert.equal((await history.text()).includes('_PRIVATE_FACT'), false);
  }
  for (const route of [`/api/memory?projectId=${b.id}&sessionId=${sa.id}`, `/api/context?projectId=${b.id}&sessionId=${sa.id}`]) {
    const denied = await get(route);
    assert.equal(denied.status, 400);
    assert.equal((await denied.text()).includes('_PRIVATE_FACT'), false);
  }
  const foreign = await (await get(`/api/memory?projectId=${b.id}&sessionId=${sb.id}`)).json();
  assert.deepEqual(foreign.notes, []);
  const context = await (await get(`/api/context?projectId=${a.id}&sessionId=${sa.id}`)).json();
  assert.equal(context.notes[0].revision, 2);
  assert.equal(context.notes[0].text, winner.text);
  assert.equal(Object.hasOwn(context.notes[0], 'history'), false);
  assert.ok(JSON.stringify(context).length <= context.limit);
  assert.equal((await post(updatePath, null)).status, 400);
  assert.equal((await post(updatePath, { ...update, expectedRevision: 2, text: 'x'.repeat(4001) })).status, 400);
  assert.equal((await post(updatePath, { ...update, text: 'x'.repeat(32769) })).status, 413);

  const beforeFailedWrite = app.store.snapshot();
  const rename = fs.renameSync;
  try {
    fs.renameSync = (source, target) => {
      if (target === app.store.file) throw new Error('synthetic persistence failure');
      return rename(source, target);
    };
    assert.equal((await post(updatePath, { ...update, expectedRevision: 2 })).status, 500);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(app.store.snapshot(), beforeFailedWrite);
  const forgotten = await (await post(`/api/memory/${note.id}/forget`, { ...binding, expectedRevision: 2, source: 'explicit owner forget' })).json();
  assert.equal(forgotten.revision, 3);
  assert.ok(forgotten.archivedAt);
  assert.equal((await (await get('/api/state')).json()).memoryRevision, 3);
  assert.deepEqual((await (await get(`/api/memory?projectId=${a.id}&sessionId=${sa.id}`)).json()).notes, []);
  assert.deepEqual((await (await get(`/api/context?sessionId=${sa.id}`)).json()).notes, []);
  const history = await (await get(historyPath)).json();
  assert.deepEqual(history.history.map(version => version.operation), ['create', 'update', 'archive']);
  assert.equal(history.history[0].text, 'ORIGINAL_PRIVATE_FACT');
  assert.equal(history.history[2].source, 'explicit owner forget');
  assert.equal((await post(`/api/memory/${note.id}/archive`, { ...binding, expectedRevision: 3, source: 'repeat' })).status, 409);
  assert.equal((await post(updatePath, { ...update, expectedRevision: 3 })).status, 409);
  const archived = await (await get(`/api/memory?projectId=${a.id}&sessionId=${sa.id}&includeArchived=true`)).json();
  assert.equal(archived.notes[0].id, note.id);
  assert.equal(Object.hasOwn(archived.notes[0], 'history'), false);
  // A local owner token may explicitly select another project; this is scoped retrieval, not OS isolation.
  const other = await (await post('/api/memory', { scope: 'project', projectId: b.id, source: 'owner', text: 'B_OWNER_SELECTED_FACT' })).json();
  assert.equal((await (await get(`/api/memory?projectId=${b.id}`)).json()).notes[0].id, other.id);
  for (let revision = 1; revision < 46; revision++) app.store.updateNote(other.id, {
    scope: 'project', projectId: b.id, expectedRevision: revision, source: 'history fixture', text: `revision ${revision + 1}`,
  });
  const pageRoute = `/api/memory/${other.id}/history?scope=project&projectId=${b.id}`;
  const firstPage = await (await get(pageRoute)).json();
  assert.equal(firstPage.history.length, 20);
  assert.equal(firstPage.total, 46); assert.equal(firstPage.hasMore, true);
  const middlePage = await (await get(`${pageRoute}&offset=20&limit=20`)).json();
  assert.deepEqual(middlePage.history.map(version => version.revision), Array.from({ length: 20 }, (_, index) => index + 21));
  const lastPage = await (await get(`${pageRoute}&offset=40&limit=20`)).json();
  assert.equal(lastPage.history.length, 6); assert.equal(lastPage.hasMore, false);
  for (const invalid of ['limit=0', 'limit=51', 'offset=-1', 'offset=1.5']) assert.equal((await get(`${pageRoute}&${invalid}`)).status, 400);
  assert.equal(app.store.noteHistory(other.id, { scope: 'project', projectId: b.id }).length, 46, 'pagination preserves durable audit history');
});

test('the Lab process never runs a program planted in the current folder', async t => {
  if (process.platform !== 'win32') return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-cwd-plant-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'hostname.exe'), path.join(dir, 'omni-planted-probe.exe'));
  // A child without the variable reproduces the default Windows search order; importing the server must harden it.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'nodefaultcurrentdirectoryinexepath'));
  const server = new URL('../server.mjs', import.meta.url).href;
  const probe = `import { spawnSync } from 'node:child_process'; await import(${JSON.stringify(server)}); const r = spawnSync('omni-planted-probe.exe', [], { encoding: 'utf8' }); console.log(JSON.stringify({ code: r.error?.code ?? null, ran: Boolean(r.stdout) }));`;
  const baseline = spawnSync(process.execPath, ['-e', "const r = require('child_process').spawnSync('omni-planted-probe.exe', [], { encoding: 'utf8' }); console.log(Boolean(r.stdout));"], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(baseline.stdout.trim(), 'true', 'without hardening Windows runs the planted copy (test precondition)');
  const hardened = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: dir, env, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(hardened.stdout.trim().split(/\r?\n/).at(-1)), { code: 'ENOENT', ran: false }, hardened.stderr);
});
