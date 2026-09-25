import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Excerpt, classifiedCandidates, mountClassifierControls } from '../copilot-provider.mjs';

test('local classifier excerpts honor byte limits without splitting Unicode', () => {
  const excerpt = utf8Excerpt('🤖'.repeat(600), 2048);
  assert.equal(Buffer.byteLength(excerpt), 2048);
  assert.equal(excerpt, '🤖'.repeat(512));
});

test('only a current in-catalog selected identity can reorder suggestions', () => {
  const rows = [{ skill_id: 'a', runnable: false }, { skill_id: 'b', runnable: false }];
  const selected = { source_id: 'b', provider: 'laya', reason: 'selected', runnable: false, snapshot_id: 's', projectId: 'p' };
  const result = classifiedCandidates(rows, selected, 's', 'p');
  assert.deepEqual(result.rows.map(row => row.skill_id), ['b', 'a']);
  assert.match(result.label, /Laya/);
  assert.deepEqual(rows.map(row => row.skill_id), ['a', 'b']);
  for (const changed of [{ snapshot_id: 'old' }, { projectId: 'other' }, { source_id: 'unknown' }, { runnable: true }, { provider: 'jev' }, { reason: 'none' }]) {
    const fallback = classifiedCandidates(rows, { ...selected, ...changed }, 's', 'p');
    assert.deepEqual(fallback.rows, rows);
    assert.match(fallback.label, /metadados/);
  }
  const abstained = classifiedCandidates(rows, { ...selected, source_id: null, reason: 'below_threshold' }, 's', 'p');
  assert.match(abstained.label, /confiança/);
});

test('finishing warm-up cannot override a newer provider preference or switched project', async () => {
  const previous = globalThis.document;
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; }
    append(child) { this.children.push(child); }
    setAttribute() {}
    addEventListener(name, fn) { this.events[name] = fn; }
  }
  try {
    globalThis.document = { createElement: tag => new Element(tag) };
    for (const change of ['preference', 'project', 'unchanged']) {
      const root = new Element('div'); let project = 'p', release, changes = 0;
      const pending = new Promise(resolve => { release = resolve; });
      const controls = mountClassifierControls({ root, api: () => pending, getProjectId: () => project, onChange: () => changes++ });
      controls.setMode('lexical');
      const completion = root.children[1].children[0].events.click();
      if (change === 'preference') controls.setMode('lexical');
      if (change === 'project') project = 'other';
      release({ state: 'ready', enabled: true, queued: 0 }); await completion;
      assert.equal(controls.mode(), change === 'unchanged' ? 'laya' : 'lexical');
      assert.equal(changes, change === 'unchanged' ? 1 : 0);
    }
  } finally { globalThis.document = previous; }
});
