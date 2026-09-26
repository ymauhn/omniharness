import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOmniForgeServer } from '../server.mjs';

test('replay API requires owner auth, explicit project and shares cursor with live frames', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-replay-'));
  const app = createOmniForgeServer({ dataDir: path.join(dir, 'data'), token: 'replay-test' });
  const base = new URL(await app.listen()).origin;
  const controller = new AbortController();
  t.after(async () => {
    controller.abort(); await app.close();
    const relative = path.relative(os.tmpdir(), dir);
    if (relative.startsWith('omniforge-replay-') && !relative.includes(path.sep)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const headers = { 'x-omniforge-token': 'replay-test' };
  const a = app.store.addProject({ name: 'a', root: dir });
  const b = app.store.addProject({ name: 'b', root: path.join(dir, 'data') });
  const session = app.store.addSession({ projectId: a.id, name: 'replay fixture' });
  const route = `/api/sessions/${session.id}/output`;
  const get = query => fetch(`${base}${route}${query}`, { headers });
  assert.equal((await fetch(`${base}${route}?projectId=${a.id}`)).status, 403);
  assert.equal((await get(`?projectId=${a.id}`)).status, 200);
  assert.equal((await get('')).status, 400);
  assert.equal((await get(`?projectId=${b.id}`)).status, 404);
  for (const bad of ['-1', '1.2', 'Infinity', 'abc', '9007199254740992']) assert.equal((await get(`?projectId=${a.id}&after=${bad}`)).status, 400);
  const events = await fetch(`${base}/api/events`, { headers, signal: controller.signal });
  const reader = events.body.getReader();
  await reader.read(); // initial state; no process/model is launched by this test.
  app.shells.emit('terminal', { sessionId: session.id, stream: 'stdout', text: '🤖 replay canary', at: '2026-09-25T00:00:00Z' });
  const live = new TextDecoder().decode((await reader.read()).value);
  const frame = JSON.parse(live.split('\n').find(line => line.startsWith('data: ')).slice(6));
  assert.equal(frame.projectId, a.id);
  assert.equal(frame.sequence, 1);
  const replay = await (await get(`?projectId=${a.id}&after=0`)).json();
  assert.deepEqual(replay.chunks, [frame]);
  assert.equal(replay.epoch, frame.epoch);
  assert.equal((await (await get(`?projectId=${a.id}&after=1`)).json()).chunks.length, 0);
  const wrong = await (await get(`?projectId=${b.id}`)).text();
  assert.equal(wrong.includes('replay canary'), false);
  const state = await (await fetch(`${base}/api/state`, { headers })).text();
  assert.equal(state.includes('replay canary'), false);
  assert.equal(fs.readFileSync(app.store.file, 'utf8').includes('replay canary'), false);
  await reader.cancel();
});

test('a burst of terminal output in one tick keeps a healthy event-stream client connected', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-burst-'));
  const app = createOmniForgeServer({ dataDir: path.join(dir, 'data'), token: 'burst-test' });
  const base = new URL(await app.listen()).origin;
  const controller = new AbortController();
  t.after(async () => {
    controller.abort(); await app.close();
    const relative = path.relative(os.tmpdir(), dir);
    if (relative.startsWith('omniforge-burst-') && !relative.includes(path.sep)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const project = app.store.addProject({ name: 'burst', root: dir });
  const session = app.store.addSession({ projectId: project.id, name: 'burst fixture' });
  const events = await fetch(`${base}/api/events`, { headers: { 'x-omniforge-token': 'burst-test' }, signal: controller.signal });
  const reader = events.body.getReader(), decoder = new TextDecoder();
  let received = '';
  while (!received.includes('event: state')) received += decoder.decode((await reader.read()).value, { stream: true });
  // node-pty output is split into 8 KiB frames that are broadcast in the same tick.
  for (let i = 1; i <= 3; i++) app.shells.emit('terminal', { sessionId: session.id, stream: 'stdout', text: `${i}`.repeat(8000), at: '2026-09-26T00:00:00Z' });
  app.shells.emit('terminal', { sessionId: session.id, stream: 'stdout', text: 'AFTER_BURST', at: '2026-09-26T00:00:01Z' });
  const deadline = Date.now() + 5000;
  while (!received.includes('AFTER_BURST') && Date.now() < deadline) {
    const { value, done } = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve({ done: true }), 1000))]);
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  assert.ok(received.includes('3'.repeat(8000)) && received.includes('AFTER_BURST'), `stream ended after ${received.length} characters`);
  await reader.cancel();
});
