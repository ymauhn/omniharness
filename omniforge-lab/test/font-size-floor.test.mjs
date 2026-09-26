import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Functional UI text (buttons, labels, nav, meta rows, badges, micro-labels) must stay readable.
// Exempt only visually-hidden text and terminal output (xterm), per the page's own accessibility floor.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['index.html', 'copilot.css', 'terminal-grid.css', 'workflow-panel.css', 'arsenal-panel.css', 'memory-panel.css'];
const exempt = /visually-hidden|terminal-output|terminal-xterm|\.xterm\b/;
const sizePattern = /font(?:-size)?\s*:\s*(\d+(?:\.\d+)?)px/g;

test('no functional UI text in the Lab page drops below an 11px floor', () => {
  const offenders = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (exempt.test(line)) return;
      for (const match of line.matchAll(sizePattern)) {
        if (Number(match[1]) < 11) offenders.push(`${file}:${index + 1}: ${match[0]}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});
