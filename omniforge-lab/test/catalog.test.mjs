import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CatalogService, runCatalog } from '../catalog-service.mjs';
import { createOmniForgeServer } from '../server.mjs';

test('catalog API keeps auth, pagination and source variants; unavailable remains explicit', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-catalog-api-'));
  const requests = [];
  const catalog = { request: async input => {
    requests.push(input);
    if (input.q === 'broken') throw Object.assign(new Error('Catálogo indisponível'), { status: 503 });
    return input.op === 'get' ? { row: null } : { snapshot_id: 'fixture', rows: [], total: 0 };
  }, refresh: async () => ({ snapshot_id: 'refreshed' }) };
  const app = createOmniForgeServer({ dataDir: dir, token: 'catalog-test', catalog });
  const url = new URL(await app.listen());
  t.after(async () => {
    await app.close();
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('omni-catalog-api-')) fs.rmSync(dir, { recursive: true });
  });
  const headers = { 'x-omniforge-token': 'catalog-test' };
  assert.equal((await fetch(`${url.origin}/api/skills`)).status, 403);
  const response = await fetch(`${url.origin}/api/skills?q=review&ring=installed&limit=3&offset=2`, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(requests[0], { op: 'list', q: 'review', host: null, ring: 'installed', limit: 3, offset: 2 });
  assert.equal((await fetch(`${url.origin}/api/skills?limit=-1`, { headers })).status, 400);
  assert.equal((await fetch(`${url.origin}/api/skills?ring=invalid`, { headers })).status, 400);
  assert.equal((await fetch(`${url.origin}/api/skills?q=broken`, { headers })).status, 503);
  assert.equal((await fetch(`${url.origin}/api/skills/missing`, { headers })).status, 404);
  assert.equal((await fetch(`${url.origin}/api/skills/%ZZ`, { headers })).status, 400);
  assert.equal((await fetch(`${url.origin}/api/skills/refresh`, { method: 'POST', headers, body: '{}' })).status, 200);
});

test('concurrent catalog reads share one refresh and retry a failed build honestly', async () => {
  let builds = 0;
  const service = new CatalogService({ repoRoot: '.', dataDir: '.', runner: async (_python, _args, { input }) => {
    if (input.op === 'build') { builds++; await new Promise(resolve => setTimeout(resolve, 5)); return { snapshot_id: 'fixture', coverage: {} }; }
    return { rows: [], total: 0 };
  } });
  await Promise.all([service.request({ op: 'list' }), service.request({ op: 'list' })]);
  assert.equal(builds, 1);
  service.runner = async () => { throw new Error('private path should not reach UI'); };
  await assert.rejects(service.refresh(), error => error.status === 503 && !error.message.includes('private'));
  assert.equal(service.ready, null);
});

test('catalog subprocess uses stdin, rejects invalid output, and terminates a timeout', async () => {
  const result = await runCatalog(process.execPath, ['-e', 'process.stdin.on("data", x => process.stdout.write(x))'], { cwd: process.cwd(), input: { text: 'private draft' } });
  assert.equal(result.text, 'private draft');
  await assert.rejects(runCatalog(process.execPath, ['-e', 'process.stdout.write("broken")'], { cwd: process.cwd(), input: {} }), error => error.status === 503);
  await assert.rejects(runCatalog(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: process.cwd(), input: {}, timeout: 100 }), error => error.status === 503);
});

test('catalog bounds parallel subprocesses and drains its own requests on shutdown', async () => {
  const releases = [];
  const service = new CatalogService({ repoRoot: '.', dataDir: '.', runner: () => new Promise(resolve => releases.push(resolve)) });
  const pending = Array.from({ length: 4 }, () => service.run({ op: 'list' }));
  await assert.rejects(service.run({ op: 'list' }), error => error.status === 429);
  const closing = service.close();
  await assert.rejects(service.run({ op: 'list' }), error => error.status === 503);
  for (const resolve of releases) resolve({ rows: [] });
  await Promise.all([...pending, closing]);
  assert.equal(service.active.size, 0);
});
