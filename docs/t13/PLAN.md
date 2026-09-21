# T13 opening: session envelope, routing and swarm orchestration

Date: 2026-09-21. Authorisation: the owner accepted the proposed S1 -> S2 -> S3 sequence after E1. The prior T13 decisions approve the invariant amendment, Balanced default, US$2 default and 80% warning. This work implements the local deterministic paths; no session envelope is signed on the owner's behalf and no live model benchmark is launched by implementing it.

## Success criterion and agreed test boundaries

- S1: the manual/coordinator envelope CLI returns allow/ask/deny with a reason, preserves hard stops, binds approval to session/root/scope/expiry, and never interprets unknown usage as zero. The menu does not grant permissions until an explicit owner answer is recorded. Claude's separate Bash guard retains the owner's never-ask correction; it is not the envelope adapter.
- S2: the graph CLI reports unmet needs, ranks measured comparable costs without inventing measurements, and chooses only explicit alternatives permitted by the selected mode. A failed second plan step has a deterministic, explainable next action.
- S3: the workflow driver rejects overlapping/invalid scopes and dependency cycles before spawning, requests worktree isolation, integrates in dependency order, reports conflicts and missing usage, and invokes a final reviewer only after valid integration. Offline tests replace the external agent boundary.
- S4 (owner continuation, 2026-09-21): scoped/expiring review history must avoid repeated judgments without hiding changed inputs or incomplete verdicts. SessionStart and skill-edit hooks run only bounded local checks, preserve unrelated hooks, and never call a model. Compare cold/warm scheduling with deterministic fixtures.
- The complete `scripts/check.ps1` battery passes with zero skips. Existing E1 changes remain distinct from T1 commit `1a2289c`.

## Implementation choices

Use the standard library and existing workflow/installer conventions. Session files live under the target project's gitignored `.omniharness/`. Restrict automatic shell approval to commands the classifier can understand; arbitrary shell expressions or Python code require a decision instead of pretending a prefix is read-only. A hook is a policy adapter, not OS containment. Native host sandbox rules remain authoritative.

USD and tokens are independent budgets. Reported usage is read from bound evidence, with missing data explicit. Start with one coordinator for budget decisions; real concurrent spending requires enforceable reservations and accounting before a paid swarm can be certified.

The read-only graph routing/status commands never execute an alternative. The orchestration layer consumes their recommendation and the envelope decision. Capability topology does not become a task-quality score; E2 remains separate.

## Remaining evidence gates

Local implementation is in place for S1/S2, S4 and the S3 fake-agent boundary. The S3 accounting contract is explicit and unsupported hosts stop before calls. `VALIDATION.md` records the local checks and their limits; this is not a closure of S3 live acceptance or of T13. `SEEN.md` documents the S4 coordinator protocol, measurements and hook coverage.

S3 continuation: durable SQLite reservation/settlement, whole-tree telemetry parsing, pinned Git worktrees and actual scope audits are implemented; see `ACCOUNTING.md`. Docker has been recovered and a real offline container passed 12 containment checks. Remaining acceptance is wiring the agent executor/usage and containment for every role, followed by E1 control isolation and B8/B9. Native Codex/Astra allowance agents and scoped local commits have standing owner authority; the experimental USD cap is not a gate on ordinary native delegation. Phase C device/video plans found on remote branches do not change this dependency order.

Live Claude/Codex hook interception and OS-enforced home isolation require host-specific verification. A temporary HOME or a Git worktree alone does not establish isolation. Real swarm/model runs remain separate from the offline implementation checks and must name their cost when reached.
