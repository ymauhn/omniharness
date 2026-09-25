# Checkpoint evidence record

Use this compact record in the target project's existing task notes; do not create a second ledger. Paths must refer to actual artifacts. Fill observations after execution, never prefill passing verdicts.

```yaml
checkpoint: C1
plan:
  path: <approved plan>
  sha256: <hash of reviewed contents>
  authority: <existing owner instruction or approved envelope reference>
reference:
  revision: <source commit or design version>
  scope: <behavior or UI state covered>
depends_on: []
write_scope: []
acceptance: []
repair_limit: 2
attempts: []
evidence_revision: <commit plus hash/description of any uncommitted diff>
behavior:
  status: pending
  commands: []
  exit_codes: []
  passed: null
  failed: null
  skipped: null
visual:
  applicability: <required or not_applicable, with reason>
  status: pending
  reference_capture: null
  implementation_capture: null
  state_and_viewport: null
  findings: []
reviews:
  - reviewer: null
    evidence_revision: null
    status: pending
    findings: []
  - reviewer: null
    evidence_revision: null
    status: pending
    findings: []
usage:
  receipt_paths: []
  coverage: unknown
  total_tokens: null
  estimated_usd: null
  billed_usd: null
technical_status: pending
human_acceptance: pending
commit: null
next_action: null
```

Gate statuses: `pending`, `passed`, `failed`, `invalid`, `blocked`; visual-only `not_applicable` requires its stated logic-only reason. Invalid evidence requires recollection, not implementation changes guessed from incomparable inputs. Capture an explicit failure even if a command exits zero but produces no meaningful result.

Before each transition, reconcile the current diff/reference/acceptance against this record. Do not reuse evidence affected by intervening edits. Two entries do not establish reviewer independence: record actual separate contexts/identities and actual verdicts. Preserve mandatory governance in both contexts.

An attempt records its input revision, actions, checks, remaining findings and available receipt path. Do not sum cumulative session snapshots, charge failed work as zero or equate client USD estimates with billing. Reuse the harness accounting contract when available; a handwritten total is not a trusted receipt.

A technically complete checkpoint can be committed under standing authority while final product acceptance is pending. An explicit owner stop milestone still blocks the next checkpoint. Scope-expanding feedback returns to planning; in-scope corrections reuse authorization and rerun affected gates.

A future CLI or UI may render this record, but this Markdown/YAML template is not executable enforcement. Do not claim that a Stop hook, visual scorer, native execution adapter or sandbox is present merely because the corresponding field exists.
