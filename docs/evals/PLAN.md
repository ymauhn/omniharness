# Eval integrity: first slice after local T1

Date: 2026-09-20. E1 implementation authorised by the owner after the T1 commit. No paid runs are part of this slice.

## Goal and success criterion

Make an evaluation record suitable for comparison: it must distinguish an invalid execution, a failed task, a successful task and a discriminating control. A frozen offline fixture set must reject empty/error runs and incomparable baselines while accepting legitimate successful outputs. The complete local battery must remain green with no skipped tests; install missing local test dependencies before continuing.

## Where we are

2026-09-25 continuation: the shared-receipt reconciliation is implemented in record schema v3. Evals and the ledger now use the same whole-tree parser; comparability requires source/session binding and fresh-invocation evidence. Stale streams and contradictory derived metrics are rejected. See [RECORDS](RECORDS.md) and [current validation](../t13/VALIDATION.md). All 100 Python tests passed with zero skips; the overall host check retains two owner-accepted permission-policy differences. Native Claude/Codex execution/recovery and all-role containment remain open before live controls/B8/B9. No model benchmark or evolutionary pilot ran.

T1 is committed as `1a2289c`, including required visual dependencies and its 41/41 Python tests with no skips. E1's record contract, comparator and offline fixtures are implemented in the later E1/T13 checkpoint `8e6c20e`; see `RECORDS.md` and `../experiments/eval-integrity-2026-09.md`. T13 local S1/S2/S4 and S3 primitives are implemented, with native executor/usage integration and live controls still open. The complete September 21 battery passed 92/92 Python tests without skips. E2 remains future work. The [September 22 integration proposal](../research/harness-evolution-2026-09/PLAN.md) adds a concrete next seam: reconcile this runner's main-loop telemetry with whole-tree provider receipts before B8/B9, and demonstrate Claude and Codex separately against the same acceptance corpus.

## E1: comparable and auditable records

1. **Record contract, TDD at the runner/CLI boundary.** Introduce a versioned record with separate `run_valid`, `task_pass` and `control_discriminative` outcomes; a control's structural difference is never quality success. Give each run a unique identity, explicit failure reason and immutable linkage to source evidence. Preserve raw records; migrations create derived records with provenance.
2. **Minimal provenance and accounting.** Record case/fixture and grader versions or hashes, host, model when reported, relevant configuration and budget, actual process exit, timing and raw usage categories. Keep unavailable input/output/cache/cost values null and mark coverage. Do not relabel aggregate subagent usage as output tokens. Store a reproducible, sanitised manifest rather than depending on this machine's ignored files.
3. **Historical comparison.** Compare only compatible configurations under a documented policy. A quality drop compares valid executions; an invalid run is a separate failure. Cost efficiency comparisons use successful, comparable deliveries. Never remove failures from the reliability denominator. Emit a nonzero CLI status for an actionable regression; insufficient or incomparable history has an explicit outcome. Preserve both historical Detour attempts and their invalidity findings.
4. **Offline adversarial fixtures and migration rehearsal.** Exercise valid harness/control pairs, empty/whitespace/missing answers, truncated streams, budget/error/timeout exits, missing process provenance, missing graders, missing usage, changed model/budget/grader and record-identity collisions. Keep positive controls so a blanket rejection cannot pass the suite. Re-evaluate the eight local records into a report without editing their originals; insufficient provenance stays unknown. No live control arm may touch the real user home in a future paid experiment.

Acceptance: every invalid fixture is rejected for the expected reason; known valid deliveries remain valid; changing only model, budget or grader prevents an unqualified comparison; unknown usage never becomes measured zero; history is preserved; local tests pass. Exit states and schema examples will be reviewed before paid measurements.

## E2: task graph and calibrated quality, after E1

Use small fixed task graphs representing the engineering core first, then the other four pillars from ADR 0006. Freeze their reference topology before execution. Record attempts separately so adding branches or retry nodes cannot increase earned task weight.

Normalise weights with a positive floor, bound the influence of centrality and encode critical requirements as hard constraints. Separate wall-clock, active execution, summed agent time and human waiting. Define progress through accepted evidence or delivered requirements; repeated calls alone are not proof of an unproductive loop. Evaluate refuters on planted true/false findings and human adjudication, including disagreements and false negatives.

Acceptance fixtures must show: a critical failure cannot be offset by other successes; artificial task splitting does not inflate quality; a no-progress repetition earns no new credit; a justified verification step is not misclassified as waste; parallel execution does not conflate wall-clock with summed duration. Coefficients remain proposals until these checks and human review establish them.

## Later: bounded evolutionary pilot

Only after E1/E2 and operational isolation/envelope support. Mutate Gauntlet agent/lens selection, effort allocation per node and fallback strategies, as approved. Compare fixed configuration, random search and genetic search with equal total budgets, repeated trials and held-out cases. Report the full search cost and unsuccessful candidates. Human review decides promotion; the fitness function and guardrails cannot mutate. No population size, generation count, budget or claimed gain is assumed here.
