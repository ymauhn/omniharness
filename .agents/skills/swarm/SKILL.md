---
name: swarm
description: Implement an approved task plan through disjoint Git worktrees, dependency-ordered integration and a final review. Invoke explicitly as /swarm on Claude Code or $swarm on Codex. Native Codex agents may use standing task/allowance approval; additional-charge services require their own approved budget.
license: MIT
metadata:
  version: "0.2.0"
  layer: execution
  compatibility: Native Codex delegation under task authority; experimental Claude Workflow adapter in swarm/swarm.workflow.js; sequential worktrees on unsupported hosts. Git and complete local test dependencies are required. Benchmark certification requires verified accounting and containment.
---

# swarm

Resolve `<root>` to this skill's OmniHarness checkout and `<project>` to the target repository. Read `<root>/docs/t13/README.md` for the driver contract and current host limitations.

1. Read the approved PLAN.md or TICKETS.md and target governance. Extract tasks as `{id, prompt, scope, dependsOn}`. Scope accepts exact relative files or `directory/**`; no escaping paths, policy files or overlap between tasks. Do not infer a task from an unapproved plan. Each task has a runnable acceptance check. A `stop` milestone returns to the owner.
2. Identify the host and funding channel before applying a monetary gate. Native Codex/Astra agents under the owner's existing allowance use standing task authority and native host limits; do not demand a USD envelope or another approval for each delegation. Keep tasks bounded and record observed usage, with unavailable values unknown. Additional-charge services use the approved envelope, remaining USD/total-token budget and host accounting; without their required reservations, report `budget-unavailable`. Include every role, retry and loser. Never turn missing usage into a measured zero or an efficiency claim.
3. Experimental Claude/provider driver: after accounting and isolation have been verified, call `Workflow({name:"swarm-driver", args:{tasks, baseCommit, approvalReference, envelope:{mode, remaining:{usd,tokens}}, perAgent:{usd,tokens}, tournament:1}})`. It requires host-provided reserve/settle/cancel and isolation preflight/verification, **not claimed native Workflow APIs**. Unsupported hosts stop before calls. This driver's monetary contract does not govern native Codex allowance agents; never impersonate its adapter with guessed usage or isolation claims.
4. Codex: use native agents where authorised, with disjoint worktrees for parallel writers and one coordinator for integration; a same-directory read-only reviewer does not need a new worktree. Hermes or a host lacking an isolated agent launch uses sequential worktrees. Use approved locations and `codex/` branches; scoped commits have standing owner authority in this repository. For each dependency wave, branch from the integrated base, follow TDD and ponytail, audit actual paths and collect checks/usage. Stop on conflict and keep worktrees for inspection. No recursive cleanup. A worktree is not an OS sandbox; certified isolation experiments require separate proof.
5. Run the full local battery with no skipped tests after integration. Perform `ponytail-review` and `code-review`; missing reviews or unknown evidence cannot approve a task. Report worktree/branch, changed paths, executed checks, actual usage (unknown stays unknown), stop reason and pending owner decisions. A clean mocked driver test is not proof of live worktree isolation, real host interception or benchmark improvement.

Optional tournament: only when approved, use 2–4 isolated candidates for one task, retain all attempts in cost accounting, select passing candidates first then minimum absolute net lines. Review the winner for spec completeness; size alone is never a quality score. No push, credentials, payments or recursive deletion is authorized by this skill.
