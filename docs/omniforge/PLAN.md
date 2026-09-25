# OmniForge: owner-first workspace, after harness closure

Date: 2026-09-25. Status: **the owner explicitly authorised implementation of the complete agreed MVP; harness evidence remains a release dependency.** Candidate A is under implementation in [OmniForge Lab](LAB.md); Goose candidate B and the final desktop architecture remain undecided. This does not certify an executor or claim that researched integrations are installed. The finite cross-pillar acceptance conditions are in [V1 release contract](V1-RELEASE-CONTRACT.md). The latest UI, Copilot, catalog, workflow, terminal and telemetry requirements are in the [design intake](PROMPT-COPILOT-AND-OS-EXTENSIONS-2026-09-25.md); mascot design has its own [handoff](MASCOT-DESIGN-HANDOFF-2026-09-25.md) and is now the first real dogfood task. The complete objective is active in Codex goal state; a partial checkpoint does not replace it.

## Owner decisions and authority

- Build a local application for other developers to install, Windows first with portability prepared. The first user is the owner, who wants to organize and finish existing software, game, marketing-agency and AEO/SEO projects.
- Keep projects/tasks, coordinating chat, a skills/templates/tutorial library and terminal/review surfaces connected in one workflow. Multiple sessions and side-by-side terminals are required; different sessions can work on the same or different projects.
- Sessions share access to the owner's permitted knowledge and capability catalog. They must not silently overwrite each other's active project or load all private project content into every prompt.
- Prefer existing Claude and Codex subscriptions/allowances for native host use. Both hosts remain in the acceptance scope; new billed services are not implicitly authorized. OmniRoute is optional and native hosts are the default. Distribution of a third-party Claude integration has a separate provider-policy gate: [Anthropic's current guidance](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account) directs products for others toward API-key authentication. Do not promise that the distributed app will route Claude work through a subscription allowance.
- The owner explicitly approved the own-app versus Goose comparative slice in an annotation to the presented plan. Routine supporting work needs no repeated approval. Their later instruction to parallelize and deliver V1 as soon as possible authorizes candidate A work alongside T13; it does not waive the live containment/accounting gates or turn this candidate into the selected final base.
- The owner selected **small tools with new logic in the first prototype**, not only rearrangement of existing panels. Bound this to one useful generated module before considering a general application builder.
- For the requested Prompt Copilot, the owner selected **Discreet** as its V1 default. For Claude in the distributed app, prioritize a **native Claude Code terminal plus an optional API-key route**; keep provider-policy and telemetry distinctions visible. Details and evaluation gates are in the [design intake](PROMPT-COPILOT-AND-OS-EXTENSIONS-2026-09-25.md).
- Preserve and reuse existing skills and workflows, adapting only where evidence shows a host or interface gap. Tourism, sales funnels and new commercial services are not the current implementation focus.

The research register is [RESEARCH-2026-09-25.md](RESEARCH-2026-09-25.md). Existing acceptance contracts remain in [T13](../t13/PLAN.md), [accounting](../t13/ACCOUNTING.md), [evals](../evals/PLAN.md) and [ADR 0006](../adr/0006-evaluation-first-evolution.md).

## Authorised MVP execution checkpoints

Owner approval: September 25 instruction to implement the entire agreed MVP, explicitly allow native Computer Use and use mascot design/animation as a real test. Baseline: `fa620d61f72c4566c00b802e792b4a04556e809c`. All rows below remain required unless the owner changes scope. Optional providers and reference integrations retain their recorded status; payments remain deferred. No fixed completion date is supported by current evidence.

| Checkpoint | Runnable acceptance | State |
|---|---|---|
| First real artifact: mascot | Two skins, semantic animation states, three themes, Discreet/Off, pause and selected-text actions, preview/apply/undo, stale-draft refusal and reduced motion; human visual review. Track actual execution identity, worktree, files and checks. | [Companion Studio](mascot/README.md) and [production composer](COPILOT.md) provisionally integrated: 7 standalone / 13 Copilot behavior checks and two final source reviews. Real browser/performance acceptance is V-01. This is not an OmniForge-managed attempt. |
| Native task execution and measurement | Bind task/session/worktree to a real Codex attempt, reconcile observed usage with source receipts, stop/recover including orphan descendants, verify tool/process boundaries; document Claude native-terminal handoff and optional API mode separately. | Accounting envelope fix committed as 2d03534. Offline bridges exist; dynamicTools does not disable built-ins. Native readiness is ready/elevated, but the restrictive command canary is inconclusive; admission stays closed (V-04). |
| Catalog and Copilot | Hash-pinned installed/catalog/remote index, source/host variants, curated taxonomy and PT/EN aliases/examples; held-out selection cases; local pause/selection suggestions and scoped memory citations; no false-runnable recommendations. | [Catalog](../skills-graph/SKILL-CATALOG.md): 115 canonical installed entries, 10 curated. [Laya resident worker and controls](COPILOT.md) connected, queue/deadline/unload tested and real API lifecycle passed. Technical smoke prompts abstained; lexical default remains. Twenty adapter checks plus eight worker checks; remote JEV account/key UI and live test, full curation, host choice and calibrated usefulness remain. |
| Reusable agent arsenal | Reviewed profiles for the five pillars; create one new versioned profile from explicitly selected session material, preserving citations and rejecting injected/unauthorised rules; instantiate with real task identity and test update/rollback. | [Original registry and five profiles](AGENT-ARSENAL.md) integrated, 15 tests and two final independent source reviews; Agent Forge installed for Claude/Codex. UI selection, attributable task use and an owner-selected derivation remain. Host export is not implemented or implied by profile metadata. |
| Workflows, graphs and sessions | Saved executable workflow plus copy/run preflight; sourced graph help on hover/focus; N panes, per-window layouts and bounded output replay; shared scoped memory with version/conflict/restart tests. | [Workspace checkpoint](WORKSPACE-FLOWS-CHECKPOINT.md): saved versioned DAGs, copy/insert prompts and explicit atomic task creation; 1–8 adjustable panes, per-window layouts, bounded replay; connected scoped memory edit/history/archive controls. Final 130/130 Lab tests, zero skips, two reviews per slice/integration. Graph help, model dispatch and real visual/multi-monitor acceptance remain. |
| Extensions, repairs and provider management | Generate the agreed asset-link checker in a reviewed worktree and restricted preview; enable/disable/rollback and crash control. Reproduce and review a requested repair. Quota/tokens/estimates/billing have distinct sources; optional secrets use OS vault. | Contracts only. Real provider capabilities and credentials must be verified before claims. |
| Five-pillar acceptance and evolution | Real accepted engineering issue; parallel/recovered orchestration; reproducible scientific experiment and cited result; verified educational challenge/progress; evidence-derived marketing case study/intake. Freeze human labels, compare fixed/random/genetic search with equal budgets and report failures. | Reusable skills/fixtures exist; complete cross-pillar scenarios and calibrated pilot remain open. |
| Product selection and Windows delivery | Run the same comparison scenarios on own-app and Goose, select base, package install/update/recover/uninstall, test a clean Windows environment, and record a truthful dual-host demonstration. | Source-run candidate A only; no installation or release certificate. Public launch awaits separate publication authority. |

Independent writers use disjoint Git worktrees and bounded file scopes. Integrate only after checks and review; a worktree is not OS containment. Missing receipt categories remain unknown. Browser-denial or provider limitations cannot be relabeled as passing evidence or used to silently remove requirements.

Owner amendments, 2026-09-25: scoped commits, branch pushes, PRs and merges are authorised for traceable progress. Implement the agent arsenal and both **Laya local** and **JEV remote** classifier paths in the MVP; JEV remains an opt-in connected provider, but its adapter is now required. Nonblocking unavailable validations may wait for the final MVP round in [VALIDATION-PENDING.md](VALIDATION-PENDING.md), including JEV account/credits and visual tooling. Proceed with implementation and provisional integration without asking again for routine choices; preserve failures and unknowns, and do not enable a known unsafe executor or claim release/benchmark acceptance.

For the mascot test, artifact quality and executor acceptance are separate: creating attractive assets and passing selection tests advances the real product task; only an actual managed dispatch with authoritative tool/usage/cancellation evidence advances executor certification. A prompt instructing the model to use only a worker tool is not a security boundary. Freeze acceptance before generation, retain failed checks and require at least one stale-selection negative case.

## First: finish the pending harness milestone

Progress, 2026-09-25: step 1's E1/coordinator receipt reconciliation is implemented and tested offline (record v3, receipt v1). This closes the duplicated parser/projection mismatch, not full native telemetry for every host/role. Current acceptance and the owner-preserved installation-policy drift are in [VALIDATION](../t13/VALIDATION.md). Offline native tool bridges are being validated, and the own-app Lab candidate has begun; the Goose comparison and all-role live evidence are still open.

The baseline is implementation checkpoint `8e6c20e` and research checkpoint `5f0086d`. T1 is complete. E1 has offline integrity checks; T13 has S1/S2, local S4 and S3 primitives. Native executor/usage wiring, all-role containment and live controls remain open. The September 21 92/92 Python and 12/12 Docker-process results are historical, not new checks or proof of native agent containment.

1. Reconcile the E1 telemetry contract with whole-tree receipts. Preserve raw provenance and separate reported usage, monetary estimates, billing and coverage. Include failed attempts, retries, reviewers and descendants without double counting cumulative or aggregate events.
2. Implement against the actual Claude/Codex host interfaces: dispatch, identity, events, cancellation, failure and reconciliation. Unsupported capabilities remain explicit. Do not impose the experimental USD reservation gate on ordinary authorized native Codex/Astra collaboration.
3. Connect worktrees and the tested containment profile to actual tool execution for all roles. Verify interruption/restart boundaries and prevent duplicate side effects or integration after uncertain outcomes.
4. Verify applicable native hooks, E1 live controls and B8/B9 with comparable configurations and independent acceptance. Missing evidence limits the result; a passing local unit suite is not live certification.
5. Complete the already-scoped S6 documentation/portal evidence work and S7 checks/checkpoint. Correct stale claims and known false-success presentation; do not turn this into a new desktop or conversion project. Run `scripts/check.ps1` with zero skips for runtime changes and required host acceptance separately.

E2 calibration and genetic search are later harness milestones, not an unbounded implicit prerequisite to starting the OS. Do not silently close T13 if S5/S6 acceptance is incomplete; record the exact boundary and any owner-approved scope amendment.

## Future-compatible seams, without premature infrastructure

Keep explicit, versioned identities for project, session, run, task, attempt and artifact. Reuse the ledger, worktree manager, eval contracts, CONTEXT/ADRs, review history and skills graph. These references allow a future UI or memory adapter to consume evidence without introducing a universal graph database or desktop API during harness closure.

Distinguish three linked views:

- Capability graph: skills, tools, workflows, compatibility and dependencies. The existing skills graph is the starting point.
- Task graph: frozen requirements/dependencies plus separately recorded execution attempts. Repeated attempts cannot create extra evaluation weight.
- Project knowledge graph: files, assets, decisions, references and evidence. Every asserted edge has provenance; inferred relationships remain labeled proposals.

## Context and shared memory

Use progressive loading: concise governing instructions, searchable capability metadata, selected skill bodies, then task-relevant source excerpts. Retrieve by explicit project/session/task and preserve source paths, versions and dates. Hard requirements must not disappear because a similarity query missed them. Summaries link to original evidence; they do not replace it.

Global preferences and reusable methods, project decisions, and execution records have different scopes. All sessions can discover the shared catalog and query permitted memory, while receiving a bounded relevant brief rather than the complete history. Preserve conflicting observations and reconcile concurrent writes through a single owner/transactional mechanism instead of last-writer-wins notes.

Candidate evaluation includes retrieval correctness, missed mandatory context, irrelevant context volume, actual tokens when available, and output quality on held-out tasks. Caching and compaction are hypotheses to measure, not promised savings. Test that a decision changed in session A is either refreshed or visibly stale in session B, and that a restart does not redirect a query to another project.

`ai-memory` is a candidate already documented locally, not a newly installed dependency. Its native Windows and session-identity limitations need validation. Graphify/Obsidian-style navigation is a view over sourced knowledge; it is not automatic permission, ground truth or task acceptance.

## Then: the bounded comparative prototype

Compare A, an own application over OmniHarness, with B, a minimally adapted Goose distribution. A provisional Electron wrapper can keep the own-app experiment small; the final stack is undecided. Use Wave Terminal, AstrBot and OpenHands as targeted references, not automatic additional full-product forks.

Require the same external outcomes, not the same internal schema or database. Reuse is legitimate on both sides. Fix the fixture commit, expected results, host/model/settings and adaptation effort allowance before runs. Report mock and live evidence separately, compare within each host, and retain unavailable capabilities and failed attempts. Do not rank unknown consumption as zero. Check the permitted distribution channel for each host before promising subscription integration; neither a gateway nor another app's support claim resolves that question.

Five scenarios cover the connected experience:

1. Open the fixture project, discover prerequisites, arrange two real terminals side by side, and show their project/session identities. Include a two-project case to detect context routing errors.
2. Use task-linked chat to fix a small reproducible defect, with test evidence, diff review and a traceable result.
3. Execute two independent tasks in disjoint worktrees, review them and integrate under the existing coordinator contract.
4. Cancel and restart during execution, recover the layout and durable task state, and perform a Claude/Codex handoff. Distinguish restored UI, surviving process, resumed model session and re-dispatched work; none implies the others.
5. Select a skill from the shared library and ask the main chat for one new mini-tool, such as an asset inventory that detects broken fixture references. Exercise generated logic, persistence, failure handling and removal from the active workspace.

Qualifying conditions include honest state, trustworthy evidence, scoped actions, no cross-session project confusion and no false success. Compare usability, adaptation effort, maintenance burden, installation and measured resources separately. If neither candidate qualifies, return an inconclusive comparison with concrete gaps rather than a forced winner.

## Adjustable UI and generated mini-tools

Keep navigation, task identity, chat and execution controls stable. Support saved layouts, tab groups, focus mode and optional split panes. A chat request can add or rearrange requested panels with undo; do not continually rearrange the workspace on the owner's behalf.

Separate two extension paths:

1. Declarative panels select existing components and bind data/actions. A2UI is a reference or adapter candidate; its schema alone does not enforce action permissions.
2. A genuinely new mini-tool adds code as a versioned module with declared inputs, outputs and capabilities. Generate it in a separate worktree, run deterministic checks and preview it in a restricted execution surface. Keep the main UI usable if the module crashes. Changes to the core or new privileges are not implied by rendering a panel.

The first generated tool is read-only against fixture assets and uses the existing execution boundary. Persist its source, version, tests and manifest; provide disable/revert without deleting source history. Backend actions always go through harness authorization. Do not expose unrestricted shell, credentials or the coordinator ledger to generated frontend code.

## Optional modules and later milestones

- OpenMontage: owner-prioritized audiovisual module after harness closure; use real execution recordings for demos, clearly distinguish synthetic media, and assess its AGPL and renderer/provider requirements before packaging.
- Dify: evaluate as a separate optional visual workflow service for a future AEO/SEO or agency case. Review its additional license terms before a multi-workspace distribution; do not replace the native host executor with it.
- OpenCodeReview: compare its host-delegated review path with existing Gauntlet/code-review on planted findings and clean controls before adopting it.
- RAGFlow: optional document-heavy retrieval/memory service if simple project files and indexes are insufficient; not a prerequisite for local session continuity.
- Other catalogs, design guides and voice tools feed curated research or bounded modules. Discovery does not mean installation.

After choosing a base, validate it by finishing one of the owner's actual open projects, then harden installation/update/recovery for another developer. Preserve the five strategic ecosystem pillars. E2 and bounded evolution follow reliable measurement and human calibration; UI customization is not permission to mutate evaluators or authority rules.

## Handoff and evidence

Update [T13-H1](../t13/TICKET-HANDOFF-CLAUDE.md) at each continuation with starting SHA, scope, files, failed and successful checks, mock/live distinctions, usage availability and the exact next acceptance boundary. Research observations are not benchmark records. No automatic watcher, dependency install, external publication or paid service was created by this plan.
