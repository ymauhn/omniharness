import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runExtension } from '../extension-runner.mjs';

test('a pure extension receives only its input and returns plain data', async () => {
  const source = 'function check(input) { return { count: input.files.length, first: input.files[0].path }; }';
  const result = await runExtension({ source, input: { files: [{ path: 'a.md', text: 'x' }] } });
  assert.deepEqual(result, { ok: true, result: { count: 1, first: 'a.md' } });
});

test('malicious or broken variants fail closed without touching the host', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-ext-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const secret = path.join(dir, 'outside-secret.txt');
  fs.writeFileSync(secret, 'HOST_SECRET');
  const cases = {
    escape: `function check() { return { leaked: this.constructor.constructor('return process')().env.PATH }; }`,
    evalEscape: `function check() { return { leaked: eval('1+1') }; }`,
    hostRealm: `function check(input) { const F = input.constructor.constructor; return { leaked: F('return process')().pid }; }`,
    requireFs: `function check() { return { leaked: require('node:fs').readFileSync(${JSON.stringify(secret)}, 'utf8') }; }`,
    network: `function check() { return { leaked: typeof fetch + typeof WebSocket + typeof process }; }`,
    loop: 'function check() { for (;;) {} }',
    huge: `function check() { return { blob: 'x'.repeat(2 * 1024 * 1024) }; }`,
    throws: 'function check() { throw new Error("boom"); }',
    promise: 'function check() { return Promise.resolve({ late: true }); }',
    missing: 'const notCheck = 1;',
    syntax: 'function check( {',
  };
  for (const [name, source] of Object.entries(cases)) {
    const result = await runExtension({ source, input: { files: [] }, timeoutMs: 1500 });
    if (name === 'network') {
      // No host globals exist in the context: the probe sees only undefined values.
      assert.deepEqual(result, { ok: true, result: { leaked: 'undefinedundefinedundefined' } }, name);
      continue;
    }
    assert.equal(result.ok, false, `${name}: ${JSON.stringify(result)}`);
    assert.equal(JSON.stringify(result).includes('HOST_SECRET'), false, name);
    assert.match(result.reason, /^(denied|timeout|crash|invalid-output|output-too-large)$/, name);
  }
});

test('a missing module source is refused before any process runs', async () => {
  const result = await runExtension({ source: null, input: {} });
  assert.deepEqual(result, { ok: false, reason: 'denied', error: 'Módulo da extensão ausente' });
});
