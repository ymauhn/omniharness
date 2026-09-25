const test = require('node:test');
const assert = require('node:assert/strict');
const { proposal, apply, undo, canSuggest, dismissFollowup, canAnimate } = require('./model.js');

test('an edited draft rejects an old selected-span replacement without altering text', () => {
  const draft = 'Criar uma interface para meus projetos.';
  const item = proposal(draft, 10, 19, 'interface acessível');
  const edited = 'Por favor: ' + draft;
  const result = apply(edited, item);
  assert.equal(result.ok, false, 'Stale selection must never rewrite a changed draft');
  assert.equal(result.text, edited);
});

test('replacement targets only the selected duplicate phrase; undo restores the original', () => {
  const draft = 'UI nova. UI nova.';
  const item = proposal(draft, 9, 11, 'Interface', 'p1', 3);
  const result = apply(draft, item, 'p1', 3);
  assert.equal(result.text, 'UI nova. Interface nova.');
  assert.deepEqual(undo(result.text, result.receipt, 'p1', 4), { ok: true, text: draft });
  assert.equal(undo(result.text + ' edit', result.receipt, 'p1', 5).ok, false);
});

test('project switch and edit-then-restore both invalidate a proposal', () => {
  const draft = 'Investigar o bug';
  const item = proposal(draft, 0, 10, 'Reproduzir', 'p1', 1);
  assert.equal(apply(draft, item, 'p2', 1).ok, false);
  assert.equal(apply(draft, item, 'p1', 3).ok, false);
});

test('Unicode, multiline, partial words and surrogate boundaries preserve the chosen span', () => {
  const draft = '🤖 Revisão\ncontextual';
  assert.equal(apply(draft, proposal(draft, 3, 10, 'Ação')).text, '🤖 Ação\ncontextual');
  assert.equal(apply('refatorar', proposal('refatorar', 2, 7, 'model')).text, 'remodelar');
  assert.throws(() => proposal(draft, 1, 2, 'x'), /Invalid selection/);
  assert.throws(() => proposal(draft, 9, 2, 'x'), /Invalid selection/);
});

test('passive assistance respects Off, cooldown, selection, visibility and one suggestion per draft', () => {
  const ready = { mode: 'discreet', visible: true, focused: true, selected: false, pending: false, now: 100, cooldownUntil: 0, revision: 1, lastSuggestedRevision: 0 };
  assert.equal(canSuggest(ready), true);
  for (const change of [{ mode: 'off' }, { visible: false }, { focused: false }, { selected: true }, { pending: true }, { cooldownUntil: 200 }, { lastSuggestedRevision: 1 }]) assert.equal(canSuggest({ ...ready, ...change }), false);
});

test('dismissal asks once per unchanged draft and rearms after an edit', () => {
  const first = dismissFollowup(1, null);
  assert.equal(first.ask, true);
  const repeated = dismissFollowup(1, first.lastFollowupRevision);
  assert.equal(repeated.ask, false);
  const edited = dismissFollowup(2, repeated.lastFollowupRevision);
  assert.equal(edited.ask, true);
  assert.equal(dismissFollowup(2, edited.lastFollowupRevision).ask, false);
});

test('muted state never animates, including an explicit state transition', () => {
  assert.equal(canAnimate({ state: 'muted', visible: true, reduced: false }), false);
  assert.equal(canAnimate({ state: 'suggestion', visible: true, reduced: false }), true);
  assert.equal(canAnimate({ state: 'suggestion', visible: true, reduced: true }), false);
  assert.equal(canAnimate({ state: 'accepted', visible: false, reduced: false }), false);
});
