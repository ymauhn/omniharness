import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const count = (text, char) => text.split(char).length - 1;

// The inline script (base index.html) quoted interpolated names with typographic quotes
// (“…”) in exactly these user-visible strings. The module split must not silently turn
// them into ASCII quotes: same DOM text, same log text as before the move.
const expected = { 'tasks.mjs': 5, 'workspace.mjs': 3, 'graphs.mjs': 2 };

test('user-visible quoted names keep the typographic “…” quotes after the module split', () => {
  for (const [file, pairs] of Object.entries(expected)) {
    const text = fs.readFileSync(path.join(appDir, file), 'utf8');
    assert.equal(count(text, '“'), pairs, `${file} should open ${pairs} typographic quote(s)`);
    assert.equal(count(text, '”'), pairs, `${file} should close ${pairs} typographic quote(s)`);
  }
});
