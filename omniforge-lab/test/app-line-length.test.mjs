import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');

test('no line in omniforge-lab/app/*.mjs is longer than 200 characters', () => {
  const files = fs.readdirSync(appDir).filter(name => name.endsWith('.mjs'));
  assert.ok(files.length > 0, 'app/ must contain the page modules');
  const offenders = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(appDir, file), 'utf8').split('\n');
    lines.forEach((line, index) => { if (line.length > 200) offenders.push(`${file}:${index + 1} (${line.length} chars)`); });
  }
  assert.deepEqual(offenders, []);
});
