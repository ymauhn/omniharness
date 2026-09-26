import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileDurable, writeFileAtomic } from '../lib/fsutil.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-fsutil-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('writeFileDurable creates the file, fsyncs it and leaves the exact content readable', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'state.json');
  const synced = t.mock.method(fs, 'fsyncSync');
  writeFileDurable(file, 'hello', { mode: 0o600 });
  assert.equal(fs.readFileSync(file, 'utf8'), 'hello');
  assert.ok(synced.mock.callCount() >= 1);
});

test('writeFileAtomic replaces the file without ever exposing a partial write, and leaves no temp file behind', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'registry.json');
  writeFileAtomic(file, JSON.stringify({ n: 1 }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 1 });
  writeFileAtomic(file, JSON.stringify({ n: 2 }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 2 });
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), []);
});

test('writeFileAtomic cleans up its temp file and leaves the target untouched when the rename fails', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'registry.json');
  writeFileAtomic(file, 'original');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', () => { throw new Error('disk full'); });
  assert.throws(() => writeFileAtomic(file, 'new'), /disk full/);
  fs.renameSync = rename;
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), []);
});
