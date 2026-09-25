# Source-bound skill catalog

Status: source reviewed and offline-verified checkpoint, 2026-09-25; integration battery pending. This is a local metadata and query foundation for the Prompt Copilot, not an execution engine or a claim that every installed skill is fully curated.

Run from the repository root with Python 3.12+ (use the configured interpreter on Windows):

```text
python -m harness.skill_catalog build --root . --overlay docs/skills-graph/skill-metadata.json --out .omniharness/skill-catalog.json
python -m harness.skill_catalog query .omniharness/skill-catalog.json "revisar codigo antes do commit" --limit 3 --host codex
python -m unittest tests.test_skill_catalog tests.test_skills_graph
```

The build exits 1 for incomplete discovery, 2 for invalid input; a query may succeed with an explicit empty/abstained result. An optional root that is absent differs from a root or registry denied by the filesystem. The scanner counts inspected directory entries and bytes consumed by failed reads as well as successful ones. An incomplete direct skills root contributes no arbitrary filesystem-order subset.

## Identity and evidence

The catalog reuses the existing `skills-graph` inventory and typed relationships. Its installed rows retain distinct canonical sources even when two files declare the same name. A linked copy of the same canonical file preserves its discovered hosts instead of becoming another skill. Source identity is stable across content edits; a separate SHA-256 identifies the bytes inspected. A changed body invalidates the curated description for that body until review.

The checked-in [metadata overlay](skill-metadata.json) uses `schema_version: 1` and an `entries` array. Every entry has a `source_key`, `source_sha256` and `metadata`. Source keys are relative to the repository (`repo:`), the selected user's home (`home:`), or an explicitly discovered absolute source (`absolute:`). The initial checked-in overlay contains no absolute user path. A home-relative plugin version is part of source identity; a new plugin version does not silently inherit an old review.

The first ten entries describe eight repository skills and the installed `code-review` and `setup-pre-commit` variants. Their bodies were read before curation. These two last entries distinguish reviewing a diff from installing checks that run at commit time. None of the entries grants new authority, installs a provider or changes a skill's instructions. License, compatibility and version are preserved only when their sources declare them; absent information remains unknown.

## Taxonomy

Metadata is factual curation rather than instructions for the current agent. `functional_description` states the capability, `taxonomy` supplies a dotted functional category, `pillars` maps it to the agreed ecosystem, and `intents` names supported actions. `aliases` and `use_cases` contain separate `pt` and `en` arrays. `inputs`, `outputs`, `when_to_use`, `when_to_avoid`, `prerequisites` and `reviewed_at` explain the boundary. Avoidance phrases must not be positive search terms.

The initial vocabulary is intentionally small:

| Field | Current values |
|---|---|
| Pillars | `engineering`, `orchestration`, `science`, `community`, `marketing` |
| Functional categories | `execution.checkpoints`, `execution.parallel`, `planning.lateral`, `setup.harness`, `setup.capabilities`, `research.planning`, `discovery.capabilities`, `science.manuscript-review`, `engineering.code-review`, `engineering.commit-hooks` |

These are indexing labels, not a ranking of project priorities or an expansion of a skill's scope. For example, `thesis-review` audits an existing manuscript against provided results; it does not become a new-experiment runner merely because it belongs to the science pillar.

## Query boundary

Every recommendation must separate **relevance**, **availability** and **authority**. A discovered installed file is evidence of installation, not proof that its prerequisites, host capabilities or permissions are satisfied. A catalog or remote row remains a candidate. This read-only query service never grants execution: returned authority is unknown and `runnable` is false. A later task-specific preflight, not a lexical score, decides whether an action can run.

The first implementation uses normalized local keyword matching and bounded results, with abstention when nothing matches. It has no model calls, confidence calibration or measured semantic accuracy claim. Full skill bodies are not injected into every prompt. The future UI retrieves a short result and its provenance, then loads a selected skill only when relevant and authorized.

A generated snapshot binds source hashes, curated metadata and relationships in its content identity. Generation time is excluded from that identity. Store machine-specific snapshots under ignored `.omniharness/`, not in this public documentation folder: they may contain host paths and installed-plugin details. A bounded or unreadable scan must report incomplete coverage. Stable identity is not proof that a saved snapshot is still current; refresh before using it as current installation evidence.

The SHA-256 is a content identity, not an authenticity signature. Validation rejects internally contradictory availability, authority, coverage and relation claims; it cannot establish trust in a snapshot supplied by an untrusted writer. Requested host breaks equal-relevance ties where that host was observed. A missing host association remains unknown, not a compatibility certificate.

## Diagnostic and remaining work

[Query cases](catalog-query-cases.json) distinguish two development examples from nine independently authored holdout queries. Labels are agent proposals; human adjudication is pending. They are a diagnostic of this lexical index, not the calibrated E2 benchmark. Freeze and record the fixture hash before execution, retain all misses, and compare top-one/top-three and abstention separately. If the implementation or overlay is tuned against these queries afterward, retire their holdout status and collect fresh cases.

Still required after this checkpoint: metadata curation for remaining installed variants, new untouched queries and human labels, host/prerequisite preflight, measured cache invalidation and query latency, actual Lab/Copilot integration, and any Laya/Jev comparison. A larger row count alone does not demonstrate better recommendations or lower model token usage.

First frozen run: [sanitized observation](catalog-query-observation-2026-09-25.json). Fixture SHA-256 `564ccdaa555047fa3e6c9e6e74968fc5a3f817a244852ae5180fb78e2bc14a56`; first implementation hash is recorded in that report. All seven positive holdout labels occurred in the candidate's top three, but only three ranked first. The previous graph router returned two of seven in its top three and one first. Both engines abstained on the two empty/unmatched controls. The two development queries are reported separately and are not evidence of generalization. No returned candidate asserted execution authority.

This is a small, agent-labelled, partially curated sample; plausible alternative skills may need human adjudication. It supports displaying a short suggestion list with provenance, not automatic top-one selection or a claim of measured productivity gain. Preserve the four top-one misses. The build took 310.843 ms and individual validated queries about 24–26 ms in this one run on this host; these single observations are not p50/p95, cold-start, UI latency or CPU benchmarks. Subsequent correctness repairs require rerunning against the final implementation hash while retaining this original observation.

Final correctness repair recheck repeated all eleven cases against module SHA-256 `65dde11e94571109a3837a225b85909580df7c88b8d6fb23cf1a76d954ca8e02`, preserving all rankings and abstentions. Snapshot identity stayed `5a8be5fb236d29bd9b9b95b16d5c0f5b382f3cb8f12e39c9637342b93b847c42`: 130 discovered paths, 114 canonical installed sources, 546 total rows, ten curated rows and no discovery issues on the main repository. The isolated worktree observes extra canonical repository copies through user aliases; that is a different inventory, not a failed deduplication.
