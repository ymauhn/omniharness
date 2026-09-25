import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionsForProject, reconcilePaneSessions, selectPaneSession } from '../pane-scope.mjs';

const sessions = [
  { id: 'a1', projectId: 'a' },
  { id: 'a2', projectId: 'a' },
  { id: 'b1', projectId: 'b' },
];

test('pane choices and restored identities stay within the selected project', () => {
  assert.deepEqual(sessionsForProject(sessions, 'a').map(session => session.id), ['a1', 'a2']);
  assert.deepEqual(reconcilePaneSessions(sessions, 'a', ['b1', 'a1']), ['a2', 'a1']);
  assert.deepEqual(reconcilePaneSessions(sessions, 'b', ['a1', 'a2']), ['b1', null]);
});

test('cross-project pane assignment is rejected without mutating the layout', () => {
  const panes = ['a1', 'a2'];
  assert.throws(() => selectPaneSession(sessions, 'a', panes, 0, 'b1'), /another project/);
  assert.deepEqual(panes, ['a1', 'a2']);
  assert.deepEqual(selectPaneSession(sessions, 'a', panes, 0, 'a2'), ['a2', 'a1']);
});
