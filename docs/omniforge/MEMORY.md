# Scoped memory: versioned local notes

September 25, 2026. Implemented backend; edit/history/archive controls in the Lab UI remain to be connected. This is a local owner workspace, not separate-user access control or OS isolation.

Every note has an immutable global/project/session binding, source, revision, update time and retained history. Writes require the exact binding and `expectedRevision`; a stale concurrent update returns 409 without overwriting the winning change. Store writes are atomic and restore the last durable state on failure. The shared `memoryRevision` lets open sessions refresh their context after a mutation.

| Route | Behavior |
|---|---|
| `GET /api/memory?projectId=...&sessionId=...` | Current active versions visible to the explicit selection; `includeArchived=true` includes archived notes. |
| `POST /api/memory` | Create a sourced note in one scope. |
| `POST /api/memory/:id/update` | Exact `scope`, `projectId`, `sessionId`, `expectedRevision`, `source` and new `text`. |
| `POST /api/memory/:id/archive` | Same binding/revision/source; retain text/history but exclude the note from ordinary retrieval. `/forget` is an alias for archival, not secure erasure. No unarchive endpoint exists yet. |
| `GET /api/memory/:id/history?scope=...&projectId=...&sessionId=...` | History for the exact binding; omit unused IDs for global/project scopes. |
| `GET /api/context?sessionId=...&projectId=...` | Bounded current active context; optional project identity must match the session. |

The latest committed mutation takes precedence even when an old note is corrected, timestamps tie, or the system clock moves backwards. Legacy notes keep their original content/provenance/timestamps with revision 1; unknown historic mutation order is not invented. A monotonic mutation sequence applies from the next committed change. Context limits count serialized JavaScript characters and note count, **not model tokens**; truncation is explicit. State broadcasts omit note bodies. Explicit project IDs prevent accidental cross-project routing; the authenticated owner can deliberately select any of their projects.

Evidence: meaningful red cases for missing revisions and for the oldest of 31 same-timestamp notes corrected last. Repair cycle 1 fixes recency. Final writer suite: 34/34 Lab tests, zero skips. Independent reviewers `/root/codex_tool_bridge` and `/root/mvp_scope_audit` found no blockers; their focused checks passed 8/8 and 22/22. The second review retained an initial restricted-environment 21/22 result caused by the existing Unicode ConPTY cleanup problem before its normal-host rerun. Current integrated battery and source checkpoint belong in [T13 validation](../t13/VALIDATION.md).
