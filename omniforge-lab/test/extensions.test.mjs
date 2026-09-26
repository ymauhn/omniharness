import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExtensionService, projectSnapshot } from '../extensions.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-ext-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const write = (file, text = 'x') => { fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true }); fs.writeFileSync(path.join(project, file), text); };
  write('README.md', '# Demo\n![logo](assets/logo.png)\n[guia](docs/guia.md) [sumiu](assets/sumiu.png) [web](https://example.com) [âncora](#topo)');
  write('assets/logo.png');
  write('docs/guia.md', '[voltar](../README.md)\n<img src="../assets/perdido.svg">');
  write('node_modules/pkg/readme.md', '[ignorado](nada.png)');
  return { root, project, service: new ExtensionService({ dataDir: path.join(root, 'data') }) };
}

test('the project snapshot is scoped, bounded and skips dependency folders', async t => {
  const { project } = fixture(t);
  const snapshot = await projectSnapshot(project);
  assert.deepEqual(snapshot.files.map(file => file.path).sort(), ['README.md', 'assets/logo.png', 'docs/guia.md']);
  assert.equal(snapshot.files.find(file => file.path === 'assets/logo.png').text, undefined);
  assert.equal(snapshot.truncated, false);
});

test('the snapshot stops walking at its file, directory and time caps', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-snap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < 300; i++) { fs.mkdirSync(path.join(root, `d${i}`)); fs.writeFileSync(path.join(root, `d${i}`, 'f.txt'), 'x'); }
  const readdir = fs.promises.readdir;
  let reads = 0;
  fs.promises.readdir = (...args) => { reads++; return readdir(...args); };
  t.after(() => { fs.promises.readdir = readdir; });
  for (const [limits, most] of [[{ maxFiles: 5 }, 10], [{ maxDirs: 10 }, 10], [{ maxMs: 0 }, 0]]) {
    reads = 0;
    const snapshot = await projectSnapshot(root, limits);
    assert.equal(snapshot.truncated, true, JSON.stringify(limits));
    assert.ok(reads <= most, `${JSON.stringify(limits)}: ${reads} leituras de pasta`);
  }
});

test('mutations need the registry revision, rollback walks back and a run re-checks the enabled version', async t => {
  const { service, project } = fixture(t);
  const projectId = 'p5';
  const revision = () => ({ expectedRevision: service.list(projectId).revision });
  for (let version = 1; version <= 3; version++) {
    await service.generate(projectId, 'verificador de links de assets');
    await assert.rejects(service.preview(projectId, version), /Revisão esperada/);
    await service.preview(projectId, version, revision());
    await service.enable(projectId, version, { reviewed: true, ...revision() });
  }
  for (const action of ['disable', 'rollback']) await assert.rejects(service[action](projectId, {}), /Revisão esperada/);
  await assert.rejects(service.enable(projectId, 1, { reviewed: true }), /Revisão esperada/);
  const walked = [];
  for (let step = 0; step < 2; step++) { await service.rollback(projectId, revision()); walked.push(service.list(projectId).enabled.version); }
  assert.deepEqual(walked, [2, 1]);
  await assert.rejects(service.rollback(projectId, revision()), /Não há versão/);
  const running = service.run(projectId, project);
  await service.disable(projectId, revision());
  assert.deepEqual(Object.values(await running).slice(0, 2), [false, 'disabled']);
});

test('rollback skips stack entries equal to the version already enabled', async t => {
  const { service } = fixture(t);
  const projectId = 'p7';
  const revision = () => ({ expectedRevision: service.list(projectId).revision });
  const enable = version => service.enable(projectId, version, { reviewed: true, ...revision() });
  for (let version = 1; version <= 2; version++) {
    await service.generate(projectId, 'verificador de links de assets');
    await service.preview(projectId, version, revision());
  }
  await enable(1); await enable(2);
  await service.disable(projectId, revision());
  await enable(2);
  await service.rollback(projectId, revision());
  assert.equal(service.list(projectId).enabled.version, 1);
  await service.disable(projectId, revision());
  await enable(1);
  await assert.rejects(service.rollback(projectId, revision()), /Não há versão/);
});

test('the runner executes the bytes whose hash was verified, not a later edit of the module', async t => {
  const { service } = fixture(t);
  const row = await service.generate('p6', 'verificador de links de assets');
  const pending = service.execute(row, { files: [] });
  fs.writeFileSync(row.path, 'function check() { return { tampered: true }; }');
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.tampered, undefined);
});

test('a generated checker is versioned, previewed on fixtures, enabled only after review and finds broken links', async t => {
  const { service, project } = fixture(t);
  const projectId = 'p1';
  await assert.rejects(service.generate(projectId, 'faça um jogo'), /verificador de links/);
  const v1 = await service.generate(projectId, 'Criar um verificador de links quebrados nos assets');
  assert.equal(v1.version, 1);
  assert.match(v1.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(v1.manifest.capabilities, []);
  let registry = service.list(projectId);
  await assert.rejects(service.enable(projectId, 1, { reviewed: true, expectedRevision: registry.revision }), /pré-visualização/);
  const preview = await service.preview(projectId, 1, { expectedRevision: registry.revision });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  registry = service.list(projectId);
  await assert.rejects(service.enable(projectId, 1, { reviewed: false, expectedRevision: registry.revision }), /revisão/);
  await service.enable(projectId, 1, { reviewed: true, expectedRevision: registry.revision });
  const report = await service.run(projectId, project);
  assert.equal(report.ok, true);
  assert.deepEqual(report.result.missing.map(item => `${item.file}:${item.line}:${item.ref}`).sort(), ['README.md:3:assets/sumiu.png', 'docs/guia.md:2:../assets/perdido.svg']);
  assert.equal(report.result.references, 5);
});

test('tampering, stale revisions and crashing variants fail closed and disable/rollback restore the previous state', async t => {
  const { service, project, root } = fixture(t);
  const projectId = 'p2';
  const ready = async () => {
    const version = await service.generate(projectId, 'verificador de links de assets');
    await service.preview(projectId, version.version, { expectedRevision: service.list(projectId).revision });
    await service.enable(projectId, version.version, { reviewed: true, expectedRevision: service.list(projectId).revision });
    return version;
  };
  const v1 = await ready();
  const v2 = await ready();
  assert.equal(service.list(projectId).enabled.version, 2);
  await assert.rejects(service.disable(projectId, { expectedRevision: service.list(projectId).revision - 1 }), /revisão/);
  await service.rollback(projectId, { expectedRevision: service.list(projectId).revision });
  assert.equal(service.list(projectId).enabled.version, 1);
  // A module edited after review is refused before it runs.
  fs.appendFileSync(v1.path, '\nfunction check() { return { missing: [] }; }');
  const tampered = await service.run(projectId, project);
  assert.deepEqual([tampered.ok, tampered.reason], [false, 'denied']);
  // A crashing or looping generator output cannot pass preview, so it can never be enabled.
  for (const [id, source] of [['p3', 'function check() { throw new Error("crash"); }'], ['p4', 'function check() { for (;;) {} }']]) {
    const crashing = new ExtensionService({ dataDir: path.join(root, 'data'), templateSource: source, timeoutMs: 800 });
    const bad = await crashing.generate(id, 'verificador de links de assets');
    const failed = await crashing.preview(id, bad.version, { expectedRevision: crashing.list(id).revision });
    assert.equal(failed.ok, false, id);
    await assert.rejects(crashing.enable(id, bad.version, { reviewed: true, expectedRevision: crashing.list(id).revision }), /pré-visualização/);
  }
  await service.disable(projectId, { expectedRevision: service.list(projectId).revision });
  assert.equal(service.list(projectId).enabled, null);
  const off = await service.run(projectId, project);
  assert.deepEqual([off.ok, off.reason], [false, 'disabled']);
  assert.equal(fs.existsSync(path.join(root, 'data', 'extensions')), true);
});
