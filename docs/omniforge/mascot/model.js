/* Local-only draft model; shared by the browser prototype and Node checks. */
(function (root) {
  function boundary(text, index) {
    if (!Number.isInteger(index) || index < 0 || index > text.length) return false;
    return !(index > 0 && /[\uD800-\uDBFF]/.test(text[index - 1]) && /[\uDC00-\uDFFF]/.test(text[index] || ''));
  }
  function proposal(draft, start, end, replacement, projectId = 'omniharness', revision = 0) {
    if (typeof draft !== 'string' || typeof replacement !== 'string' || !boundary(draft, start) || !boundary(draft, end) || start > end) throw new Error('Invalid selection');
    return Object.freeze({ draft, start, end, replacement, projectId, revision });
  }
  function apply(currentDraft, item, projectId = 'omniharness', revision = 0) {
    if (!item || currentDraft !== item.draft || projectId !== item.projectId || revision !== item.revision) return { ok: false, text: currentDraft, reason: 'stale' };
    const text = currentDraft.slice(0, item.start) + item.replacement + currentDraft.slice(item.end);
    return { ok: true, text, receipt: { before: currentDraft, after: text, projectId, revision: revision + 1 } };
  }
  function undo(currentDraft, receipt, projectId, revision) {
    if (!receipt || currentDraft !== receipt.after || projectId !== receipt.projectId || revision !== receipt.revision) return { ok: false, text: currentDraft, reason: 'stale' };
    return { ok: true, text: receipt.before };
  }
  function canSuggest({ mode, visible, focused, selected, now, cooldownUntil, revision, lastSuggestedRevision, pending }) {
    return mode !== 'off' && visible && focused && !selected && !pending && now >= cooldownUntil && revision !== lastSuggestedRevision;
  }
  function dismissFollowup(revision, lastFollowupRevision) {
    return { ask: revision !== lastFollowupRevision, lastFollowupRevision: revision };
  }
  function canAnimate({ state, visible, reduced }) {
    return state !== 'muted' && visible && !reduced;
  }
  const api = { proposal, apply, undo, canSuggest, dismissFollowup, canAnimate };
  if (typeof module !== 'undefined') module.exports = api;
  else root.MascotDraft = api;
})(globalThis);
