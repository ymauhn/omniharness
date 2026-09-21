# Cross-run review history and local hooks (S4)

The project-local journal is `.omniharness/seen.jsonl`, outside version control in this repository. A single coordinator serializes its writes; workers return proposals and never append themselves. The journal is an optimization, not a source of task approval or a certified quality score. Human ground truth and E1 validity still apply.

## Coordinator protocol

1. Prepare a complete inventory of review inputs. Include source/test contents (including dirty and relevant untracked files), binding rules, and a small request JSON containing the exact demand, areas, lenses, source prompts, model/effort configuration and the driver revision/hash. Keep that request under the target project. Exclude generated history/output files. A Git HEAD alone misses dirty changes. If the inventory cannot cover relevant inputs, run cold; do not guess a reusable context.
2. Run `python <harness>/harness/seen.py fingerprint --root <project> --consumer scout --scope <task-slug> --file <request.json> --file <source> ...`. Use `gauntlet` for audits. The CLI returns `context`, a SHA-256 hash of the consumer, scope, sorted paths and actual file bytes. No model or network call occurs.
3. Run `snapshot` with the same root/consumer/scope and `--context <hash>`. The default lifetime is seven days; `--max-age-days` accepts a positive duration up to 365 days, including fractions. Use `--fresh` for a deliberate cold run. Only exact scope/context matches enter the snapshot. Changed inputs require a fresh fingerprint. Time-sensitive research should use a shorter lifetime or a cold run.
4. Pass the snapshot as driver `args.seen`, alongside `args.seenScope` and `args.seenContext`. Mismatched metadata is rejected before spawning. The snapshot must come from the CLI immediately before this run; the drivers do not invent dates or independently refresh journal records. Omitting it gives a cold run. Research/audit spending still requires the approved task/envelope authority.
5. Save the dossier/audit report, including `previouslyJudged` separately from new results, before recording `seenUpdates`. Preserve the previous report rather than overwriting it with an empty warm result. Invoke `record` with the same root/consumer/scope/context and send the updates array on stdin. Only the coordinator writes, once the run has settled, before changing any audited source. Recompute inputs after fixes. On Codex/Hermes, the Scout coordinator applies the same URL filtering and reviewed-only write rule manually.

Examples of stored records (dates and hashes are produced by the CLI):

```json
{"version":1,"consumer":"scout","scope":"landing","context":"<sha256>","id":"https://news.ycombinator.com/item?id=1","date":"<UTC ISO date>","verdict":"reviewed","evidence":"observed reference evidence"}
{"version":1,"consumer":"gauntlet","scope":"core-audit","context":"<sha256>","id":"src/core.py:23 — concrete issue","date":"<UTC ISO date>","verdict":"refuted","evidence":"serialized lens verdicts"}
```

Scout removes fragments and normalizes scheme/host case only. Query parameters, path case, scheme and trailing slash remain significant: two Hacker News IDs are two references. Credential-bearing URLs are refused by the store. A successful structured synthesis can emit `reviewed` updates; empty references, failed synthesis and ceiling stops do not. Warm runs still search for new references but exclude known URLs and omit synthesis when nothing new remains.

Gauntlet reuses exact `file:line — title` identities, not a historical line window. Existing within-run deduplication is unchanged. Only confirmed/refuted findings with all requested lenses returning valid verdicts are stored; incomplete or unverified judgments remain eligible for retry. `previouslyJudged` keeps old confirmed findings visible: reuse does not mean they were fixed. A different title on the same line remains eligible for review.

The journal validates the whole existing file and proposed batch before appending. Identical fresh verdict/evidence pairs are idempotent. Expired evidence may be refreshed only after another review. Malformed, truncated or unterminated journals return a nonzero exit without repair/deletion. Report the failure and use an explicit cold snapshot only if the existing run authorization permits it; never silently suppress findings or authorize a paid retry. This is trusted local state, not tamper-resistant storage or a concurrent database.

## Deterministic hooks

`harness/hooks/verify.py` runs fixed commands from the trusted harness checkout using the pinned Python. Each command has a 20-second timeout; the host hook has 45 seconds. No command comes from a tool payload. Results are advisory context, with a visible failure message; the hook neither undoes an edit nor launches repairs, agents or network calls.

- `SessionStart` on startup/resume/clear: `scripts/install.py --check`, then `evals/run.py regress`. Insufficient baseline data remains **INSUFFICIENT**, never evidence of no regression. It runs in the harness checkout or an external project with a valid active session envelope. Installation alone does not opt other projects in. Activation later in a session still uses the omniharness skill's explicit checks.
- `PostToolUse` on Write/Edit/MultiEdit: resolve the tool's path and run `tests.test_layout.Skills` plus the skills-graph check only for files under this checkout's `.agents/skills/`. Unrelated paths and tools are ignored. Shell/script writes require the normal explicit battery; this hook does not claim to observe every filesystem writer.
- `OMNIHARNESS_SANDBOX=1` disables these auxiliary checks in eval workspaces to avoid global-install leakage and recursive checks. It does not disable the PreToolUse gate. The installer pins and validates all three events and preserves unrelated hooks, including design detectors.

The event matching/output contract follows the [official Claude Code hooks reference](https://code.claude.com/docs/en/hooks), consulted 2026-09-21. Local JSON probes verify the scripts; native delivery/interception still requires a live Claude session. No native Codex/Hermes hook is claimed.

## Offline measurement

`node tests/test_scout_driver.js` and `node tests/test_driver.js` emit cold/warm comparison lines. The fixtures hold the demand, findings and review responses constant. Scout: **4 → 3 simulated agent calls**, two reviewed URLs reused; Gauntlet: **3 → 1**, one judged finding reused. These counters measure scheduling only. The synthetic 1,000 units per stub call are not real tokens, dollars, model quality or a speed benchmark. Live B8/B9 and a trusted reservation/usage adapter remain separate work.
