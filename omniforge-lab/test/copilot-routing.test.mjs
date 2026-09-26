import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountCopilot } from '../copilot.mjs';

// DOM controller seam only; this does not render or navigate a browser.
function environment() {
  const doc = { hidden: false, events: {}, addEventListener(name, fn) { (this.events[name] ||= []).push(fn); } };
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.classList = { add() {}, remove() {} }; this.dataset = {}; this.hidden = false; this._text = ''; }
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; this._text = ''; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get value() { return this._value ?? (this.tag === 'select' ? this.children[0]?.value : '') ?? ''; }
    set value(value) { this._value = value; }
    setAttribute() {}
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    async fire(name, event = {}) { for (const fn of this.events[name] || []) await fn({ target: this, ...event }); }
    focus() { doc.activeElement = this; }
    setSelectionRange(start, end) { Object.assign(this, { selectionStart: start, selectionEnd: end }); }
    contains(value) { return this === value || this.children.some(child => child.contains(value)); }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
    getClientRects() { return [{}]; }
  }
  doc.createElement = tag => new Element(tag);
  return { doc, Element };
}

test('actual Copilot sends the same bounded long-prompt excerpt to metadata and Laya', async () => {
  const names = ['document', 'matchMedia', 'IntersectionObserver', 'localStorage'];
  const previous = Object.fromEntries(names.map(name => [name, globalThis[name]]));
  try {
    for (const text of ['x'.repeat(1000) + ' choose-b', '🤖'.repeat(600) + ' choose-b']) {
      const { doc, Element } = environment();
      Object.assign(globalThis, { document: doc, matchMedia: () => ({ matches: true, addEventListener() {} }),
        IntersectionObserver: class { observe() {} }, localStorage: { getItem: () => '{"provider":"laya","motion":"off"}', setItem() {} } });
      const root = new Element('section'), draft = new Element('textarea'); draft.value = text; doc.activeElement = draft;
      let query, prompt;
      const api = async (route, options) => {
        if (route.startsWith('/api/skills?')) {
          query = new URL(route, 'http://local').searchParams.get('q');
          return { snapshot_id: 's', coverage: { complete: true }, issues: [], total: 1,
            rows: [{ skill_id: query.includes('choose-b') ? 'b' : 'a', name: 'Candidate', ring: 'installed', availability: 'installed' }] };
        }
        if (route === '/api/copilot/classify') {
          prompt = options.body.prompt;
          return { provider: 'laya', projectId: 'p', snapshot_id: 's', reason: 'selected', runnable: false, source_id: prompt.includes('choose-b') ? 'b' : 'a' };
        }
        return { state: 'ready', enabled: true, queued: 0 };
      };
      const controller = mountCopilot({ root, draft, api, getProjectId: () => 'p', getNotes: () => [], openSkills() {} });
      try {
        await root.querySelectorAll('button').find(button => button.textContent === 'Skills').fire('click');
        assert.equal(query, prompt);
        assert.ok(Buffer.byteLength(prompt, 'utf8') <= 2048);
        assert.ok(prompt.isWellFormed());
        assert.match(root.textContent, /Laya priorizou/);
      } finally { controller.deactivate(); }
    }
  } finally { for (const name of names) { if (previous[name] === undefined) delete globalThis[name]; else globalThis[name] = previous[name]; } }
});

const globalNames = ['document', 'matchMedia', 'IntersectionObserver', 'localStorage'];
async function withCopilot(text, api, check) {
  const previous = Object.fromEntries(globalNames.map(name => [name, globalThis[name]]));
  const { doc, Element } = environment();
  Object.assign(globalThis, { document: doc, matchMedia: () => ({ matches: true, addEventListener() {} }),
    IntersectionObserver: class { observe() {} }, localStorage: { getItem: () => '{"motion":"off"}', setItem() {} } });
  const root = new Element('section'), draft = new Element('textarea'); draft.value = text; draft.focus();
  const controller = mountCopilot({ root, draft, api, getProjectId: () => 'p', getNotes: () => [], openSkills() {} });
  const click = label => root.querySelectorAll('button').find(button => button.textContent === label).fire('click');
  const part = name => root.children.find(child => child.className === name);
  const select = (start, end) => { draft.setSelectionRange(start, end); return draft.fire('select'); };
  try { await check({ doc, root, draft, click, part, select }); }
  finally { controller.deactivate(); for (const name of globalNames) { if (previous[name] === undefined) delete globalThis[name]; else globalThis[name] = previous[name]; } }
}
const catalogApi = (seen = {}) => async route => {
  if (route.startsWith('/api/skills?')) { seen.query = new URL(route, 'http://local').searchParams.get('q');
    return { snapshot_id: 's', coverage: { complete: true }, issues: [], total: 1, rows: [{ skill_id: 'a', name: 'Grafo', ring: 'installed', availability: 'installed', source_key: 'k' }] }; }
  return { state: seen.state || 'off', queued: 0 };
};

test('a selected span is never split by a multi-line scaffold and the preview is the full resulting draft', async () => {
  const text = 'Revisar o grafo de tarefas do OmniHarness';
  for (const flow of ['Clareza', 'Skills']) await withCopilot(text, catalogApi(), async ({ root, draft, click, select }) => {
    await select(10, 26);
    await click(flow); if (flow === 'Skills') await click('Citar no pedido');
    const preview = root.querySelectorAll('pre').find(pre => pre.className === 'cp-preview').textContent;
    await click('Aplicar no rascunho');
    assert.equal(draft.value, preview, `${flow}: preview must equal the applied draft`);
    assert.ok(draft.value.startsWith(`${text}\n\n`), draft.value);
    assert.match(draft.value, /Trecho em foco: grafo de tarefas/);
  });
});

test('guided acceptance A3 expects the appended block the Copilot actually writes', () => {
  const guide = readFileSync(new URL('../../docs/omniforge/GUIDED-ACCEPTANCE.md', import.meta.url), 'utf8');
  const a3 = guide.split('\n').find(line => line.startsWith('3. Select only `grafo de tarefas`'));
  assert.match(a3, /Trecho em foco/);
  assert.doesNotMatch(a3, /only the selected span changes|identifies the original span|duplicate phrase/);
});

test('a whitespace-only selection is ignored: scope stays on the whole draft and no blank query is sent', async () => {
  const seen = {};
  await withCopilot('abc   def', catalogApi(seen), async ({ click, part, select }) => {
    await select(3, 6);
    assert.match(part('microcopy').textContent, /pedido inteiro/);
    await click('Skills');
    assert.equal(seen.query, 'abc   def');
  });
});

test('Laya status is read from the server at mount and again when the window becomes visible', async () => {
  const seen = { state: 'ready' }, settle = () => new Promise(setImmediate);
  await withCopilot('abc', catalogApi(seen), async ({ doc, root }) => {
    await settle(); assert.match(root.textContent, /Laya pronto/);
    seen.state = 'off'; for (const fn of doc.events.visibilitychange) fn();
    await settle(); assert.match(root.textContent, /Laya descarregado/);
  });
});

test('Escape in the composer closes a suggestion or follow-up and keeps focus in the draft', async () => {
  await withCopilot('abc', catalogApi(), async ({ doc, draft, click, part }) => {
    let prevented = 0; const escape = () => draft.fire('keydown', { key: 'Escape', preventDefault() { prevented++; } });
    await click('Skills'); assert.equal(part('cp-panel').hidden, false);
    await escape(); assert.equal(part('cp-panel').hidden, true);
    await click('Clareza'); await click('Dispensar'); assert.equal(part('cp-followup').hidden, false);
    await escape(); assert.equal(part('cp-followup').hidden, true);
    assert.equal(prevented, 2); assert.equal(doc.activeElement, draft);
  });
});

test('undo clears a selection made on the applied text so the scope label stays truthful', async () => {
  await withCopilot('abc', catalogApi(), async ({ draft, click, part, select }) => {
    await click('Clareza'); await click('Aplicar no rascunho');
    await select(0, 3); assert.match(part('microcopy').textContent, /Trecho selecionado/);
    await click('Desfazer última aplicação');
    assert.equal(draft.value, 'abc');
    assert.match(part('microcopy').textContent, /pedido inteiro/);
  });
});
