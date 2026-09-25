# Resume here: full OmniForge MVP

Updated September 25, 2026. **Arsenal UI merged; isolated guided demo in progress; complete MVP still active.** The owner asked to continue normally while retaining an interruption-ready handoff near the weekly credit limit. The latest read-only account query observed **11% weekly allowance remaining** (earlier 25%/14%/12%); this is account-wide, not task attribution. No reset was redeemed or credit purchased. The owner may continue with Claude using this file and the current checkpoint; that does not reduce the MVP scope.

## Start here

1. Read this file, root AGENTS.md and [T13 handoff](../t13/TICKET-HANDOFF-CLAUDE.md); inspect actual Git status/log before editing.
2. Reviewed workspace implementation: **`9e2282e412fe418e551aeb89b56ed7faeed58304`**; [PR #6](https://github.com/ymauhn/omniharness/pull/6) **merged** as `4f4fb0362dadbfdd7c78f6001a36e36a685ed4a0`. Arsenal source **`43f95690c157733a424aab75f6b39e7a3aa1c8e1`** and docs anchor `c091a509dd9947f4de5efb9b310d46b6a197cc48` were integrated through [PR #7](https://github.com/ymauhn/omniharness/pull/7), **merged** as `ed8923646c3e13b1f00b2edbad4a094c0d0b468a`. Current root branch `codex/mvp-guided-demo` started clean from that merge. Inspect actual status for the in-progress [demo checkpoint](DEMO-CHECKPOINT.md).
3. **Root is the source of truth.** Worktree `_intake/mvp-terminal-grid` lacks the final memory/Workflows index wiring; `_intake/mvp-workflows` lacks several root repairs. Do not copy either over root. Preserve worktrees, old backups and stash `8105be6`.
4. PRs #6 and #7 were merged after exact-head review. Continue the scoped `codex/mvp-guided-demo` branch and its [guided acceptance](GUIDED-ACCEPTANCE.md), respecting in-flight file ownership in the [demo checkpoint](DEMO-CHECKPOINT.md). No force push, unrelated PR #2 changes or deployment.

## Delivered and verified

- Earlier merged [PR #3](https://github.com/ymauhn/omniharness/pull/3), [PR #4](https://github.com/ymauhn/omniharness/pull/4) and [PR #5](https://github.com/ymauhn/omniharness/pull/5): complete installed-skill discovery/search backend and connected catalog; scoped versioned memory; modern/pixel mascot with pause/selected-text Copilot; typed Laya/JEV adapters; installed local resident Laya with explicit load/unload; five original agent profiles, versioned arsenal and installed Agent Forge.
- Current source: Workflows tab with five original suggestions, saved per-project revisions/DAGs, copy/insert into composer, explicit atomic ancestor-task creation and task-version snapshots. No automatic model dispatch or task-success claim.
- Current source: one to eight terminal panes, adjustable columns/rows, independent per-window/project layouts, another same-origin window, bounded Unicode-safe replay shared with SSE, stale-epoch protection and visible output loss. Closing a pane keeps its shell.
- Current source: connected memory edit/history/archive controls, session/archive filters, optimistic write conflicts, retained drafts, paginated history and async scope/focus guards.
- Final `scripts/check.ps1`: **282/282 Python (89.655 s), 130/130 Lab (18.421 s), 7/7 mascot (0.058 s), zero skips**. Existing portal visual methods, other Node scenarios and eval selftest passed. Aggregate exit **1 solely for the two owner-preserved Claude ask/deny differences**; 27/29 installation rows conform. Separate graph check: 546 nodes, 100 edges, 5 proposals, 0 errors.
- Full log: `%TEMP%/omniharness-mvp-workspace-final-20260925.log`. [Validation](../t13/VALIDATION.md) and [checkpoint record](WORKSPACE-FLOWS-CHECKPOINT.md) retain failed attempts, review identities, repair cycles, hashes and limitations. All final component reviews and both root wiring reviews passed. No source changed after the full suite; documentation changes do not imply a new runtime pass.

## Current slice and next executable action

**Project-bound Arsenal is implemented, reviewed, source-validated and merged in PR #7.** It reuses `harness/agent_arsenal.py` and the Agent Forge skill. The authenticated panel exposes five built-ins, draft/review/activation/disable/rollback, selected session-note derivation and task pins. Pins remain `runnable:false`; no managed executor admission follows. Its [checkpoint](ARSENAL-UI-CHECKPOINT.md) lists exact scope, focused/full results and review repairs. The new 283/146/7 zero-skip result applies to the merged source.

**Now complete the isolated OmniHarness demonstration project and guided local acceptance script** for mascot/skins/selected text, scoped memory, multiple terminal panes and Arsenal. The [demo checkpoint](DEMO-CHECKPOINT.md) freezes acceptance, starting SHA, active file ownership and immediate resume action. The [guided acceptance](GUIDED-ACCEPTANCE.md) has an unfilled evidence sheet; the owner plans Claude-assisted visual acceptance. Keep V-01 pending until actual observations arrive. Demo data remains separate from the owner's `.omniforge-lab`; no paid agent starts. After this slice, continue the [V1 release contract](V1-RELEASE-CONTRACT.md), with all-role native isolation and real usage accounting as the critical harness gate.

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
