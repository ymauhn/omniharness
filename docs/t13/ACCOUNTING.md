# S3 coordinator accounting and worktree evidence

Date: 2026-09-21. Implemented locally; paid dispatch and OS-isolation acceptance remain open. No model call is made by these modules. Python 3.12+, Git and SQLite from the standard library suffice.

Owner clarification, 2026-09-21: native Codex/Astra subagents use the existing allowance and are authorised within the task, without a repeated paid-call question. Local commits are also authorised. The USD-reservation contract below belongs to the experimental additional-charge Claude/provider executor; it must not block ordinary native Codex delegation. Missing telemetry remains unknown and prevents a measured benchmark claim, not routine task execution. This is the owner's billing-channel classification, not independently reconciled billing. OS containment is still required before claiming isolated benchmark runs.

## Measured usage, estimated money, unknown billing

`harness/swarm_accounting.py` accepts a UTF-8 JSONL stream from **one non-resumed, single-input Claude CLI invocation**, captured by the coordinator. Require exactly one result and the session ID reserved for that attempt. Multiple/cumulative results, identity mismatches, malformed/truncated streams and later assistant activity cannot settle a call.

Tokens sum four categories over every model in final `modelUsage`: input, output, cache-read input and cache-creation input. Keep the categories in the receipt; their unweighted sum is an accounting measure, not a quality score or price conversion. Do not add top-level `usage`, assistant events, child transcripts or model costs on top of this whole-tree aggregate. A resumed/streaming-input session needs a separate adapter and is currently refused.

The official [Claude cost-tracking reference](https://code.claude.com/docs/en/agent-sdk/cost-tracking) distinguishes whole-tree `modelUsage` from main-loop `usage`. It also describes assistant output placeholders, cumulative results and potentially zeroed crash results. `total_cost_usd` is a **client estimate**; authoritative billing requires the provider's Usage/Cost data. Therefore `estimated_usd` and `billed_usd` are separate and billing remains null here. A budget-stop or failed process still consumes measured tokens; `process_ok` never means the task passed. Task acceptance remains E1/reviewer/human work.

Example read-only receipt command (use the recorded session and process status, not guessed values):

```text
python -m harness.swarm_accounting <captured-stream.jsonl> --session <launched-session-id> --exit-code <actual-exit>
```

The historical reread in `../experiments/swarm-usage-2026-09.json` has seven local streams, six complete usage aggregates and one unresolved stream. The **known subtotal** is 1,311,288 tokens and approximately US$2.857086 client-estimated. It is not the total for every historic call, does not include this Codex conversation, and does not validate any benchmark. Raw streams were unchanged; the report links their hashes and the parser hash. No provider call or billing credential was used.

## Durable coordinator ledger

`Ledger(path)` exposes `create`, `reserve`, `start`, `settle`, `cancel` and `status`. Keep the SQLite file and receipts outside all worker sandboxes. The run's approval reference and USD/token ceilings are immutable; the caller must validate that the reference is real authority. SQLite `BEGIN IMMEDIATE` serializes reservations across connections; integer nanodollars avoid floating-point over-admission. This is atomic admission, **not prevention of provider overspend**.

- Reserve both ceilings before launch. Each role/retry/tournament loser is a distinct attempt label. Reusing an unstarted identical reservation is idempotent; reuse after launch is rejected.
- Bind a unique provider session with `start` before spawning. A coordinator crash after this point leaves a conservative running reservation, not free balance.
- Settle the coordinator-captured stream and process status exactly once. The receipt binds the source hash; changed evidence and reused session IDs are refused.
- Charge failed attempts. Missing/crashed usage retains its reservation and blocks further admission. An observed overrun is recorded and also blocks; never clip measured usage to the promised cap.
- Release only unstarted reservations. The driver cancels an admitted prefix when the rest of a wave cannot reserve; running attempts cannot be cancelled as zero-cost work.
- Unknown or in-flight totals remain null. No automatic unblocking or fabricated zero settlement exists; preserve evidence for operator reconciliation.

The database and manifests are not signatures or protection against a same-user process with host filesystem access. A full host adapter must capture evidence outside worker control, prevent worker access to the ledger/credentials, enforce provider-side caps, and account for integrators/reviewers as well as implementers.

## Verified Git worktrees

`harness/swarm_worktrees.py` creates distinct `codex/swarm-<run>-<task>` branches from a full pinned SHA in a clean, trusted source repository. Worker storage must be outside the source checkout. Existing paths/manifests, dirty source, escaping scopes and policy paths are rejected without removing anything. The coordinator owns the manifest. Repository hooks are disabled for these Git operations; arbitrary external repositories/configured filters are not an intake sandbox.

```text
python -m harness.swarm_worktrees --source <clean-repo> --workers <sibling-storage> create <run> <task> --base <full-sha> --scope src/task/**
python -m harness.swarm_worktrees --source <clean-repo> --workers <sibling-storage> audit <sibling-storage>/.control/<run>/<task>.json
```

Audit verifies the Git identity and ancestry, compares committed/staged/working changes against the pinned base, includes untracked **and ignored** files, and checks both sides of renames. Protected policy files and redirected paths fail even under a directory scope. It reports `scope_ok`, actual changed files and violations. It cannot detect a write subsequently reverted, or prevent a process reading/writing elsewhere. All worktrees/branches remain for inspection; no automatic cleanup or integration is implemented.

The honest result is `isolation: git-worktree-only`, `os_sandbox_verified: false`. The driver requires separate trusted `isolation.preflight` and `isolation.verify` evidence before dispatch/integration. A model's report or a requested `isolation: worktree` option cannot provide it.

## Remaining host acceptance

Installed Claude CLI is 2.1.278. Its USD cap is documented; a verified total-token cap covering all roles is still missing. The [native sandbox reference](https://code.claude.com/docs/en/sandboxing) supports Linux/macOS/WSL2, not native Windows. A Git worktree or temporary HOME is insufficient for E1 control isolation.

Docker Desktop 4.85.0 initially could not initialize the inference socket; a direct socket rename failed. The subsequent repair preserved the stopped runtime's socket-only directories under `.pre-omniharness-20260921` suffixes, then let Docker recreate them. This also resolved the analogous Secrets Engine socket error. No credentials were read, Docker data reset or socket deleted. The Linux engine now responds as **29.6.2**. Backups remain at `%LOCALAPPDATA%/Docker/run.pre-omniharness-20260921`, `run.pre-omniharness-20260921-2` and `%LOCALAPPDATA%/docker-secrets-engine.pre-omniharness-20260921`.

Live process acceptance now passes: `harness/sandbox_probe.py` creates disposable source/worker Git checkouts, synthetic home/coordinator sentinels, and an unprivileged offline container with one worker bind mount. It checks actual container configuration, process restrictions and host artifacts. **12/12 checks passed in 1.297 s**, including denied root writes/network access, inaccessible source/sibling/private paths, no Docker socket, non-root execution, zero capabilities, seccomp/no-new-privileges and actual scope audit. Report: [sandbox-containment-2026-09.json](../experiments/sandbox-containment-2026-09.json), with source hash and image digest. Temporary test resources are cleaned up by exact identity; preserved Docker recovery backups are untouched.

Reproduce after installing the official image (failure is nonzero, never a skip):

```text
python -m harness.sandbox_probe --endpoint npipe:////./pipe/dockerDesktopLinuxEngine --image python@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9
```

Pass `--docker <absolute-cli-path>` if Docker is not on PATH; omit the Windows endpoint for a local Unix engine. The probe uses an empty client configuration and ignores inherited Docker connection overrides. It never pulls an image or calls a model. The runtime flags follow [Docker's container reference](https://docs.docker.com/engine/containers/run/).

Next acceptance: connect the coordinator/agent tool executor to this containment profile and trustworthy native usage, with tests for crashes, cancellation and every role; connect E1 controls before B8/B9. The process probe is not a live model session, a provider cap, or proof that native Codex tool calls already run in containers. Native allowance agents may perform authorised ordinary work now; only additional-charge services need a new cost decision. Keep billing/token availability explicit and do not promote this fixture to a comparative benchmark.
