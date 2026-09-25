---
name: checkpoint-build
description: Implement a substantial feature, refactor or migration against an existing app, approved design or behavioral reference using small checkpoints with current test, visual and independent review evidence. Use for Helix-style coding workflows; ordinary small edits use the normal build flow.
license: MIT
metadata:
  version: "0.1.0"
  layer: execution
  compatibility: Claude Code, Codex or Hermes with filesystem, Git, runnable project checks and independent reviewers. Visual checkpoints also require a working renderer and image-capable review. This skill is a procedure, not a host-enforced gate.
---

# checkpoint-build

Use the target project's governance and existing task approval. This original OmniHarness routine draws on the public [Helix description](https://shopify.engineering/helix) and [AI LABS walkthrough](https://www.youtube.com/watch?v=bBMp5tLxShQ); it does not install their internal or commercial tools.

## Establish the reference and boundaries

Read the relevant source and running behavior, or the approved product/design reference. Include state, permissions, failure paths, navigation, data and accessibility where relevant. A screenshot alone is not a behavioral specification. If a new UI has no reference, settle a small prototype/design within the task before claiming visual parity; do not silently use generated implementation as its own oracle.

Reuse an approved plan. Record its content hash, source revision, scope and acceptance alongside the existing approval reference. Routine fixes invalidate affected evidence, not task authorization. Ask only for genuinely missing product decisions or material scope/reference/acceptance changes.

Choose a short dependency-ordered list of reviewable slices. Keep one active dependent checkpoint; inspect the next source section when needed. Plan observable acceptance independently of the implementation, then use /tdd one vertical slice at a time. Prefer public behavior seams over tests of private internals. Use existing headless tests/CLI before adding new tooling.

Start a [checkpoint record](references/checkpoint-record.md). Default to two repair cycles per checkpoint unless the approved budget/limit is tighter. A cycle is one correction (code repair or invalid-evidence recapture) followed by reassessment; initial implementation and validation are not repair cycles. Retain attempts and unresolved findings rather than restarting the counter. Distinguish invalid evidence, failed acceptance and unavailable prerequisites.

## Validate the current slice

1. **Behavior:** execute the scoped checks, retain command/status and positive and negative cases. Install missing local dependencies under existing authority. Empty output, an unexecuted test, or skipped coverage cannot approve this gate.
2. **Visual, when applicable:** capture reference and implementation in the same state, data, viewport and theme. Limit comparison to this checkpoint. Mismatched states are invalid evidence: recapture. Record located differences and their disposition. Classify visual applicability before implementation; a logic-only exemption needs a reason. On resuming work without that declaration, record a late assessment of the actual diff, without backdating it; uncertainty keeps the gate required. Never use an exemption to conceal a missing browser or UI change.
3. **Independent review:** obtain two fresh read-only reviews of the actual diff and governing architecture/acceptance. Use /code-review or available native reviewers. Give each the minimal source/evidence and mandatory project constraints, without the implementer's persuasion or the other verdict. Record separate task/session identities and the inputs supplied to each; two personas in one context do not qualify. A fixer is not a second independent reviewer. Unsupported independence remains blocked, not silently certified.

Repair confirmed findings; substantiate rejected findings and have the reviewer reconcile them. Any changed code invalidates affected tests/reviews; visible changes also invalidate visual approval. Check the final diff against the evidence revision before marking technical completion. Do not advance a dependent checkpoint on a pending, invalid or failed applicable gate. If applicable gates remain unresolved after the repair limit is exhausted, or the same failure yields no new evidence, stop expansion and report the smallest unresolved issue and a proposed split/replan. User stop and budget limits always terminate continuation.

## Close and continue

Present the verified slice and record its current evidence. Honor an explicit human stop milestone; otherwise use standing scoped commit authority and continue the approved sequence without another ritual confirmation. Keep product acceptance pending until the owner actually provides it. A local commit is not publication or human endorsement.

Store accepted feedback in project CONTEXT/ADRs or linked decisions, with scope, date and evidence. Retrieve only relevant lessons; never treat an old review as approval of changed code. Use /swarm only for truly independent work with disjoint writer scopes/worktrees; integrate before a dependent checkpoint begins. Reviewers may remain read-only in the coordinator checkout.

Report every attempt, reviewer and retry with available usage receipts; unknown consumption stays unknown. Git worktrees, this skill and a model's verdict do not prove OS isolation or enforce host execution. The procedure installs no Stop hook. Never claim a benchmark improvement from the number of passed gates alone.
