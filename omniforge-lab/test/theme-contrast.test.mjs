import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// WCAG 2.x contrast computed from the page's own theme tokens; layout itself needs a browser.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const themes = Object.fromEntries([...html.matchAll(/body\[data-theme="(\w+)"\] \{([^}]*)\}/g)]
  .map(([, name, body]) => [name, Object.fromEntries([...body.matchAll(/--(\w+):(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map(([, key, value]) => [key, value]))]));
const luminance = hex => {
  const value = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };

test('every theme keeps text tokens at 4.5:1 and form-field borders at 3:1 on the surfaces they sit on', () => {
  assert.deepEqual(Object.keys(themes).sort(), ['atelier', 'bridge', 'operations']);
  assert.ok(Math.abs(ratio('#267889', '#ebf0ed') - 4.41) < 0.01, 'the ratio helper matches the audited value');
  for (const [name, tokens] of Object.entries(themes)) {
    for (const text of ['text', 'muted', 'accent', 'ok', 'warn', 'danger']) for (const surface of ['bg', 'surface', 'surface2', 'surface3']) {
      const value = ratio(tokens[text], tokens[surface]);
      assert.ok(value >= 4.5, `${name}: --${text} on --${surface} is ${value.toFixed(2)}:1`);
    }
    assert.ok(ratio(tokens.accentText, tokens.accent) >= 4.5, `${name}: button text on --accent`);
    assert.ok(tokens.field, `${name}: missing --field token for form-field borders`);
    for (const surface of ['bg', 'surface', 'surface2']) {
      const value = ratio(tokens.field, tokens[surface]);
      assert.ok(value >= 3, `${name}: --field against --${surface} is ${value.toFixed(2)}:1`);
    }
  }
  assert.match(html, /input:not\(\[type=checkbox\]\):not\(\[type=radio\]\), textarea, select \{[^}]*border:1px solid var\(--field\)/);
  assert.match(html, /\.theme-select \{[^}]*border:1px solid var\(--field\)/);
  assert.match(html, /input::placeholder, textarea::placeholder \{ color:var\(--muted\); opacity:1; \}/, 'placeholders are not faded below the muted ratio');
});

test('a long project root wraps inside the workspace scope badge instead of widening the page', () => {
  assert.match(html, /#workspace-scope \{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere;/);
});
