# OmniForge — paused, direction change (2026-09-26)

**Status: PAUSED by the owner.** The Claude V1 audit round stops here. The next step is a brainstorm with the owner, not implementation. Do not resume the old V1 contract sequence from this file.

## New direction (owner, 2026-09-26)

- Ship a useful OS **today or tomorrow**: engine on (real agent sessions), minimally competitive with the market. The owner validates with users; no external-user gate.
- **Clean, practical code is a top criterion.** Refactor before adding.
- **Reuse, don't rebuild.** Most of the OS already exists in open-source orchestrators; copy, fork or reverse-engineer and keep light differentiators (the mascot, evidence/proof, Gauntlet).
- **No harness that raises token cost.** Review/verification runs only where it pays.
- Agreed with the Claude feedback points 1–6 (single wedge, engine on, refactor, lean docs, a small honest benchmark, measure the method's own cost). Point 7 (external users first) is rejected.
- Before any new plan: brainstorm with the owner and present the competitor/link research.

## State to resume from

Branch `claude/v1-audit-2026-09-26` (pushed, **not merged**; `master` untouched at `ab857f7`). Merging `site/public/**` to `master` deploys GitHub Pages; the owner authorised publishing the landing only after review.

Delivered on the branch, each with tests and independent review unless noted:

| Area | Commits / branches |
|---|---|
| Windows terminals without PowerShell 7; node-pty 1.2.0-beta.15 (fixes the owner's C++ assert dialog); PID-reuse guard | `f6e2d68` |
| Auth token no longer an ambient cookie; Host check; SSE burst eviction | `6975d9e` |
| Playwright E2E suite (15 flows, real Chromium) | `81d9a13`, `4986233` |
| Generated asset-link mini-tool + fail-closed runner; Windows Credential Manager keys; four usage figures + Codex quota read | `dc21a87`, `7e41589`, `53726f5`, `4986233` |
| Pillar 2 task owner/replan/handoff; Uso e chaves view | `4986233` |
| Audit fixes: Copilot, workflows, arsenal, E2 evaluator, core, frontend | `claude/fix-*` merges up to `c80d465` |
| Pillar 1 real task: offline host callback/ledger facade (managed admission stays closed) | `claude/t13-host-facade` merge |
| Installer (pack/install/update/rollback/repair/uninstall), pillar 3 NIST Longley, pillar 4 library/challenge, pillar 5 truthful landing + Issue Form | merges `160444b`, `1df55c4`, `75feaa7`, `d5fbe35` |
| Reconciliation fixes (cwd hijack, shims, U+2212, numpy bound, wording) | `10e9868` |

Audit record: [V1-AUDIT-2026-09-26](V1-AUDIT-2026-09-26.md) (278 requirements at baseline, defect dispositions).

## Validation at pause

- Integrated full `scripts/check.ps1` at `5c6fe89`: **361 Python OK, 0 skipped** (includes the 15 E2E); **Lab 213/213**; mascot 7/7; driver/site PASS; graph 546 nodes, 0 errors. Exit 1 only from the owner-preserved Claude `ask`/`deny` install rows.
- After that, `10e9868` was validated with focused suites only (Lab 233/233, installer 20/20, `test_checks` 10/10, Longley 9/9, site PASS). **A full run after `10e9868` has not happened.**
- The independent review of the coordinator's own commits (`f6e2d68`…`4986233`) **did complete** after the pause note was first written: 20 agents, every medium finding adversarially verified. Confirmed: (medium) unblocking one prerequisite reopened a dependent whose other prerequisite was still blocked; mini-tool report kept after a project switch; mini-tool and handoff controls lost focus, review tick and typed text on re-render; (low) key-vault store/remove race could orphan a secret, hash-then-reread race in the extension runner, rollback alternating between versions, the checkbox rule restyling range sliders, a failed quota read announced as success.
- Fixes for those findings were started in two isolated worktrees and **stopped at the owner's pause before any review**: local branches `claude/review-fix-backend` (`6b9956b`) and `claude/review-fix-frontend` (`c1fe1f7`), not pushed and not merged. Resume by reviewing both (two fresh reviewers each), repairing, then merging and running the full suite; workflow run `wf_778746ea-a11` can be resumed from its journal.
- Browser acceptance: A1 (both skins × three themes, visible focus) and B1 observed in Edge; the rest is covered by the E2E behaviour suite, which is not a visual verdict.

## Open items (unchanged by the pause)

Managed isolation/accounting (V-04, closed); clean Windows Sandbox install (V-05, feature not yet enabled); JEV live and Laya calibration (V-02/V-03); owner design verdict; landing publication.

## Triage for the owner (nothing deleted)

1. Stale `node --test` processes from 2026-09-25 (PIDs 31896, 26440 and children): pre-date this session; stop them if unwanted.
2. `%TEMP%\omniforge-demo-*` folders from demo runs: disposable synthetic data.
3. `~/.claude/workflows/swarm-driver.js.pre-omniharness-20260926`: backup taken when the installed driver was synced.
4. `.claude/worktrees/` under the repo: workflow isolation worktrees (now git-ignored).
