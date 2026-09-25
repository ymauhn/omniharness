import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOmniForgeServer } from '../server.mjs';

test('classifier requires local auth and explicit activation, binds projects and resolves only installed metadata', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-classifier-api-'));
  let enabled = false, calls = 0, closed = false, rows = [
    { skill_id: 'source:review', ring: 'installed', availability: 'installed', description: 'Revisar código 🤖'.repeat(50) },
    { skill_id: 'source:remote', ring: 'remote', availability: 'not_installed', description: 'Remote candidate' },
  ];
  const catalog = { request: async () => ({ snapshot_id: 'fixture', rows }) };
  const classifier = {
    status: () => ({ provider: 'laya', state: enabled ? 'ready' : 'off', enabled }),
    enable: async () => { enabled = true; return classifier.status(); },
    disable: async () => { enabled = false; return classifier.status(); },
    select: async (prompt, candidates) => {
      calls++; assert.equal(prompt, 'Revisar código');
      assert.deepEqual(candidates.map(row => row.source_id), ['source:review']);
      assert.ok(Buffer.byteLength(candidates[0].description, 'utf8') <= 256);
      assert.equal(candidates[0].description.includes('\uFFFD'), false);
      return { provider: 'laya', source_id: 'source:review', reason: 'selected', usage: { input_tokens: 40, output_tokens: 0 }, runnable: false };
    },
    close: async () => { closed = true; },
  };
  const app = createOmniForgeServer({ dataDir: path.join(dir, 'data'), token: 'classifier-test', catalog, classifier });
  const base = new URL(await app.listen()).origin;
  t.after(async () => {
    await app.close(); assert.equal(closed, true);
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('omni-classifier-api-')) fs.rmSync(dir, { recursive: true });
  });
  const headers = { 'x-omniforge-token': 'classifier-test', 'content-type': 'application/json' };
  const post = (route, value) => fetch(`${base}${route}`, { method: 'POST', headers, body: JSON.stringify(value) });
  assert.equal((await fetch(`${base}/api/copilot/status`)).status, 403);
  assert.equal((await fetch(`${base}/api/copilot/status`, { headers })).status, 200);
  const project = await (await post('/api/projects', { name: 'Test', root: dir })).json();
  const input = { projectId: project.id, prompt: 'Revisar código' };
  assert.equal((await post('/api/copilot/classify', input)).status, 409);
  assert.equal(calls, 0);
  assert.equal((await post('/api/copilot/enable', { checkpoint: '/other' })).status, 400);
  assert.equal((await post('/api/copilot/enable', {})).status, 200);
  for (const invalid of [{ ...input, prompt: 'é'.repeat(1025) }, { ...input, candidates: [{ source_id: 'untrusted' }] }, { ...input, prompt: '' }]) {
    assert.equal((await post('/api/copilot/classify', invalid)).status, 400);
  }
  assert.equal((await post('/api/copilot/classify', { ...input, projectId: 'missing' })).status, 404);
  const selected = await (await post('/api/copilot/classify', input)).json();
  assert.equal(selected.source_id, 'source:review'); assert.equal(selected.projectId, project.id);
  assert.equal(selected.snapshot_id, 'fixture'); assert.equal(selected.runnable, false);
  assert.deepEqual(selected.usage, { input_tokens: 40, output_tokens: 0 });
  assert.equal(calls, 1);
  classifier.select = async () => ({ provider: 'laya', source_id: 'source:remote', reason: 'selected', usage: {}, runnable: true });
  assert.equal((await post('/api/copilot/classify', input)).status, 503);
  classifier.select = async () => { throw Object.assign(new Error('PRIVATE prompt and path'), { code: 'queue_full' }); };
  const crowded = await post('/api/copilot/classify', input);
  assert.equal(crowded.status, 429); assert.doesNotMatch(await crowded.text(), /PRIVATE/);
  rows = [];
  const empty = await (await post('/api/copilot/classify', input)).json();
  assert.equal(empty.source_id, null); assert.equal(empty.reason, 'no_candidates');
  assert.deepEqual(empty.usage, { input_tokens: null, output_tokens: null });
  assert.equal((await post('/api/copilot/disable', {})).status, 200);
  assert.equal((await post('/api/copilot/classify', input)).status, 409);
});
