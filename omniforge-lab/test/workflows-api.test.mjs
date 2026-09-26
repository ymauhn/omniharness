import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOmniForgeServer } from '../server.mjs';
import { workflowPresets } from '../workflows.mjs';

test('workflow HTTP routes retain auth, atomic task pins and private project-bound definitions', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-workflows-api-'));
  const app = createOmniForgeServer({ dataDir: path.join(dir, 'data'), token: 'workflow-test' });
  const url = await app.listen(), base = new URL(url).origin;
  t.after(async () => { await app.close(); const relative = path.relative(os.tmpdir(), dir); if (relative.startsWith('omniforge-workflows-api-') && !relative.includes(path.sep)) fs.rmSync(dir, { recursive: true, force: true }); });
  const headers = { 'x-omniforge-token': 'workflow-test', 'content-type': 'application/json' };
  const get = route => fetch(`${base}${route}`, { headers });
  const post = (route, body, extra = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const a = app.store.addProject({ name: 'A', root: dir }), b = app.store.addProject({ name: 'B', root: path.join(dir, 'data') });
  assert.equal((await fetch(`${base}/api/workflows?projectId=${a.id}`)).status, 403);
  const presets = await get(`/api/workflows/presets?projectId=${a.id}`);
  assert.equal(presets.status, 200); assert.equal((await presets.json()).rows.length, 5);
  const definition = workflowPresets()[0].definition; definition.nodes[0].prompt = 'PRIVATE_WORKFLOW_PROMPT';
  const input = { projectId: a.id, definition, reviewed: true };
  assert.equal((await post('/api/workflows', input, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await fetch(`${base}/api/workflows`, { method: 'POST', headers: { cookie: 'OmniForgeAuth_0123456789abcdef=workflow-test', 'content-type': 'application/json' }, body: JSON.stringify(input) })).status, 403);
  const saved = await (await post('/api/workflows', input)).json();
  assert.equal(saved.version, 1);
  const stateBefore = await (await get('/api/state')).json();
  assert.equal(stateBefore.workflowRevision, 1);
  assert.equal(Object.hasOwn(stateBefore, 'workflowRegistry'), false);
  assert.equal(JSON.stringify(stateBefore).includes('PRIVATE_WORKFLOW_PROMPT'), false);
  assert.equal((await get(`/api/workflows/${saved.id}?projectId=${b.id}`)).status, 404);
  assert.deepEqual((await (await get(`/api/workflows?projectId=${b.id}`)).json()).rows, []);
  const request = { projectId: a.id, expectedRevision: 1, nodeId: 'step-3', requestId: 'explicit-test-request' };
  const run = await (await post(`/api/workflows/${saved.id}/tasks`, request)).json();
  const again = await (await post(`/api/workflows/${saved.id}/tasks`, request)).json();
  assert.equal(again.id, run.id);
  const state = await (await get('/api/state')).json();
  assert.equal(state.workflowRevision, 2); assert.equal(state.tasks.length, 3);
  assert.ok(state.tasks.every(task => task.status === 'open' && task.workflow.runId === run.id));
  assert.equal(JSON.stringify(state).includes('PRIVATE_WORKFLOW_PROMPT'), false);
  assert.equal(app.shells.processes.size, 0);
  assert.equal((await post(`/api/workflows/${saved.id}/archive`, { projectId: a.id, expectedRevision: 1 })).status, 200);
  assert.equal((await (await get('/api/state')).json()).workflowRevision, 3);
  for (const file of ['/workflow-panel.mjs', '/workflow-panel.css', '/memory-panel.mjs', '/memory-panel.css', '/terminal-grid.mjs', '/terminal-grid.css']) {
    // Browser modules load without custom headers and hold no secret; only allowlisted client files are served.
    const response = await fetch(`${base}${file}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), file.endsWith('.css') ? /text\/css/ : /text\/javascript/);
  }
  assert.equal((await get('/workflows.mjs')).status, 404);
  for (const serverFile of ['/workflows.mjs', '/server.mjs', '/core.mjs', '/package.json']) assert.equal((await fetch(`${base}${serverFile}`)).status, 403);
});

test('invalid workflow storage fails startup without leaking the workspace lock', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-workflows-invalid-'));
  t.after(() => { const relative = path.relative(os.tmpdir(), dir); if (relative.startsWith('omniforge-workflows-invalid-') && !relative.includes(path.sep)) fs.rmSync(dir, { recursive: true, force: true }); });
  const app = createOmniForgeServer({ dataDir: dir });
  app.store.data.workflowRegistry = { schema: 999 }; app.store.save();
  await app.close();
  assert.throws(() => createOmniForgeServer({ dataDir: dir }), /workflows incompatível/);
  assert.equal(fs.existsSync(path.join(dir, 'state.lock')), false);
});
