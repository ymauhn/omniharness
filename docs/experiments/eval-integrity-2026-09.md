# E1: deterministic evaluation integrity

Date: 2026-09-20 (America/Sao_Paulo). Starting point: T1 commit `1a2289c` on `master`, after 41/41 Python tests, both visual tests included, and the complete Windows battery passed with zero skips.

The owner authorised implementation of the first evaluation slice before opening T13. E1 changes are separate from the committed T1 baseline. No model benchmark, paid agent run, GA pilot or push was performed.

## Delivered

- Record schema v2 separates execution validity, task approval and control discrimination. Positive controls pass; invalid executions have no task/control verdict and cannot set `pass=true`.
- Strict stream validation, persisted process failure precedence, missing/contradictory grader rejection, unique execution/assessment identities and exclusive record writes prevent the covered false-success and overwrite cases.
- Sanitised manifests and evidence hashes identify fixture, grader, runner/scorer, host, configuration and budget. Usage remains unknown when absent; aggregate subagent usage is not output usage.
- Comparison requires compatible provenance, preserves failures in reliability counts, limits efficiency to successful comparable delivery and returns nonzero for actionable failures. Insufficient/incomparable history is explicit.
- Frozen offline stream fixtures and boundary tests cover success, failed task, discriminating/converged controls, blank/missing/wrong-type answers, malformed/truncated transcripts, process failure, launch failure, timeout, budget error, missing process/grader/usage, grader contradictions, identity collisions and configuration drift.
- A derived audit preserves all eight original records and hashes. Live controls are refused until their user-home isolation is enforceable.

The exact field and exit contracts are in `../evals/RECORDS.md`; source evidence is `eval-history-2026-09.json`.

## Validation

Final `./scripts/check.ps1` exited 0: 55/55 Python tests passed in 50.374 s, zero skipped, including both visual tests. The nine Node scenarios/site checks, eval selftest, 19 installation checks and graph check (510 nodes, 92 edges, zero errors) passed. Fourteen new unittest methods include the 16 frozen stream scenarios and their additional adversarial matrices. Tests were observed red at the new contract boundaries before the corresponding implementation. The final review added rejection of contradictory imported success records (nonzero/boolean exit status or attached failure reasons), then reran the complete battery.

Existing graph-scanner/test file-handle ResourceWarnings remain visible and tracked as a T3 follow-up. The runner explicitly retains unittest's warning visibility while enforcing zero skips. Expected rejection text from adversarial fixtures is not a suite failure. `git diff --check` passed, and all eight original record hashes were verified against the derived audit after implementation.

## Historical findings

| Legacy record | E1 finding |
|---|---|
| Gauntlet interactive, 20260910T133150 | Unverified execution; 9,293 is reported aggregate usage, not output tokens. |
| HITL harness, 20260910T133456 | Stream usage available; original process/budget/configuration provenance insufficient. |
| Gauntlet seeded, 20260910T133457 | Unverified execution; 3,187 is reported aggregate usage. |
| HITL control, 20260910T133457 | Invalid result despite recorded exit 0 and old `pass=true`. |
| Detour harness, 20260911T000603 | Invalid execution/result; old failure retained. |
| Detour control, 20260911T000654 | Invalid execution/result despite old `pass=true`. |
| Detour harness, 20260911T000821 | Current structural rubric passes conditionally; original provenance still unverified. |
| Detour control, 20260911T000944 | Invalid execution/result despite old `pass=true`. |

Totals: 4 invalid, 4 unverified, 0 certified comparable baselines. Neither the first attempts nor the reruns were discarded. The new comparator labels the legacy groups incomparable instead of asserting efficiency regressions between different budgets.

## Next: T13 opening

1. Start S1 with the interactive session menu and a stdlib envelope: Balanced default, US$2 default budget, warning at 80%, explicit scope/hosts/installs/expiry, allow/ask/deny with reasons and hard stops. Missing usage must not silently imply budget remaining. Dollar and token budgets are separate quantities.
2. Add S2's explicit needs/cost/alternatives and deterministic rerouting fixtures; use the E1 provenance/outcome contract for fallback records.
3. Implement S3's worktree/scope isolation, integrator and reviewer through offline fixtures first. Before a live control or B8/B9 run, verify host isolation, include losing/failed attempts and account for actual usage. Worktree isolation alone does not isolate the user home.

E2's weighted task graphs and human-calibrated refuters remain a separate slice; no GA fitness claim follows from structural graders alone. T13 is not implemented by this change.
