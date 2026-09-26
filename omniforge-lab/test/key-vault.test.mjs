import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { KeyVault, windowsCredentialBackend } from '../key-vault.mjs';

function memoryBackend() {
  const items = new Map();
  return { items, async write(target, secret) { items.set(target, secret); }, async read(target) { return items.get(target) ?? null; }, async remove(target) { return items.delete(target); } };
}

test('the vault records only provider, masked suffix and an opaque reference; the secret never reaches its file', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-keys-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const backend = memoryBackend();
  const vault = new KeyVault({ dataDir, backend });
  const secret = `sk-test-${randomUUID()}`;
  const row = await vault.store({ provider: 'jev', secret });
  assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'provider', 'ref', 'suffix', 'validation']);
  assert.equal(row.suffix, secret.slice(-4));
  assert.deepEqual(row.validation, { status: 'não verificada', at: null });
  const saved = fs.readFileSync(path.join(dataDir, 'keys.json'), 'utf8');
  assert.equal(saved.includes(secret), false);
  assert.equal(JSON.stringify(vault.list()).includes(secret), false);
  assert.equal(await vault.secretFor(row.ref), secret);
  await assert.rejects(vault.store({ provider: 'jev', secret: 'curta' }), /inválid/);
  await assert.rejects(vault.store({ provider: '../x', secret }), /inválid/);
  await vault.remove(row.ref);
  assert.deepEqual(vault.list(), []);
  assert.equal(backend.items.size, 0);
  await assert.rejects(vault.secretFor(row.ref), /não encontrada/);
});

test('concurrent vault changes never lose a stored key or leave a secret without its row', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-keys-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const backend = memoryBackend();
  const slow = ms => new Promise(resolve => setTimeout(resolve, ms));
  const vault = new KeyVault({ dataDir, backend: { ...backend, async write(...args) { await slow(10); return backend.write(...args); }, async remove(...args) { await slow(60); return backend.remove(...args); } } });
  const secret = `sk-test-${randomUUID()}`;
  const a = await vault.store({ provider: 'jev', secret });
  const [, b] = await Promise.all([vault.remove(a.ref), vault.store({ provider: 'openai', secret })]);
  assert.deepEqual(vault.list().map(row => row.ref), [b.ref]);
  const c = await vault.store({ provider: 'jev', secret });
  await Promise.all([vault.remove(b.ref), vault.remove(c.ref)]);
  assert.deepEqual([vault.list(), backend.items.size], [[], 0]);
  // Metadata that cannot be read or saved leaves no secret behind in the OS vault.
  fs.writeFileSync(path.join(dataDir, 'keys.json'), '{ torn');
  await assert.rejects(vault.store({ provider: 'jev', secret }), SyntaxError);
  fs.rmSync(path.join(dataDir, 'keys.json'));
  vault.save = () => { throw new Error('disco cheio'); };
  await assert.rejects(vault.store({ provider: 'jev', secret }), /disco cheio/);
  assert.equal(backend.items.size, 0);
});

test('the Windows Credential Manager backend round-trips a dummy secret through stdin and deletes it', async () => {
  if (process.platform !== 'win32') return;
  const backend = windowsCredentialBackend();
  const target = `OmniForge-test:${randomUUID()}`;
  const secret = `dummy-${randomUUID()}-não-real`;
  try {
    await backend.write(target, secret);
    assert.equal(await backend.read(target), secret);
  } finally {
    assert.equal(await backend.remove(target), true);
  }
  assert.equal(await backend.read(target), null);
});
