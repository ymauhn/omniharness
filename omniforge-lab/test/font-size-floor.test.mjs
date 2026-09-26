import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Functional UI text (buttons, labels, nav, meta rows, badges, micro-labels) must stay readable.
// Exempt only visually-hidden text and terminal output (xterm), per the page's own accessibility floor.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const exempt = /visually-hidden|terminal-output|terminal-xterm|\.xterm\b/;
const fontDecl = /font(-size)?\s*:/;
const pxSize = /(\d+(?:\.\d+)?)px/g;
// Matches one leaf `selector { declarations }` block at a time; a wrapping
// @media's own braces never satisfy this (its body contains further braces),
// so nested rules are found without a full CSS parser.
const rulePattern = /([^{}]+)\{([^{}]*)\}/g;

function cssSources() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inlineStyle = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const sources = [['index.html', inlineStyle]];
  for (const name of fs.readdirSync(root)) {
    if (name.endsWith('.css')) sources.push([name, fs.readFileSync(path.join(root, name), 'utf8')]);
  }
  return sources;
}

test('no functional UI text in the Lab page drops below an 11px floor', () => {
  const offenders = [];
  for (const [file, css] of cssSources()) {
    for (const [, selector, body] of css.matchAll(rulePattern)) {
      if (exempt.test(selector)) continue;
      for (const decl of body.split(';')) {
        if (!fontDecl.test(decl)) continue;
        for (const match of decl.matchAll(pxSize)) {
          if (Number(match[1]) < 11) offenders.push(`${file}: ${selector.trim()} { ${decl.trim()} }`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
