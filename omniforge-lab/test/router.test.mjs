import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { routeTask, jevBridge } from '../router.mjs';
import { createOmniForgeServer } from '../server.mjs';

// Both providers are fakes: no Laya process, no JEV request, no vault read unless a test says so.
const task = { id: 't1', title: 'Corrigir o teste de datas que falha', details: 'Quebra no fuso horário.' };
const rows = [
  { skill_id: 'skill:tdd', name: 'tdd', ring: 'installed', availability: 'installed', description: 'Test-driven development' },
  { skill_id: 'skill:review', name: 'code-review', ring: 'installed', availability: 'installed', description: 'Review a diff' },
];
const catalog = { request: async () => ({ snapshot_id: 's', rows }) };
const answer = (provider, sourceId, probability, reason = sourceId ? 'selected' : 'below_threshold') =>
  ({ provider, source_id: sourceId, reason, usage: { input_tokens: 9, output_tokens: 0 }, runnable: false, probability });
function laya(reply, enabled = true) {
  const calls = [];
  return { calls, status: () => ({ enabled }), select: async (prompt, candidates) => {
    const ids = candidates.map(row => row.source_id); calls.push({ prompt, ids }); return reply(ids);
  } };
}
const refuse = name => async () => { throw new Error(`${name} must not be called`); };
const noKeys = { list: () => [], secretFor: refuse('vault read') };
const jevKeys = { list: () => [{ provider: 'jev', ref: 'OmniForge:key:jev:1', suffix: '0123' }], secretFor: async ref => (ref === 'OmniForge:key:jev:1' ? 'SECRET-JEV-KEY-0123' : null) };
const deps = extra => ({ catalog, classifier: laya(refuse('Laya'), false), keys: noKeys, jevSelect: refuse('JEV'), ...extra });
const lexical = { value: null, source: 'lexical' };

test('Laya suggests host, skill and effort with source, probability and latency; the suggestion is never runnable', async () => {
  const classifier = laya(ids => answer('laya', ids.includes('host:codex') ? 'host:codex' : ids.includes('effort:medio') ? 'effort:medio' : 'skill:review', 0.82));
  const result = await routeTask({ task, input: {} }, deps({ classifier }));
  assert.deepEqual(classifier.calls.map(call => call.ids), [['host:claude', 'host:codex'], ['effort:baixo', 'effort:medio', 'effort:alto'], ['skill:tdd', 'skill:review']]);
  assert.ok(classifier.calls.every(call => call.prompt === 'Corrigir o teste de datas que falha\n\nQuebra no fuso horário.'));
  assert.deepEqual(result.host, { value: 'codex', source: 'laya', probability: 0.82, reason: 'selected' });
  assert.deepEqual(result.effort, { value: 'médio', source: 'laya', probability: 0.82, reason: 'selected' });
  assert.deepEqual(result.skill, { value: 'skill:review', name: 'code-review', source: 'laya', probability: 0.82, reason: 'selected' });
  assert.equal(result.provider, 'laya'); assert.equal(result.runnable, false); assert.equal(result.jevAvailable, false);
  assert.ok(Number.isInteger(result.latencyMs) && result.latencyMs >= 0);
});

test('an abstention, a low score, a timeout or an invalid answer falls back to the lexical catalog match', async () => {
  const replies = {
    below_threshold: () => answer('laya', null, 0.41),
    none: () => answer('laya', null, 0.7, 'none'),
    timeout: () => Promise.reject(Object.assign(new Error('Local classifier: timeout'), { code: 'timeout' })),
    outside: () => answer('laya', 'skill:not-offered', 0.99),
    runnable: () => ({ ...answer('laya', 'host:codex', 0.9), runnable: true }),
    foreign: () => answer('jev', 'host:codex', 0.9),
    unknownReason: () => answer('laya', null, 0.5, 'weird'),
  };
  for (const [name, reply] of Object.entries(replies)) {
    const result = await routeTask({ task, input: {} }, deps({ classifier: laya(reply) }));
    assert.deepEqual([result.host.value, result.effort.value, result.skill.value, result.skill.name], [null, null, 'skill:tdd', 'tdd'], name);
    assert.ok([result.host, result.skill, result.effort].every(field => field.source === 'lexical'), name);
  }
  const low = await routeTask({ task, input: {} }, deps({ classifier: laya(replies.below_threshold) }));
  assert.deepEqual(low.host, { ...lexical, probability: 0.41, reason: 'below_threshold' }, 'the abstention and its score stay visible');
  const late = await routeTask({ task, input: {} }, deps({ classifier: laya(replies.timeout) }));
  assert.deepEqual(late.effort, { ...lexical, probability: null, reason: 'unavailable' });
});

test('with Laya unloaded the suggestion is lexical and no provider is asked', async () => {
  const result = await routeTask({ task, input: {} }, deps());
  assert.equal(result.provider, null);
  assert.deepEqual(result.host, { ...lexical, probability: null, reason: null });
  assert.equal(result.skill.value, 'skill:tdd');
  const empty = await routeTask({ task, input: {} }, deps({ catalog: { request: async () => ({ snapshot_id: 's', rows: [] }) }, classifier: laya(() => answer('laya', 'host:claude', 0.9)) }));
  assert.deepEqual(empty.skill, { ...lexical, name: null, probability: null, reason: 'no_candidates' });
  assert.equal(empty.host.value, 'claude');
});

test('JEV is asked only with a vault key and this request\'s opt-in; the key never reaches the answer', async () => {
  await assert.rejects(routeTask({ task, input: { jev: true } }, deps()), { status: 409 }, 'opt-in without a key');
  const notOpted = await routeTask({ task, input: { jev: false } }, deps({ keys: { ...jevKeys, secretFor: refuse('vault read') } }));
  assert.equal(notOpted.provider, null); assert.equal(notOpted.jevAvailable, true);
  const calls = [];
  const jevSelect = async (prompt, questions, key) => {
    calls.push({ prompt, key, questions: Object.fromEntries(Object.entries(questions).map(([name, list]) => [name, list.map(row => row.source_id)])) });
    return { host: answer('jev', 'host:claude', 0.91), skill: answer('jev', null, 0.5), effort: answer('jev', 'effort:alto', 0.77) };
  };
  const result = await routeTask({ task, input: { jev: true } }, deps({ keys: jevKeys, jevSelect, classifier: laya(refuse('Laya')) }));
  assert.equal(calls.length, 1, 'one bridge call for the three questions');
  assert.equal(calls[0].key, 'SECRET-JEV-KEY-0123');
  assert.deepEqual(calls[0].questions, { host: ['host:claude', 'host:codex'], effort: ['effort:baixo', 'effort:medio', 'effort:alto'], skill: ['skill:tdd', 'skill:review'] });
  assert.equal(result.provider, 'jev');
  assert.deepEqual(result.host, { value: 'claude', source: 'jev', probability: 0.91, reason: 'selected' });
  assert.deepEqual(result.skill, { value: 'skill:tdd', name: 'tdd', source: 'lexical', probability: 0.5, reason: 'below_threshold' });
  assert.equal(result.effort.value, 'alto');
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  const failed = await routeTask({ task, input: { jev: true } }, deps({ keys: jevKeys, jevSelect: async () => { throw new Error('SECRET-JEV-KEY-0123 leaked') } }));
  assert.deepEqual([failed.host, failed.effort].map(field => field.source), ['lexical', 'lexical']);
  assert.doesNotMatch(JSON.stringify(failed), /SECRET/);
  const vaultMiss = await routeTask({ task, input: { jev: true } }, deps({ keys: { ...jevKeys, secretFor: async () => null } }));
  assert.equal(vaultMiss.host.reason, 'unavailable', 'a vault entry that cannot be read never calls JEV');
  for (const input of [{ jev: 'yes' }, { jev: true, extra: 1 }]) await assert.rejects(routeTask({ task, input }, deps({ keys: jevKeys })), { status: 400 });
});

test('the JEV bridge sends the key on stdin to the adapter script, never on its command line', async () => {
  const seen = [];
  const select = jevBridge({ repoRoot: 'C:\\repo', python: 'py.exe', run: async (...args) => { seen.push(args); return {}; } });
  await select('texto', { host: [] }, 'SECRET-JEV-KEY-0123');
  const [python, args, options] = seen[0];
  assert.equal(python, 'py.exe');
  assert.deepEqual(args, ['-I', path.join('C:\\repo', 'harness', 'prompt_classifier.py')]);
  assert.deepEqual(options.input, { api_key: 'SECRET-JEV-KEY-0123', prompt: 'texto', questions: { host: [] } });
});

test('POST /api/tasks/:id/route needs the local token, answers for a known task and starts nothing', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-router-api-'));
  const app = createOmniForgeServer({ dataDir: path.join(dir, 'data'), token: 'router-test', catalog, classifier: { ...laya(() => answer('laya', 'host:codex', 0.8)), close: async () => {} },
    keyVault: noKeys, jevSelect: refuse('JEV') });
  const base = new URL(await app.listen()).origin;
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const post = (route, value, token = 'router-test') => fetch(`${base}${route}`, { method: 'POST', headers: { 'x-omniforge-token': token, 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const project = await (await post('/api/projects', { name: 'Router', root: dir })).json();
  const created = await (await post('/api/tasks', { projectId: project.id, title: 'Revisar o README' })).json();
  assert.equal((await post(`/api/tasks/${created.id}/route`, {}, 'wrong-token-of-same-size')).status, 403);
  const reply = await post(`/api/tasks/${created.id}/route`, {});
  assert.equal(reply.status, 200);
  const suggestion = await reply.json();
  assert.equal(suggestion.taskId, created.id); assert.equal(suggestion.host.value, 'codex'); assert.equal(suggestion.runnable, false);
  assert.equal((await post('/api/tasks/missing/route', {})).status, 404);
  assert.equal((await post(`/api/tasks/${created.id}/route`, { jev: 1 })).status, 400);
  assert.deepEqual(app.engine.list(project.id), [], 'a suggestion never dispatches a run');
});
