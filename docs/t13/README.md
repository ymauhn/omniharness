# T13 local implementation

Read `PLAN.md` for the approved boundaries and `../adr/0005-session-envelope.md` for the decision. This slice adds no package dependency and runs no model benchmark.

The owner's 2026-09-21 autonomy amendment authorizes routine dependencies, public reads/test assets and validation through the task itself. An envelope is not required for that human authorization. Classifier `ask` results require checking prior approval before asking again in chat; native host prompts remain authoritative. PyYAML is installed separately for the bundled skill validator, not required by the stdlib harness runtime.

The subsequent owner clarification also authorises scoped local commits and native Codex/Astra subagents under the existing allowance. Do not apply this document's experimental Claude/provider USD-admission contract to ordinary native delegation. Unknown usage limits measurement claims; it does not require another approval to work. Docker has been recovered and the 12-check live offline containment probe passed; agent-executor integration remains separate. See [ACCOUNTING.md](ACCOUNTING.md).

## Session menu and policy

`python harness/envelope.py menu --root <project>` returns a proposal only. The omniharness skill presents it and records the actual owner answer with `start --session-id <host-id> --approval-reference <message-reference>`. Defaults: Balanced, US$2, four hours, project scope, no hosts/installs, no token conversion. Optional flags: `--scope` (repeatable), `--host`, `--install`, `--token-budget`, `--budget-usd`, `--hours`, `--transcript`. Changing mode/scope uses a newly approved `start --replace`; previous approvals are archived.

`check` and `explain` take host JSON on stdin: `session_id`, `cwd`, `tool_name`, `tool_input`, optional bound `transcript_path` and `is_fallback`. They never execute the command. Exit codes: 0 allow, 3 ask, 2 deny; malformed CLI input returns 1. `status --session-id <id>` reports active state and available usage. `.omniharness/` is gitignored.

Recognised local reads and scoped native edits have explicit decisions. Compound shell expressions, arbitrary Python, test executables, unknown tools and installs ask. The small Bash HTTP form requires `curl -q` (disable curlrc), an approved HTTPS host, no auth/query/redirect flags and known budget evidence. It is command classification, not network containment: proxies, DNS and system configuration still belong to the host sandbox. PowerShell HTTP forms conservatively ask.

Usage reads only the transcript path bound at approval and requires one final result bound to the same session. Four token categories come from whole-tree `modelUsage`; top-level `usage` and assistant snapshots cannot certify a total. Multiple results, missing/crashed/truncated evidence or later assistant activity stay unknown. USD is a client estimate, not billing. The audit log retains a usage high-water mark so truncation cannot restore an exhausted budget. Logs contain a command hash and tool name, not command arguments or environment values. The log/envelope are not tamper-resistant and budget checks are not atomic reservations. Use the separate coordinator ledger for attempt admission; see [ACCOUNTING.md](ACCOUNTING.md).

Claude's guard retains the owner's latest Claude correction (`7a9b438`): PreToolUse matches Bash only, returns quiet exit 0 for ordinary/malformed input and exit 2/stderr for explicit hard blocks, and never emits an ask. Native permission lists remain authoritative. The envelope is a separate manual/coordinator policy, not injected into this guard. The installer pins Python, preserves unrelated hooks and backs up settings; its probes verify this block-only contract. S4 auxiliary hooks remain installed separately. Local probes do not prove delivery by a live host.

## Routing

See `../skills-graph/README.md` for `needs`, provenance-qualified `cost`, `alternatives` and the `omniharness-plan` block used by `plan-status`. Known comparable cost breaks keyword-score ties; unknown stays unknown. Proposed edges cannot enable rerouting. `attempted` prevents bouncing between alternatives. The CLI only recommends; the skill must check the envelope before acting.

## Swarm contract and current limitation

The Claude-style workflow body accepts `tasks: [{id,prompt,scope,dependsOn,stop?}]`, `baseCommit`, `approvalReference`, `envelope: {mode,remaining:{usd,tokens}}`, `perAgent:{usd,tokens}` and optional `tournament` (1–4). Scope supports exact relative files and directory/** only. It rejects unsupported patterns, policy paths, overlaps, duplicate ids and dependency cycles before calls. The caller must obtain `remaining` from current trusted accounting, not from the initial limit.

Independent tasks in a dependency wave request `isolation: 'worktree'`. An integrator verifies reports/diffs and runs the full battery before the next wave begins from its returned commit. A final reviewer completes both code-review and ponytail-review. Reports require nonempty changed paths and actual test command/exit/count; zero tests cannot pass. Conflicts stop with a numbered list. Tournament selection requires passing tests, then minimises absolute net lines; losing attempts remain charged and preserved.

The driver requires an injected **harness host adapter**, not assumed native Workflow APIs:

- `budget.reserve({usd,tokens})` atomically reserves both limits and returns a lease, or refuses with null. It must enforce per-call caps at the provider boundary; estimates alone are insufficient.
- `agent(..., {reservation: lease})` must run under that lease and honor actual worktree isolation.
- `budget.settle(lease)` returns trusted actual `{usd,tokens}`, including cached/input/output categories as applicable. Model self-reports are not settlement evidence. Failed calls and losers are charged too; unknown usage stops further work.
- `budget.cancel(lease)` releases only unstarted reservations after a partial wave admission fails; a running/unknown attempt cannot be released.
- `isolation.preflight({baseCommit,tasks})` must establish OS containment for all roles before any dispatch. `isolation.verify(report,{baseCommit,scope})` checks actual files and containment evidence before integration. Both are trusted host operations, never model assertions; missing proof stops the driver.

This complete host adapter is **not implemented or certified on the installed Workflow host**. The driver therefore refuses real work there (`budget-unavailable` or `isolation-unavailable`, zero calls). Coordinator primitives now exist in `harness/swarm_accounting.py` and `harness/swarm_worktrees.py`: durable atomic admission, whole-tree result receipts, real pinned Git worktrees and scope audits. They are not yet a provider-enforced cap or an OS sandbox. Offline driver fixtures inject the boundary; real Git tests use disposable repositories. [ACCOUNTING.md](ACCOUNTING.md) records the remaining wiring and host blocker.

## Validation and remaining work

S4 adds scoped, expiring review history for Scout/Gauntlet and deterministic SessionStart/skill-edit hooks. See [SEEN.md](SEEN.md) for the coordinator protocol, cold/warm fixture counts, installation and coverage limits. Partial judgments never enter the store; old confirmed findings remain visible separately. The history does not certify quality or replace human ground truth.

Run `./scripts/check.ps1`: full Python/visual suite, Gauntlet, Scout, Swarm and portal Node suites, eval selftest, user install and graph checks. No skips are accepted. No envelope was signed in the real workspace and no paid run was launched while implementing this slice.

Remaining: verified native hook delivery; provider-enforced caps and wiring the coordinator primitives into an OS-isolated executor for S3; E1 live-control home isolation; B8/B9 using corrected records; S6 portal; S7 close. E2 weighted task-graph metrics and evolution remain downstream.
