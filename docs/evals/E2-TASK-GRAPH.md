# E2 task-graph scorer: offline reference slice

Date: 2026-09-25. This is a deterministic engineering-core fixture for the E2 direction in [PLAN](PLAN.md) and [ADR 0006](../adr/0006-evaluation-first-evolution.md). It is not a calibrated fitness function, a genetic search, a live model benchmark, or an E1 runner integration.

## Contract

`evals/task_graph.py` accepts an evaluator-owned `ReferenceGraph`, explicit `Policy`, execution `Attempt` records, a run interval and optional `RefuterCase` records. The trace may reference only frozen node IDs. The scorer rejects duplicate attempt IDs, unknown nodes, cycles, impossible intervals, overlapping active work by one agent, an accepted or verification evidence ID reused by another node, and unadjudicated claims of no progress. Each reference node must state a nonempty acceptance criterion and the graph must name an acceptance version. Its canonical SHA-256 covers that exact criterion text and version **as well as** topology and critical flags; a separate hash identifies the scoring policy. Changing either a criterion or its version changes the reference hash, even when node IDs and edges are unchanged. Neither hash may be silently changed during a comparison.

The fixed first fixture, `engineering-v1`, uses acceptance version `engineering-acceptance-v1` and has four requirements:

| Node | Depends on | Critical | Acceptance criterion | Example evidence |
| --- | --- | --- | --- | --- |
| `discover` | — | yes | Reproduce the target behavior with evidence. | Reproduced behavior |
| `implement` | `discover` | no | Deliver the bounded code change. | Changed code |
| `test` | `implement` | yes | Run and pass the relevant test for the changed behavior. | Passing test |
| `review` | `implement` | no | Review the delivered diff. | Review record |

The fixture's illustrative policy uses a raw floor of 1, a centrality bonus capped at 1, a 1/10 penalty per repeated adjudicated no-progress loop, and a total loop penalty capped at 1/2. For each node, raw weight is `floor + bonus_cap × distinct_descendants/(node_count−1)`; normalized weights sum to 1. Here the exact weights are `discover=6/17`, `implement=5/17`, `test=3/17`, and `review=3/17`. The bonus cannot exceed the floor, so centrality cannot erase leaf weight or dominate it without bound. These coefficients are **test parameters**, not owner-approved fitness coefficients.

An `accepted` attempt carries an evidence ID and can satisfy its one reference node. A retry of that node may reuse the ID; a different node may not. A node receives credit only from an accepted attempt that started at or after the credit time of every prerequisite, and its own credit time is the earliest `ended_ms` among such attempts (a root node's floor is the run start). An acceptance recorded before a prerequisite was credited therefore earns nothing until the node is accepted again afterward. Repeating an accepted attempt or splitting its work into more attempts does not increase that node's weight. An execution-supplied `implement.part2` node is rejected. A missing critical node fails the hard gate and leaves `provisional_quality=null` even when other nodes earned substantial weight. `quality_before_penalty` remains visible for diagnosis, not for bypassing the gate. `task_pass` requires every reference node to be credited. `run_valid=true` means the scorer's structural checks passed; E1 remains responsible for process and provenance validity.

The versioned criterion text is a stable identity for this offline fixture, not executable acceptance evidence. If an external E1 checker implements a criterion, its implementation or fixture digest must be pinned to this version before live comparisons. A changed checker without a version bump would leave the reference hash unchanged and invalidate the comparison.

`no_progress` requires an explicit loop key and adjudication ID. Adjudicated no-progress attempts are counted per node: the first on a node is free, and each later one on the same node adds a loop penalty whatever its loop key. Decision of 2026-09-26 (pillars DEF-06), proposed by the agent and subject to the same human review: the former per-`(node, loop_key)` count let the adjudicator's key granularity erase the penalty, so five no-progress attempts under five keys cost nothing. The loop key remains a required adjudication label for that review, not a penalty unit. Merely repeating a command without a no-progress adjudication, one no-progress attempt per node, or a justified `verification` adds no penalty. Verification needs its own evidence ID but earns no additional requirement weight. This rule needs human review of the no-progress labels before use on live traces.

Time is reported in four distinct milliseconds fields. `wall` is the explicit run interval. `active_execution` is the union of all agent-active intervals, counting concurrent work once. `summed_agent` sums those intervals, counting parallel agents separately. `human_wait` is the union of explicitly recorded waiting intervals; it may overlap another agent's work. Each attempt must explicitly supply its active and waiting intervals so absent telemetry is not silently turned into measured zero. In the positive fixture, two agents overlap: wall=30, active execution=28, summed agent=38, human wait=2.

Refuter labels remain unknown until human labels are supplied. With missing labels, confusion counts, precision and recall are `null`. A fully labeled offline fixture checks true positives, false positives, false negatives and true negatives, but `calibrated=false` and `fitness_calibrated=false` remain in the output. Planted test labels are a correctness check for arithmetic, not evidence of calibrated real-world refuters.

Run the bounded fixtures with:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m unittest tests.test_task_graph -v
```

## Remaining E2 work

Freeze versioned task graphs and acceptance evidence for the other four ADR 0006 pillars; connect the scorer to E1's immutable valid-run records without letting execution traces alter the reference; collect exact active/waiting intervals from both hosts; have humans adjudicate no-progress and planted refuter findings; then calibrate coefficients and assess stability on held-out cases. Only after those checks and the unresolved native containment/accounting work should the bounded evolutionary pilot compare fixed, random and genetic strategies under equal whole-search budgets.
