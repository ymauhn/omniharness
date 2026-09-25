# Resume here: full OmniForge MVP

Updated September 25, 2026. **Workspace checkpoint validated; complete MVP still active.** The owner asked to continue normally while retaining an interruption-ready handoff near the weekly credit limit. A read-only account query observed 25% weekly allowance remaining at the earlier checkpoint; that is account-wide, not task attribution. No reset was redeemed or credit purchased.

## Start here

1. Read this file, root AGENTS.md and [T13 handoff](../t13/TICKET-HANDOFF-CLAUDE.md); inspect actual Git status/log before editing.
2. Reviewed implementation: **`9e2282e412fe418e551aeb89b56ed7faeed58304`**, pushed on `codex/mvp-workspace-flows`; [PR #6](https://github.com/ymauhn/omniharness/pull/6) records integration into master. Its runtime base is `17230c093f933c8cd943216a80bc02eea4530079` (PR #5). Earlier documentation backup `9e7a8b74e530d16e5ef673ee8c5964817d841d76` is also pushed. Subsequent checkpoint-identity edits are documentation only; inspect Git/PR for the current merge commit.
3. **Root is the source of truth.** Worktree `_intake/mvp-terminal-grid` lacks the final memory/Workflows index wiring; `_intake/mvp-workflows` lacks several root repairs. Do not copy either over root. Preserve worktrees, old backups and stash `8105be6`.
4. Confirm PR #6's state: if already merged, start the next scoped branch from the integrated master; if interrupted before merge, finish the exact-head merge after confirming only the reviewed runtime and documentation are included. At PR creation GitHub reported CLEAN/MERGEABLE with no configured status checks; local test evidence above is the validation. No force push, unrelated PR #2 changes or deployment.

## Delivered and verified

- Earlier merged [PR #3](https://github.com/ymauhn/omniharness/pull/3), [PR #4](https://github.com/ymauhn/omniharness/pull/4) and [PR #5](https://github.com/ymauhn/omniharness/pull/5): complete installed-skill discovery/search backend and connected catalog; scoped versioned memory; modern/pixel mascot with pause/selected-text Copilot; typed Laya/JEV adapters; installed local resident Laya with explicit load/unload; five original agent profiles, versioned arsenal and installed Agent Forge.
- Current source: Workflows tab with five original suggestions, saved per-project revisions/DAGs, copy/insert into composer, explicit atomic ancestor-task creation and task-version snapshots. No automatic model dispatch or task-success claim.
- Current source: one to eight terminal panes, adjustable columns/rows, independent per-window/project layouts, another same-origin window, bounded Unicode-safe replay shared with SSE, stale-epoch protection and visible output loss. Closing a pane keeps its shell.
- Current source: connected memory edit/history/archive controls, session/archive filters, optimistic write conflicts, retained drafts, paginated history and async scope/focus guards.
- Final `scripts/check.ps1`: **282/282 Python (89.655 s), 130/130 Lab (18.421 s), 7/7 mascot (0.058 s), zero skips**. Existing portal visual methods, other Node scenarios and eval selftest passed. Aggregate exit **1 solely for the two owner-preserved Claude ask/deny differences**; 27/29 installation rows conform. Separate graph check: 546 nodes, 100 edges, 5 proposals, 0 errors.
- Full log: `%TEMP%/omniharness-mvp-workspace-final-20260925.log`. [Validation](../t13/VALIDATION.md) and [checkpoint record](WORKSPACE-FLOWS-CHECKPOINT.md) retain failed attempts, review identities, repair cycles, hashes and limitations. All final component reviews and both root wiring reviews passed. No source changed after the full suite; documentation changes do not imply a new runtime pass.

## Exact next implementation slice

**Connect the existing arsenal to the Lab and selected task identity.** Reuse `harness/agent_arsenal.py`, `harness/agent_profiles.json`, [AGENT-ARSENAL](AGENT-ARSENAL.md) and the Agent Forge skill; do not build a second registry.

- Add authenticated bounded API/UI to inspect built-in and saved profiles, review/activate versions, disable/rollback, and deliberately pin a reviewed profile to a chosen project task.
- A task pin is context, not executor admission. Keep native managed execution unavailable until V-04 passes.
- Derivation accepts explicitly selected, sanitized session excerpts and cites them. Do not discover/export private chats automatically. The owner-selected real derivation remains a later human acceptance step if no material is selected.
- Freeze observable acceptance, leave meaningful tests, obtain independent reviews and update this checkpoint before proceeding.

Then retain the full [release contract](V1-RELEASE-CONTRACT.md): optional OS-vault API keys/JEV controls and truthful quota/usage UI; capability graph hover/focus help; generated asset-link checker and requested repair workflow; real Claude/Codex integration with complete accounting and verified cancellation/isolation; Windows packaging and Goose comparison; five real pillar demonstrations and calibrated graph-weighted eval/evolution. Templates, metadata and mocks do not close these requirements. Payments remain deferred.

## Limits a continuation must preserve

- Python runtime: `C:/Users/Yeonatan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe` (3.12.14); check.ps1 selects it. Node/npm, Playwright/Chromium and test dependencies are installed. Never skip installable coverage.
- Preserve user Claude permission customizations. Do not run blanket installer `--adopt` merely to force all installation rows green.
- Earlier restricted PTY cleanup attempts failed (root PID 31504; grid PID 36968), then read-only inspection found neither still running. Final normal-host suite passes. Existing `AttachConsole failed` helper stderr remains visible.
- Browser navigation is platform-denied despite owner consent. Do not retry through another backend/CDP/Playwright. DOM seams and HTTP tests are not visual evidence. V-01 retains keyboard, themes, multi-monitor, motion and performance checks.
- Managed-agent admission stays closed: all-role tool confinement, orphan-descendant cancellation and complete whole-tree usage are unverified. Interactive PTYs/native collaboration remain usable; do not call them contained managed swarms.
- Local Laya lifecycle passed, but positive technical prompts abstained. Quality and warm-up accounting remain uncalibrated/incomplete. JEV offline adapter tests pass; account/key/credit live tests wait in V-02.
- Uncertain workflow request IDs survive project switches in the current page, not reload. Inspect saved task snapshots after a lost response/reload before deliberately starting another run. No automatic retry or dispatch.
- History replies are paginated; the complete note-list endpoint and durable note history still grow with use. Terminal replay is volatile recent text, not durable/full-screen recovery.
- Native delegate usage/cost is unavailable, not zero. Account quota changes are not task receipts. New paid-provider charges, private uploads and production deployment need their applicable authority; scoped repo commits/pushes/PRs/merges and routine work are already authorized.

Every continuation updates this pointer and the T13 journal with actual commits, changed paths, test results, unresolved findings and the next executable step. Keep [VALIDATION-PENDING](VALIDATION-PENDING.md) current; never silently shrink the MVP to the last completed slice.
