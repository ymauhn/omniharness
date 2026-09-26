import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../core.mjs';
import { createWorkflowService, workflowPresets, validateWorkflow } from '../workflows.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-workflows-'));
  fs.mkdirSync(path.join(dir, 'a')); fs.mkdirSync(path.join(dir, 'b'));
  const store = new WorkspaceStore(path.join(dir, 'data'));
  const a = store.addProject({ name: 'A', root: path.join(dir, 'a') });
  const b = store.addProject({ name: 'B', root: path.join(dir, 'b') });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, a, b, dir, service: createWorkflowService({ store }) };
}
const definition = () => structuredClone(workflowPresets()[0].definition);
const save = (service, projectId) => service.create({ projectId, definition: definition(), reviewed: true });

test('persisted prompt whitespace cannot change under an unchanged version digest', t => {
  const { store, service, a } = fixture(t); save(service, a.id);
  const version = store.data.workflowRegistry.workflows[0].revisions[0];
  version.definition.nodes[0].prompt = ` ${version.definition.nodes[0].prompt} `;
  assert.throws(() => createWorkflowService({ store }), error => error.status === 503);
});

test('a stale saved-workflow edit cannot silently overwrite a newer revision', t => {
  const { service, a } = fixture(t);
  const row = save(service, a.id);
  const updated = { ...definition(), title: 'Reviewed correction' };
  service.update(row.id, { projectId: a.id, expectedRevision: 1, definition: updated, reviewed: true });
  assert.throws(() => service.update(row.id, { projectId: a.id, expectedRevision: 1, definition: definition(), reviewed: true }), e => e.status === 409);
  assert.equal(service.get(row.id, a.id).workflow.revisions.at(-1).definition.title, 'Reviewed correction');
});

test('capacity caps are per project and reported apart from revision conflicts', t => {
  const { store, service, a, b } = fixture(t), row = save(service, a.id);
  const full = e => e.status === 507 && /Limite de/.test(e.message);
  const small = service.create({ projectId: b.id, definition: { ...definition(), nodes: [definition().nodes[0]] }, reviewed: true });
  for (let index = 0; index < 256; index++) service.tasks(small.id, { projectId: b.id, expectedRevision: 1, nodeId: 'step-1', requestId: `b-${index}` });
  assert.throws(() => service.tasks(small.id, { projectId: b.id, expectedRevision: 1, nodeId: 'step-1', requestId: 'b-over' }), full);
  assert.equal(service.tasks(row.id, { projectId: a.id, expectedRevision: 1, nodeId: 'step-1', requestId: 'a-1' }).projectId, a.id, 'a full project must not lock out another project');
  const seeded = store.data.workflowRegistry.workflows.find(item => item.id === row.id);
  store.data.workflowRegistry.workflows.push(...Array.from({ length: 127 }, (_, index) => ({ ...structuredClone(seeded), id: `seed-${index}` })));
  seeded.revisions = Array.from({ length: 32 }, (_, index) => ({ ...seeded.revisions[0], version: index + 1 })); seeded.revision = 32;
  const busy = createWorkflowService({ store });
  assert.throws(() => busy.update(row.id, { projectId: a.id, expectedRevision: 32, definition: definition(), reviewed: true }), full);
  assert.throws(() => save(busy, a.id), full);
  assert.equal(save(busy, b.id).projectId, b.id);
});

test('presets span five pillars but are defensive non-executable suggestions', () => {
  const rows = workflowPresets();
  assert.equal(new Set(rows.map(row => row.definition.pillar)).size, 5);
  assert.ok(rows.every(row => row.kind === 'suggestion' && row.runnable === false));
  for (const row of rows) assert.deepEqual(validateWorkflow(row.definition), row.definition);
  rows[0].definition.nodes[0].prompt = 'Tampered';
  assert.notEqual(workflowPresets()[0].definition.nodes[0].prompt, 'Tampered');
});

test('DAG validation rejects unknown edges, cycles, duplicate IDs, hostile keys and authority escalation', () => {
  const invalid = [
    value => value.nodes[0].dependsOn.push('missing'),
    value => value.nodes[0].dependsOn.push('step-3'),
    value => value.nodes[1].id = value.nodes[0].id,
    value => value.nodes[0].id = '__proto__',
    value => value.nodes[0].command = 'run arbitrary code',
    value => value.authority = 'automatic-paid-execution',
    value => value.nodes[0].prompt = 'x'.repeat(3501),
    value => value.nodes = Array.from({ length: 17 }, (_, index) => ({ ...value.nodes[0], id: `n${index}` })),
    value => value.nodes[0].prompt = '\ud800',
  ];
  for (const mutate of invalid) { const value = definition(); mutate(value); assert.throws(() => validateWorkflow(value), e => [400, 413].includes(e.status)); }
  const large = definition(); large.nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, title: 'Node', prompt: 'x'.repeat(3000), dependsOn: [], skills: [] }));
  assert.throws(() => validateWorkflow(large), e => e.status === 413);
});

test('project binding is immutable on reads, edits, archive and task creation', t => {
  const { service, store, a, b } = fixture(t), row = save(service, a.id);
  assert.deepEqual(service.list(b.id).rows, []);
  assert.throws(() => service.create({ projectId: a.id, definition: definition(), reviewed: false }), e => e.status === 400);
  for (const action of [
    () => service.get(row.id, b.id),
    () => service.update(row.id, { projectId: b.id, expectedRevision: 1, definition: definition(), reviewed: true }),
    () => service.archive(row.id, { projectId: b.id, expectedRevision: 1 }),
    () => service.tasks(row.id, { projectId: b.id, expectedRevision: 1, nodeId: 'step-1', requestId: 'cross-project' }),
  ]) assert.throws(action, e => e.status === 404);
  assert.equal(store.data.tasks.length, 0);
});

test('explicit task creation pins prompts and dependencies atomically, never dispatches or passes tasks', t => {
  const { service, store, a } = fixture(t), row = save(service, a.id);
  const input = { projectId: a.id, expectedRevision: 1, nodeId: 'step-3', requestId: 'click-1' };
  const run = service.tasks(row.id, input);
  assert.equal(store.data.tasks.length, 3);
  assert.equal(run.dispatch, 'none'); assert.equal(run.outcome, null);
  assert.ok(store.data.tasks.every(task => task.status === 'open'));
  assert.deepEqual(store.task(run.taskIds['step-3']).dependsOn, [run.taskIds['step-2']]);
  assert.throws(() => store.setTaskStatus(run.taskIds['step-3'], 'done'), e => e.status === 409);
  assert.equal(run.definition.nodes[0].prompt, definition().nodes[0].prompt);
  assert.equal(Object.hasOwn(store.task(run.taskIds['step-1']).workflow, 'prompt'), false, 'generic state task references do not leak prompt bodies');
  assert.deepEqual(service.tasks(row.id, input), run); // retry does not duplicate
  assert.equal(store.data.tasks.length, 3);
  assert.throws(() => service.tasks(row.id, { ...input, nodeId: 'step-2' }), e => e.status === 409);
  const changed = definition(); changed.nodes[0].prompt = 'New version';
  service.update(row.id, { projectId: a.id, expectedRevision: 1, definition: changed, reviewed: true });
  assert.deepEqual(service.tasks(row.id, input), run); // a response lost before an edit is recoverable
  assert.equal(service.get(row.id, a.id).runs[0].definition.nodes[0].prompt, definition().nodes[0].prompt);
  assert.throws(() => service.tasks(row.id, { ...input, requestId: 'click-2' }), e => e.status === 409);
  run.definition.nodes[0].prompt = 'Caller mutation';
  assert.notEqual(service.get(row.id, a.id).runs[0].definition.nodes[0].prompt, 'Caller mutation');
});

test('ancestor task selection excludes unrelated branches and preserves fan-in', t => {
  const { service, store, a } = fixture(t), value = definition();
  value.nodes[1].dependsOn = [];
  value.nodes[2].dependsOn = ['step-1', 'step-2'];
  value.nodes.push({ id: 'unrelated', title: 'Unrelated', prompt: 'Not selected', dependsOn: [], skills: [] });
  const row = service.create({ projectId: a.id, definition: value, reviewed: true });
  const run = service.tasks(row.id, { projectId: a.id, expectedRevision: 1, nodeId: 'step-3', requestId: 'fan-in' });
  assert.deepEqual(Object.keys(run.taskIds), ['step-1', 'step-2', 'step-3']);
  assert.equal(store.data.tasks.length, 3);
  assert.deepEqual(store.task(run.taskIds['step-3']).dependsOn, [run.taskIds['step-1'], run.taskIds['step-2']]);
});

test('disk failure preserves previous state and cannot leave orphan or partially created tasks', t => {
  const { service, store, a } = fixture(t), row = save(service, a.id), before = store.snapshot();
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => { if (target === store.file) throw Error('private filesystem path'); return rename(source, target); });
  assert.throws(() => service.tasks(row.id, { projectId: a.id, expectedRevision: 1, nodeId: 'step-3', requestId: 'failed-save' }), e => e.status === 500 && !e.message.includes('private filesystem'));
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')), before);
});

test('restart preserves versions, archived state, idempotency and immutable task snapshots', t => {
  const { service, store, dir, a } = fixture(t), row = save(service, a.id);
  const input = { projectId: a.id, expectedRevision: 1, nodeId: 'step-2', requestId: 'restart-click' };
  const run = service.tasks(row.id, input);
  service.update(row.id, { projectId: a.id, expectedRevision: 1, definition: { ...definition(), title: 'Version 2' }, reviewed: true });
  service.archive(row.id, { projectId: a.id, expectedRevision: 2 });
  store.close();
  const reopened = new WorkspaceStore(path.join(dir, 'data'));
  const restored = createWorkflowService({ store: reopened });
  assert.equal(restored.get(row.id, a.id).workflow.revisions.length, 2);
  assert.ok(restored.list(a.id).rows[0].archivedAt);
  assert.deepEqual(restored.tasks(row.id, input), run);
  assert.throws(() => restored.tasks(row.id, { ...input, expectedRevision: 3, requestId: 'new' }), e => e.status === 409);
  assert.equal(reopened.data.tasks.length, 2);
  reopened.close();
});

test('malformed persisted schema, digest or task binding fails closed at service startup', t => {
  const { service, store, a } = fixture(t), row = save(service, a.id);
  service.tasks(row.id, { projectId: a.id, expectedRevision: 1, nodeId: 'step-1', requestId: 'pin' });
  const before = store.snapshot();
  for (const corrupt of [data => data.workflowRegistry.schema = 2, data => data.workflowRegistry.workflows[0].revisions[0].definition.title = 'Changed', data => data.tasks[0].workflow.prompt = 'Silent change', data => data.workflowRegistry.runs[0].outcome = 'pass', data => data.workflowRegistry.runs[0].projectId = 'other']) {
    store.data = structuredClone(before); corrupt(store.data);
    assert.throws(() => createWorkflowService({ store }), e => e.status === 503 && !e.message.includes('Silent change'));
  }
  store.data = before;
});

test('route seam keeps project scope explicit and unknown methods fail visibly', t => {
  const { service, a } = fixture(t);
  const route = (method, suffix, input) => service.handle({ method, url: new URL(`http://localhost${suffix}`), input });
  assert.equal(route('GET', '/api/other'), null);
  assert.equal(route('GET', `/api/workflows/presets?projectId=${a.id}`).body.rows.length, 5);
  assert.throws(() => route('GET', '/api/workflows'), e => e.status === 404);
  const created = route('POST', '/api/workflows', { projectId: a.id, definition: definition(), reviewed: true });
  assert.equal(created.changed, true);
  assert.equal(route('GET', `/api/workflows/${created.body.id}?projectId=${a.id}`).body.workflow.id, created.body.id);
  assert.equal(route('POST', `/api/workflows/${created.body.id}/dispatch`, {}).status, 404);
  assert.equal(route('GET', '/api/workflows/%00').status, 404);
});
