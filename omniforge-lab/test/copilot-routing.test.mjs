import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCopilot } from '../copilot.mjs';

// DOM controller seam only; this does not render or navigate a browser.
function environment() {
  const doc = { hidden: false, addEventListener() {} };
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
    async fire(name) { for (const fn of this.events[name] || []) await fn({ target: this }); }
    focus() { doc.activeElement = this; }
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
