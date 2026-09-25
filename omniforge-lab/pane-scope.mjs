export const MAX_PANES = 8;

export function sessionsForProject(sessions, projectId) {
  return sessions.filter(session => session.projectId === projectId);
}

export function reconcilePaneSessions(sessions, projectId, panes) {
  if (!Array.isArray(panes) || panes.length < 1 || panes.length > MAX_PANES) throw new Error('Between one and eight pane identities are required');
  const eligible = sessionsForProject(sessions, projectId);
  const allowed = new Set(eligible.map(session => session.id));
  const seen = new Set();
  const next = panes.map(id => {
    if (!allowed.has(id) || seen.has(id)) return null;
    seen.add(id);
    return id;
  });
  for (let index = 0; index < next.length; index++) {
    if (!next[index]) next[index] = eligible.find(session => !next.includes(session.id))?.id || null;
  }
  return next;
}

export function selectPaneSession(sessions, projectId, panes, index, id) {
  if (!Number.isInteger(index) || index < 0 || index >= panes.length) throw new Error('Invalid pane');
  if (id && !sessionsForProject(sessions, projectId).some(session => session.id === id)) {
    throw new Error('Session belongs to another project');
  }
  const next = [...panes];
  const previous = next[index];
  const other = next.findIndex((value, position) => position !== index && value === id);
  if (id && other >= 0) next[other] = previous && previous !== id ? previous : null;
  next[index] = id || null;
  return reconcilePaneSessions(sessions, projectId, next);
}
