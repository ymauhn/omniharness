# ADR 0005: recorded session authority with explicit evidence limits

Date: 2026-09-21. Status: accepted direction (owner, 2026-09-14), local S1/S2 and S3 offline core implemented. The dated continuation below supersedes the original all-tool-hook design.

## Decision

An explicit operator answer records prior approval for a bounded session. Balanced is the proposed default, US$2 the default budget, warning at 80%. Tokens are a separate optional limit; the historical estimate of 750k tokens is not a conversion rule. No envelope is created merely by installing or activating the menu. Identity, root, scope, hosts, installs, expiry and the approval reference are stored locally; replacement archives the old record.

The local policy returns allow/ask/deny with a reason. Hard stops remain outside the envelope. Unknown syntax, absent usage or identity, expiration and unavailable host features do not grant authority. Native permissions remain authoritative. The recorded reference is an audit pointer, not a cryptographic signature or protection against an actor with filesystem access.

The Claude adapter covers all PreToolUse tools, including PowerShell and native files. Codex/Hermes have a manual policy procedure; live interception is not certified. Existing native ask/deny entries are retained. Consequently a host may still prompt for a command the envelope permits. Broad Python execution and test runners are not classified as harmless reads. Installs still ask because build scripts and dependency resolution cannot be constrained to hosts by a string classifier.

Owner amendment, 2026-09-21: routine task approval now covers necessary dependency installation, public documentation/assets and validation without a new chat confirmation for every package or host. This includes the pending PyYAML and Google Fonts validation steps. A conservative classifier's `ask` calls for checking existing authority; it does not erase that authority or mandate a duplicate user question. Native host controls are retained, not bypassed. Paid or consequential actions outside existing approval still require a concrete decision. The full policy is in AGENTS.md under Task-scoped autonomy and supersedes earlier blanket per-command wording.

The capability graph gains presence checks and measured costs, never guessed prices. Rerouting considers explicit approved alternatives and attempted steps. It remains a recommendation until the envelope and host authorize execution. Task quality and task-graph weighting remain E2 work.

Swarm orchestration validates disjoint scopes and dependencies, uses isolated worktree requests, integrates one dependency wave before starting its dependents, and requires a final review. Every attempt, including tournament losers, counts in usage. A trusted host must reserve and cap both USD and total tokens and settle actual usage. The existing output-only Workflow counter cannot satisfy that contract; unsupported hosts return `budget-unavailable` before calling an agent.

## Alternatives and consequences

We retain the repository's small standard-library policy and explicit workflow adapter instead of installing RuFlo as an MCP server. The prior comparison is `../experiments/ruflo-comparison-2026-09-14.md`; no new external product claim or installation is made here.

Offline fixtures prove local decisions and orchestration branches, not host isolation, live spending containment or benchmark improvements. S3 live admission/accounting remains a parity item. S4, B8/B9, portal changes and final T13 closure remain open. Implementation authorization does not create permission for a real swarm run or a new commit.

Official hook reference read with owner authorization: [Claude Code hooks](https://code.claude.com/docs/en/hooks), 2026-09-21. The adapter uses PreToolUse decisions, matches all tools and retains native permission precedence.

## 2026-09-21 continuation: preserve Claude's block-only guard

The owner's subsequent Claude work restored the Bash-only guard and pinned its never-ask contract in `7a9b438` (`fix/guard-never-asks`). Its predecessor all-tool envelope adapter remains in stash `8105be6`, preserved for evidence, not restored. Codex retains the correction: ordinary/malformed input returns quiet 0; explicit hard blocks return 2/stderr. Native ask/deny lists remain authoritative. The envelope is now a manual/coordinator policy on all hosts; the earlier interception design above is superseded. S4 SessionStart/PostToolUse advisory checks are independent and restored with narrow read-only allow entries.

S3 adds SQLite admission/settlement and coordinator-owned Git worktree manifests, with real temporary-repository tests. Whole-tree token accounting uses `modelUsage`; client-estimated USD and actual billing are distinct. The envelope shares this parser instead of interpreting assistant output placeholders as complete usage. Driver admission requires trusted OS-isolation preflight and scope audit before integration; model reports are insufficient. Atomic reservations do not enforce a provider cap, and Git worktrees do not contain arbitrary processes. See [the accounting contract](../t13/ACCOUNTING.md).

S4 is locally implemented. B8/B9, OS-isolated provider wiring, portal and final closure remain open. The Windows Docker engine currently cannot start because its inference runtime socket is inaccessible; no destructive repair or paid test was performed. Preserve task-scoped autonomy and native host controls while resolving this external prerequisite.

## 2026-09-21 owner clarification: native allowance and local checkpoints

The owner explicitly authorises local commits for reviewed/validated task changes and native Codex/Astra agents using the existing allowance. Remove the generic no-commit and per-native-agent paid-call approval restrictions. Do not require a USD envelope, billing credentials or the Claude experimental adapter before ordinary native delegation. Unknown native usage remains unknown; it cannot certify efficiency or billing. Additional-charge APIs, purchases, push/publication, destructive operations and OS-sandbox claims retain their separate boundaries. The Bash hard-block guard does not implement either removed restriction and stays in place.

The installer no longer adds the blanket Git-commit ask. Its explicit `--task-commits` migration removes precisely that legacy entry with a backup, preserving specific rules and unrelated permissions. This avoids broad deletion of host controls while applying the owner's requested autonomy.
