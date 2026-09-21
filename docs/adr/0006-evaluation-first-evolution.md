# ADR 0006: evaluation integrity before commercial expansion or evolution

Date: 2026-09-20. Status: accepted by the owner in the Codex alignment round.

## Decision

Complete local T1 parity and harden evaluation before commercial work or a genetic-algorithm pilot. The owner authorised the missing skill-installer links, the detected Python 3.12 runtime, empty-response/process-failure fixes and the parity report. The first code changes are recorded in `../experiments/codex-parity-2026-09.md`; the next slice is `../evals/PLAN.md`.

The ecosystem has five integrated pillars. They are strategic scope, not a claim of shipped capability:

1. **Software engineering, primary core:** rigorous TDD, legacy refactoring, test parity, context-window precision and deterministic simplification through ponytail.
2. **Agent orchestration and OS:** parallel swarms in worktrees, GOAP-style replanning and a command-centre/Helm-OS interface. No particular external Helm-OS implementation has been selected or assessed in this round.
3. **Thesis Factory and scientific rigour:** controlled experiment automation, repository/code reproducibility audits, mathematical consistency and support for IEEE/ACM/SBC research articles. This expands the earlier review-only roadmap. Existing `thesis-review` remains a manuscript-review operation; a future experimental workflow needs an explicit protocol, inputs and execution budget. This decision does not launch experiments or amend a manuscript's binding constraints.
4. **Educational community platform:** classroom modules, practical challenges checked by code, member progression and living documentation, in the style of Skool. Commercial implementation follows measurement integrity.
5. **Agentic marketing:** developer-facing technical copy, evidence-backed case studies, funnels and tutorial scripts derived from commits, benchmarks and sourced references. Claims must trace to evidence, and external reads remain gated.

## Evaluation model

Keep the capability graph (skills and typed relationships) separate from the task graph (dependencies and observed execution). Adopt normalised task weights with a minimum floor, eliminatory critical requirements, penalties for demonstrably unproductive loops, and refuter calibration against human ground truth. Exact coefficients, aggregation and calibration require fixture validation; no numeric weights are asserted here.

The first genetic search space is restricted to:

- Gauntlet subagent/lens selection;
- effort allocation per task node;
- fallback strategies.

Mutation does not alter the evaluator, ground truth or human approval rules. Record candidate lineage and charge all search/evaluation cost, including losing candidates. Human review remains the final promotion gate. Compare against the fixed baseline and random search under the same budget before claiming evolutionary benefit.

## Consequences

Execution validity, task quality and control discrimination must become separate outcomes. Missing usage is unknown, not zero. Historical records keep their provenance and cannot be mixed into a calibrated baseline without qualification. Model, host, grader, task and budget differences must be represented before comparing runs.

The existing T13 envelope decisions remain accepted. No envelope is implemented or signed by this ADR. S1/S2 should consume the corrected telemetry contract when that slice is ready. ADR number 0005 remains available for the already-planned session-envelope decision.
