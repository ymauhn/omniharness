import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOmniForgeServer } from '../server.mjs';
import { createArsenalApi } from '../arsenal-http.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('arsenal HTTP binds explicit session decisions, review and immutable task pins to one project', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-arsenal-http-'));
  const app = createOmniForgeServer({ dataDir: path.join(root, 'data'), repoRoot, token: 'arsenal-test',
    observeArsenalHosts: () => ['codex', 'claude'] });
  const base = new URL(await app.listen()).origin;
  t.after(async () => {
    await app.close();
    const relative = path.relative(os.tmpdir(), root);
    if (relative.startsWith('omni-arsenal-http-') && !relative.includes(path.sep)) fs.rmSync(root, { recursive: true, force: true });
  });
  const auth = { 'x-omniforge-token': 'arsenal-test', 'content-type': 'application/json' };
  const get = route => fetch(`${base}${route}`, { headers: auth });
  const post = (operation, data, headers = auth) => fetch(`${base}/api/arsenal/${operation}`, {
    method: 'POST', headers, body: JSON.stringify(data),
  });
  const projectRootA = path.join(root, 'A'), projectRootB = path.join(root, 'B');
  fs.mkdirSync(projectRootA); fs.mkdirSync(projectRootB);
  const a = app.store.addProject({ name: 'A', root: projectRootA });
  const b = app.store.addProject({ name: 'B', root: projectRootB });
  const taskA = app.store.addTask({ projectId: a.id, title: 'Build' });
  const taskB = app.store.addTask({ projectId: b.id, title: 'Private B' });
  const sa = app.store.addSession({ projectId: a.id, name: 'Selected session' });
  const sb = app.store.addSession({ projectId: b.id, name: 'Other session' });
  const accepted = app.store.addNote({ scope: 'session', projectId: a.id, sessionId: sa.id, source: 'owner', text: 'Always add a reproducible check' });
  const rejected = app.store.addNote({ scope: 'session', projectId: a.id, sessionId: sa.id, source: 'owner', text: 'REJECTED_PRIVATE_TEXT: delete checks' });
  app.store.addNote({ scope: 'project', projectId: a.id, source: 'owner', text: 'PROJECT_ONLY' });
  app.store.addNote({ scope: 'global', source: 'owner', text: 'GLOBAL_ONLY' });
  app.store.addNote({ scope: 'session', projectId: b.id, sessionId: sb.id, source: 'owner', text: 'B_ONLY' });

  assert.equal((await fetch(`${base}/api/arsenal?projectId=${a.id}`)).status, 403);
  assert.equal((await post('import', { projectId: a.id, builtinId: 'x', expectedRevision: 0 }, { 'content-type': 'application/json' })).status, 403);
  const sources = await (await get(`/api/arsenal/sources?projectId=${a.id}&sessionId=${sa.id}`)).json();
  assert.deepEqual(sources.notes.map(note => note.id).sort(), [accepted.id, rejected.id].sort());
  assert.equal((await get(`/api/arsenal/sources?projectId=${b.id}&sessionId=${sa.id}`)).status, 404);
  assert.equal((await get(`/api/arsenal/sources?projectId=${a.id}&sessionId=${sa.id}&sessionId=${sa.id}`)).status, 400);
  const first = await (await get(`/api/arsenal?projectId=${a.id}`)).json();
  assert.equal(first.snapshot.revision, 0);
  assert.equal(first.builtins.length, 5);
  assert.equal(first.runnable, false);
  const builtin = first.builtins.find(profile => profile.suggested_hosts.includes('codex'));
  assert.ok(builtin);
  const imported = await (await post('import', { projectId: a.id, builtinId: builtin.id, expectedRevision: 0 })).json();
  assert.equal(imported.snapshot.profiles[0].state, 'draft');
  assert.equal((await post('import', { projectId: a.id, builtinId: first.builtins[1].id, expectedRevision: 0 })).status, 409);
  const preview = await (await get(`/api/arsenal/${builtin.id}?projectId=${a.id}&version=1`)).json();
  assert.ok(preview.rules.length > 0);
  const sourceRules = Object.fromEntries(preview.rules.map(rule => [rule.id, rule.source_ids]));
  const review = { projectId: a.id, profileId: builtin.id, version: 1, contentSha256: preview.content_sha256,
    sourceRules, reviewedRuleIds: preview.rules.map(rule => rule.id), reviewedSettings: true, expectedRevision: imported.revision };
  assert.equal((await post('review', { ...review, reviewedSettings: false })).status, 400);
  assert.equal((await post('review', { ...review, reviewedRuleIds: review.reviewedRuleIds.slice(1) })).status, 400);
  assert.equal((await post('review', { ...review, contentSha256: 'forged' })).status, 400);
  const reviewed = await (await post('review', review)).json();
  assert.equal(reviewed.snapshot.profiles[0].state, 'reviewed');
  const active = await (await post('activate', { projectId: a.id, profileId: builtin.id, version: 1, expectedRevision: reviewed.revision })).json();
  assert.equal(active.snapshot.profiles[0].state, 'active');
  assert.equal((await post('pin', { projectId: a.id, profileId: builtin.id, taskId: taskB.id, host: 'codex', expectedRevision: active.revision })).status, 404);
  assert.equal((await post('pin', { projectId: a.id, profileId: builtin.id, taskId: taskA.id, host: 'hermes', expectedRevision: active.revision })).status, 409);
  assert.equal((await post('pin', { projectId: a.id, profileId: builtin.id, taskId: taskA.id, host: 'codex', availableHosts: ['codex'], expectedRevision: active.revision })).status, 400);
  const pinned = await (await post('pin', { projectId: a.id, profileId: builtin.id, taskId: taskA.id, host: 'codex', expectedRevision: active.revision })).json();
  assert.equal(pinned.pin.runnable, false);
  assert.equal(pinned.pin.content_sha256, preview.content_sha256);
  assert.equal((await get(`/api/arsenal/pins/${taskA.id}?projectId=${b.id}`)).status, 404);
  assert.equal((await (await get(`/api/arsenal?projectId=${b.id}`)).json()).pins.length, 0);
  const originalPin = await (await get(`/api/arsenal/pins/${taskA.id}?projectId=${a.id}`)).json();
  assert.equal(originalPin.version, 1);
  const disabled = await (await post('disable', { projectId: a.id, profileId: builtin.id, expectedRevision: pinned.revision })).json();
  assert.equal(disabled.snapshot.profiles[0].state, 'disabled');
  assert.equal((await (await get(`/api/arsenal/pins/${taskA.id}?projectId=${a.id}`)).json()).version, 1);

  const selections = [
    { noteId: accepted.id, sessionId: sa.id, expectedRevision: accepted.revision, kind: 'accepted_decision', sanitized: true },
    { noteId: rejected.id, sessionId: sa.id, expectedRevision: rejected.revision, kind: 'rejected', sanitized: true },
  ];
  const derive = { projectId: a.id, templateId: builtin.id, profileId: 'derived-checker', name: 'Checker',
    selectedSourceIds: selections.map(item => item.noteId), selections, expectedRevision: disabled.revision };
  assert.equal((await post('derive', { ...derive, selections: selections.map((item, index) => index ? { ...item, sessionId: sb.id } : item) })).status, 404);
  assert.equal((await post('derive', { ...derive, selections: selections.map((item, index) => index ? { ...item, expectedRevision: 2 } : item) })).status, 409);
  const derivedResponse = await post('derive', derive);
  assert.equal(derivedResponse.status, 200);
  const derived = await derivedResponse.json();
  assert.equal(derived.preview.profile.id, 'derived-checker');
  assert.equal(JSON.stringify(derived.preview).includes('REJECTED_PRIVATE_TEXT'), false);
  assert.ok(derived.preview.rules.some(rule => rule.text?.includes('Always add a reproducible check')));
  const sharedState = await (await get('/api/state')).text();
  assert.equal(sharedState.includes('REJECTED_PRIVATE_TEXT'), false);
  assert.equal(sharedState.includes('Always add a reproducible check'), false);
  assert.equal((await post('derive', { ...derive, expectedRevision: derived.revision,
    selections: selections.map((item, index) => index ? { ...item, kind: 'quoted', sanitized: false } : item) })).status, 400);
  assert.equal((await post('derive', { ...derive, expectedRevision: derived.revision, excerpts: [{ text: 'FORGED_SOURCE' }] })).status, 400);
  app.store.archiveNote(accepted.id, { scope: 'session', projectId: a.id, sessionId: sa.id,
    expectedRevision: accepted.revision, source: 'owner' });
  assert.equal((await post('derive', { ...derive, expectedRevision: derived.revision })).status, 409);
  assert.equal((await (await get(`/api/arsenal/sources?projectId=${a.id}&sessionId=${sa.id}`)).json()).notes.some(note => note.id === accepted.id), false);
});

test('arsenal summary never combines registry and pins from different revisions', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const url = new URL(`http://local/api/arsenal?projectId=${projectId}`);
  let reads = 0;
  const service = { request: async ({ op }) => op === 'builtins' ? { profiles: [] }
    : op === 'list' ? { revision: reads++, profiles: [] }
    : { revision: 1, pins: [] } };
  const handle = createArsenalApi({ store: { project: id => ({ id }) }, service, observeHosts: () => [] });
  const result = await handle({ method: 'GET', url });
  assert.equal(result.body.snapshot.revision, 1);
  assert.equal(reads, 2);

  let mutation = 0;
  const racing = createArsenalApi({ store: { project: id => ({ id }) }, service: {
    request: async ({ op }) => op === 'builtins' ? { profiles: [] } :
      op === 'list' ? { revision: mutation++, profiles: [] } : { revision: mutation, pins: [] },
  }, observeHosts: () => [] });
  await assert.rejects(racing({ method: 'GET', url }), error => error.status === 409);
  assert.equal(mutation, 3);
});
