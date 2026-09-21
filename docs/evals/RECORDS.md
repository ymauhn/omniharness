# Evaluation record contract v2

Implemented in E1, 2026-09-20. Offline tests use frozen synthetic inputs in `tests/fixtures/evals/streams.json`; they never call a model. This contract certifies execution and the existing deterministic task rubric, not semantic quality or a calibrated evolutionary fitness function.

## Outcomes and CLI status

| Field | Meaning |
|---|---|
| `run_valid` | Known integer process exit 0, complete successful result with nonempty final text, readable stream and usable, consistent grader. Launch failures, timeouts, corrupt streams and grader errors invalidate the assessment. |
| `task_pass` | The same harness task rubric applied to either arm. Boolean for a valid assessment; null for an invalid assessment. |
| `control_discriminative` | The case's separate control-contrast rubric, only for a valid control assessment. Null otherwise. |
| `pass` | Compatibility alias: exactly `run_valid is true and task_pass is true`. Never a control-contrast result. |
| `execution_failures` | Process, stream or evaluator failures. Task reasons remain in `failures`; contrast reasons are in `control_failures`. |

Examples (outcome fields only):

```json
[
  {"run_valid": true, "task_pass": true, "control_discriminative": null, "pass": true},
  {"run_valid": true, "task_pass": false, "control_discriminative": true, "pass": false},
  {"run_valid": true, "task_pass": true, "control_discriminative": false, "pass": true},
  {"run_valid": false, "task_pass": null, "control_discriminative": null, "pass": false}
]
```

The second example is a discriminating control that failed the task. The third is a successful control task that converged with the harness; it cannot establish a harness advantage. The existing case graders retain their arm-specific interface. The runner always obtains task quality through the shared harness rubric, and evaluates the control criterion separately.

`run` and `rescore` return 0 only for task success, 1 for rejection or invalid execution. A discriminating but failing control therefore returns 1. `record` preserves an interactive import and its conditional grader observation, but returns 1 because an arbitrary driver JSON plus a checkpoint tag does not establish execution provenance. `audit-history` returns 0 when a derived report was written, independent of historical quality. Parse/IO errors return nonzero.

`regress` returns 1 for `REGRESSION`, `INVALID_RUN` or `INVALID_RECORD`. Exit 0 means no actionable alert, not proof of quality: `INSUFFICIENT` and `INCOMPARABLE` are printed explicitly. Invalid CLI syntax returns 2 through argparse.

## Evidence, identity and measurements

Every record has `schema_version: 2`, a unique `record_id`, an execution `run_id` and a UTC assessment timestamp. New workspaces also have unique names. Exclusive file creation prevents overwrite even if an identity collides. A rescore preserves the original execution identity and start time, writes a new assessment, and does not become a new reliability sample or a more recent execution.

Before a live run, `_manifest.json` records case/arm, start time, per-file fixture hashes, grader/runner/harness hashes, OS/architecture/Python host information, budget, timeout and an allowlist of relevant configuration. It does not dump the environment, credentials or user-home configuration. `_process.json` stores actual exit status, runner failures and measured wall time. Persisted process failures cannot be overridden by a caller; a rescore cannot replace the original manifest's case, arm or budget.

Each assessment embeds the manifest, actual scorer/grader hashes and SHA-256 linkage to workspace evidence, including stream/process/manifest files. These fingerprints identify evidence; they are not signed attestations of an untrusted host. Model and agent version are taken from the stream's init event when reported, otherwise null. The run's runner hash and the assessment's scorer hash are distinct, so changing the scoring engine also prevents an unqualified comparison.

`tokens_in`, `tokens_out`, `cache_read`, `cache_create`, `cost_usd`, `turns` and provider `duration_ms` remain null when unavailable. `usage_raw` retains the reported categories, including provider-specific details; `coverage` identifies present versus unavailable measurements. Explicit reported zero remains zero. Non-numeric, boolean, negative or non-finite counters do not become measured values. Reported usage/cost is not independently reconciled billing.

Interactive aggregate usage is `tokens_total_reported`, never output tokens. Subagent count is `agent_count`, never conversation turns. Runner `wall_ms` is separate from provider duration; summed agent time and human waiting remain unmeasured until instrumentation exists. No fixed USD-to-token conversion is assumed.

T13 accounting clarification (2026-09-21): legacy `usage` categories describe the main loop, not necessarily the full subagent tree; do not sum them into a swarm total. The new coordinator parser uses final `modelUsage` across all models and labels `total_cost_usd` as a client estimate, with `billed_usd: null`. See [ACCOUNTING.md](../t13/ACCOUNTING.md) and the separate historical telemetry reread. This clarification does not rewrite or certify the old benchmark records.

## Comparison policy

Comparisons stay within case and arm. Compatible records require the same fixture, harness, runner, scorer and grader hashes, host, reported model and agent version, budget, timeout and relevant configuration. Missing provenance blocks comparison. A known isolated execution context is required: `offline-fixture` for synthetic tests or `os-sandbox` for a future live adapter. The current live harness adapter records `home_isolation: unverified`, so its outputs are not yet calibrated baselines.

The latest execution is compared with up to `n` compatible preceding attempts. Valid executions alone establish quality transitions. Efficiency compares successful deliveries with successful deliveries, using a median of known output-token/cost measurements and the configured factor (default 1.2). Missing metrics are omitted explicitly in `metrics_compared`, never converted to zero. All distinct attempts, including failures and unverified legacy entries, remain in the displayed reliability denominator; incompatible cohorts are not pooled for a quality or efficiency claim. Counts are evidence coverage, not statistical significance.

A repeated assessment of one execution counts once. Reused record IDs or a run ID attached to different stream evidence produce `INVALID_RECORD`. Control convergence is reported separately from task-quality decline. Frozen fixtures include positive deliveries so rejecting every run cannot satisfy the suite.

## Legacy audit and operational boundary

The eight local legacy records were audited into `docs/experiments/eval-history-2026-09.json`; original JSON and stream hashes are retained there. Raw results remain local and unchanged. Missing original manifests/process status are never invented from current configuration. The derived legacy audit uses null for uncertifiable validity; it is deliberately not an input baseline for `regress`.

Reproduce to a new file with the runner's Python:

```text
python evals/run.py audit-history --out <new-report.json>
python evals/run.py regress
```

The audit command refuses to overwrite its output. It reports four definitively invalid attempts and four unverified attempts, with zero certified baselines. Three legacy `pass=true` values are contradicted by execution evidence: both Detour controls and the HITL control. The second Detour harness delivery satisfies today's structural grader conditionally; absent original provenance still prevents certification. Aggregate Gauntlet usage is preserved without inventing input/cache/output splits.

Live control runs are refused before spawning until OS-enforced home isolation exists. Merely changing HOME or placing shims on PATH does not protect the real user home. This restriction implements E1's approved isolation requirement; offline control fixtures and rescoring remain available. No paid run was executed in E1. T13's isolation and telemetry work must resolve this boundary before live comparative benchmarks.
