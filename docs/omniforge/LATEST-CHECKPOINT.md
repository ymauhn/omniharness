# Resume here: full OmniForge MVP

Updated September 25, 2026. **Active implementation, not a completed MVP.** The owner explicitly asked to continue normally as the weekly allowance approaches its limit and to keep an interruption-ready handoff. A read-only account query observed 75% weekly usage / 25% remaining at this checkpoint; this is account-wide, not attribution to this task. No reset credit was redeemed or purchase made.

## Git anchor and delivered work

- Repository: `C:/Users/Yeonatan/master_team`; remote `ymauhn/omniharness`.
- Current integration branch: `codex/mvp-workspace-flows`, base/HEAD `17230c093f933c8cd943216a80bc02eea4530079`. **Inspect actual Git status first**; source below is currently uncommitted and must not be overwritten by stale worktree copies.
- Last reviewed implementation commit: `fcef707743aa03d24448a28364b1659a037afe0f`; [PR #5](https://github.com/ymauhn/omniharness/pull/5) merged at the base above. Earlier [PR #3](https://github.com/ymauhn/omniharness/pull/3) and [PR #4](https://github.com/ymauhn/omniharness/pull/4) are merged.
- Delivered checkpoints: complete installed-skill discovery/search backend and connected catalog; scoped versioned memory backend; modern/pixel SVG mascot and pause/selection Copilot; typed Laya/JEV adapters, actually installed local Laya with explicit composer activation/unload; five original agent profiles, versioned arsenal and installed Agent Forge skill. These do not complete provider/vault, arsenal task UI or the whole MVP.
- Last complete integrated runner at that anchor: **282/282 Python, 69/69 Lab, 7/7 mascot**, zero skips. Aggregate exit 1 solely for two owner-preserved Claude `ask`/`deny` differences (27/29 install rows conform). Exact logs, hashes, independent reviews and real Laya limitations are in [T13 validation](../t13/VALIDATION.md). Local Laya HTTP lifecycle passed; positive prompt abstentions remain, so no calibrated quality claim.

## Current unfinished workspace checkpoint

Acceptance/reference hashes and writer ownership: [WORKSPACE-FLOWS-CHECKPOINT](WORKSPACE-FLOWS-CHECKPOINT.md).

| Work | Source of truth now | Evidence and next step |
|---|---|---|
| Replay output | Root `omniforge-lab/terminal-output.mjs`, server route/SSE and two tests | Bounded volatile buffers, epoch/cursors, exact scope/auth; 5 focused replay/API tests passed. First independent reviewer found no replay blocker. Second review pending. |
| Memory edit/history/archive | Root `memory-panel.mjs/.css`, two tests, core `noteHistoryPage`, server/test changes | Draft/conflict/project race controls implemented. Review repair 1 paginates history: initial red `46 !== 20`, then 9 memory/server checks passed. UI still needs index wiring and final reviews. |
| Saved Workflows | Root `workflows.mjs`, `workflow-panel.mjs/.css`, three workflow test files; original writer worktree is stale after root repairs | Original 16/16 tests; root repair 1 fixed old-project busy state and in-flight archive editing, then workflow+API tests 20/20. **Three findings below still require repair 2.** |
| Dynamic terminal UI | **Not yet copied to root:** `_intake/mvp-terminal-grid`, branch `codex/mvp-terminal-grid`, base `fcef707` | Six frozen files: index.html, pane-scope.mjs, terminal-grid.mjs/.css, test/terminal-grid.test.mjs and terminal-grid-controller.test.mjs. Final author full Lab 85/85, zero skips with normal host permissions; actual root-buffer/client replay compatibility passed. Independent review pending, then integrate the six files, add static routes and merge memory/Workflows UI wiring. |

Open Workflows findings from independent `/root/codex_tool_bridge` review, **do not lose these**:

1. Completing a task-create request for node A after selecting node B disables B's shared `taskButton`. Bind completion to its original selection/button or freeze selection.
2. Confirmed request IDs never retire, preventing deliberate new runs. Project switching clears uncertain IDs, allowing duplicate tasks after a lost response. Preserve uncertain identity across switches; retire only confirmed success and distinguish a new run from a retry. Add regressions.
3. Version verification hashes `validateWorkflow(storedDefinition)`, which trims strings. A stored prompt changed from `P` to ` P ` is accepted under the old digest. Check exact stored/canonical content integrity and retain a tamper regression.

Grid review 1 subsequently found two pending replay repairs: if a new epoch has the same last sequence as the old cursor, an empty replay can hide retained output; refetch from zero when the reset cursor still precedes `nextSequence - 1`. Client trimming at 120,000 characters must also mark truncation visibly. Both were reproduced against the actual root buffer, with 18 existing focused tests passing; passing those tests did not catch these cases. Writer scope is still the isolated grid worktree.

Root API workflow integration exists: constructor validates service and releases the workspace lock on failure; authenticated GET/POST routes; generic state excludes raw note/workflow history and supplies `workflowRevision`. **Index wiring remains:** mount the memory panel, add Workflows navigation/panel, refresh its library when this revision changes without overwriting drafts, and serve grid assets. Before overwriting index from the grid worktree verify root index is still unchanged.

## Precise resumption order

1. Read this file, `AGENTS.md`, [T13 handoff](../t13/TICKET-HANDOFF-CLAUDE.md), then current Git status/diff. Preserve all worktrees and unrelated work. Current dirty root is intentional.
2. Repair the three Workflows findings with red/green regressions; this is repair cycle 2 for that slice. Get independent rechecks before accepting it.
3. Collect grid review and second memory/replay review; integrate only the six frozen grid files, then wire the root modules. Original workflows worktree `_intake/mvp-workflows` is reference-only after root repairs; do not copy it again.
4. Run focused tests, two independent source reviews of final changed slices/integration, then the complete runner. Save exact pass/fail/skip counts and known host differences. Commit the reviewed scoped checkpoint, push a branch, create/attach/merge the exact reviewed PR head, and update this pointer with SHAs.
5. Continue full contract: arsenal task selection and chosen-session derivation, optional API-key vault/JEV controls and honest quota/usage UI, richer capability/help graphs, generated link-checker/repair workflow, Windows packaging/Goose comparison, five real pillar demonstrations and calibrated eval/evolution. Existing templates/backend fixtures alone do not pass those product scenarios.

## Validation and host facts that matter

- Python: `C:/Users/Yeonatan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe` (3.12.14). `scripts/check.ps1` selects the configured runtime. Node/npm and Playwright/Chromium are installed; installable missing dependencies are work, never skipped coverage.
- Latest interim root focused expansion: 28/29 passed, zero skips; only the known PowerShell Unicode PTY cleanup failed under restricted command permissions (PID 31504). This is **not** a green suite. Later 9/9 memory/server checks passed. Repeat the final complete runner using the already-authorized ordinary host escalation, as previous passing checkpoints did.
- Grid author first full run: missing local worktree `node-pty`; `npm ci` installed four lockfile dependencies. Restricted retry 83/84, one PTY cleanup failure (PID 36968). Normal-host final 85/85. Existing `AttachConsole failed` helper diagnostics remain visible despite passing cleanup assertions; no PTY implementation was changed.
- Read-only inspection after both restricted failures found neither PID 31504 nor 36968 still running. No broad process kill was issued.
- Current reviews: `/root/mvp_scope_audit` reviews terminal grid only (did not author it); `/root/mvp_accounting_review_a` reviews root memory/replay only (did not author them). `/root/codex_tool_bridge` provided first root review and first Workflows review; its findings above are pending recheck. Each source slice needs two independent final reviews; the writer does not count.
- Browser navigation remains denied by platform review despite owner consent. Do not retry via another backend/CDP/Playwright. Node DOM fixtures and HTTP tests are functional seams, **not visual evidence**. V-01 in [VALIDATION-PENDING](VALIDATION-PENDING.md) tracks final visuals, keyboard and multi-monitor acceptance.
- Native managed-agent admission remains closed: all-role tool confinement, orphan-descendant cancellation and whole-tree usage are not certified. Interactive PTYs and native approved collaboration remain usable; do not label them contained managed swarms.
- Preserve current user Claude permission customizations; never run blanket `install.py --adopt` to force a green check. Keep unknown provider/delegate tokens and dollars unknown. Do not use account-wide quota deltas as per-task billing.
- Owner permits scoped commits/pushes/PRs/merges and ordinary implementation/research/dependencies without repeated questions. New paid-provider charges, private uploads and production deployment retain their separate boundaries. JEV account/credit tests may wait; its functional configurable adapter/UI remains required. Payments remain deferred.

Every continuation updates this file and the T13 journal with changed paths, tests, unresolved findings, source/commit identities and the next executable step. Keep the full objective in [V1-RELEASE-CONTRACT](V1-RELEASE-CONTRACT.md); do not silently shrink it to the last checkpoint.
