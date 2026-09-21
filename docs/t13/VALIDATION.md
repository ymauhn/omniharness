# T13 validation record

Date: 2026-09-21. Host: Windows, bundled Python 3.12.14, Node 24.19.0. Parent checkpoint: T1 commit `1a2289c`. The owner now authorises a local E1/T13 checkpoint; resolve the delivery SHA from Git. Earlier sections record their then-uncommitted state. No push or live model benchmark was run.

## Current checkpoint: task authority and recovered containment

Full `scripts/check.ps1`: **92/92 Python tests, 0 skips, 67.654 s**, both visual methods included; exit 0. Node: **5 Gauntlet, 6 Scout, 7 Swarm** scenarios and portal validation passed. Eval selftest, **25 installation rows** and graph **511 nodes / 92 edges / 5 proposals / 0 errors** passed. Log: `%TEMP%/omniharness-task-authority.log`. The additional installer regression test verifies dry-run, removal of only the blanket Git-commit ask, preservation of specific amend/push/other rules and backup integrity; it was red before implementation and green afterward.

Live Docker probe: **12/12 checks, 1.297 s, exit 0**, engine 29.6.2, official Python image pinned by digest. Evidence with source hash: `../experiments/sandbox-containment-2026-09.json`; runnable `python -m harness.sandbox_probe` command and limits in [ACCOUNTING.md](ACCOUNTING.md). This separately verifies a real offline process profile; it does not claim a native agent/model session already uses that profile.

Docker recovery preserved socket-only directories instead of deleting data; no credentials were read or factory reset performed. First public image pull failed EOF; second succeeded. Settings migration backed up to `.claude/settings.json.pre-omniharness-6`. Native Codex/Astra allowance agents and local task commits have standing authority; external additional-charge services retain their own approval scope. The hard-block Bash guard was not removed because neither retired restriction is implemented there.

## S3 continuation after Claude: current evidence

Final `scripts/check.ps1`: **91/91 Python tests, zero skips, 63.981 seconds**, including both visual methods; exit 0. Node: **5 Gauntlet, 6 Scout, 7 Swarm scenarios** and portal validation passed. Eval selftest and all **25 installation rows** passed. Graph: **511 nodes, 92 edges, 5 pending proposals, 0 errors**. Log: `%TEMP%/omniharness-t13-s3-accounting.log`. `git diff --check` passed; the guard has no diff against restored HEAD. No source change followed this full battery; only evidence/handoff documentation was completed.

The additional 16 Python methods comprise Claude's four guard tests, six durable-accounting tests and six real-worktree tests. They cover concurrent reservation admission, reopen/restart persistence, whole-tree token categories, failed/unknown/over-cap usage, immutable/idempotent settlement, unique sessions, unstarted cancellation, distinct checkouts, dirty-source refusal, forged metadata, committed/staged/untracked/ignored/renamed paths and protected policy files. The staged-path test first failed when a working file restored to base hid the index diff; the audit now checks both independently. Temporary Git fixture commits occur only in disposable repositories, never this workspace.

Envelope tests were corrected after a red case showed assistant snapshot placeholders being treated as final tokens. The manual policy now shares the whole-tree parser. Node tests reject missing/failed isolation preflight before agent calls, reject unverified scope/OS evidence before integration, and release partial-wave reservations only while unstarted. All driver agents are fixtures; these scenarios are not live model/sandbox proof.

The initial reconciliation reproduced six failures and one error in 21 targeted tests after Claude restored the older settings. Preserved the Bash-only never-ask guard, restored auxiliary S4 hooks/read-only permissions and changed installer probes to its block-only contract. The final install uses backup `C:/Users/Yeonatan/.claude/settings.json.pre-omniharness-5` and the updated Swarm driver.

Real historical telemetry reread: seven local streams, six usable whole-tree aggregates, one unresolved. Known subtotal **1,311,288 tokens / US$2.857086 client-estimated**; billed dollars and complete history total remain unknown. Raw evidence was not edited and benchmark validity was not upgraded. Report: `../experiments/swarm-usage-2026-09.json`.

**Unpassed external acceptance:** Docker Desktop 4.85.0 could not initialize its inference runtime socket, and Windows refused a narrow backup rename. No image/container ran, no data was deleted/reset, and OS containment is not certified. Native Windows Claude sandboxing is unsupported; see [ACCOUNTING.md](ACCOUNTING.md). The standard battery has no skipped tests, but it does not include a successful OS/provider acceptance run. S3 live dispatch, E1 control isolation and B8/B9 remain blocked on those independent prerequisites.

## S4 continuation: final evidence

Final `scripts/check.ps1`: **75/75 Python tests, zero skips, 57.292 seconds**, including both visual methods; exit 0. Node: **5 Gauntlet, 6 Scout, 5 Swarm scenarios** and portal validation passed. Eval selftest, **25 installation rows** and the graph check (**511 nodes, 92 edges, 5 pending proposals, 0 errors**) passed. Log: `%TEMP%/omniharness-t13-s4.log`. `git diff --check` passed. The earlier 68-test record below belongs to the preceding slice.

Seven new Python methods cover history idempotence/context/expiry, changed file fingerprints, invalid/private URLs, malformed journal preservation, fixed hook commands, path/activation filters, timeout reporting and malformed input. Driver fixtures cover cold/warm reuse, distinct query IDs, same-line different findings, context mismatches, failed synthesis and malformed/incomplete lens verdicts. The Windows runner fixture now resolves platform discovery before mocking the model process, so it also works alone rather than depending on test order.

Measured deterministic fixture output:

```text
MEASURE scout offline: cold=4 warm=3 calls; reused=2
MEASURE gauntlet offline: cold=3 warm=1 calls; reused=1
```

These are simulated calls, not real tokens, dollars, elapsed model time or quality scores. No live benchmark or session approval was fabricated. The single-coordinator store/skill contract and hook coverage are in [SEEN.md](SEEN.md).

Installed updated Scout/Gauntlet driver copies and all three hook events. The installer preserved unrelated hooks and backed up settings to `C:/Users/Yeonatan/.claude/settings.json.pre-omniharness-4`. Direct JSON subprocess probes of the actual auxiliary scripts ran install/regress and layout/graph checks successfully. Regression output retains six **INCOMPARABLE** groups with no certified baseline; the hook labels command completion separately from baseline comparability. SessionStart/PostToolUse delivery by a live Claude host is still unverified, as is native Codex/Hermes hook parity.

Next dependency: implement and verify the provider-backed reservation/total-usage and worktree-isolation adapter for S3. Corrected B8/B9 measurements depend on it and on E1 live-control isolation; S4 does not close those gates. Portal S6 and T13 closure S7 remain downstream.

## Completed checks

- Red/green CLI tests for the session menu, explicit approval, identity/scope/expiry, three modes, hard stops, budget warning/exhaustion, unknown/stale usage, malformed input, Windows/native-file hook payloads, mode replacement and transcript snapshot deduplication. Directory-wide content searches and escaping globs require a decision.
- Red/green routing tests for provenance-qualified costs, missing prerequisites, exclusion of proposed alternatives, the failed second step in all modes, milestones, unknown cost and bounded attempts; the plan CLI runs against a fixture.
- `python -m unittest tests.test_envelope tests.test_layout tests.test_skills_graph`: **28 passed**, 0 skipped, 9.844 seconds after the final local policy changes.
- Node: **3 Gauntlet, 5 Scout and 5 Swarm scenarios**, plus portal validation, passed. The Swarm scenarios cover dependencies/worktree requests, overlap/cycle rejection, integration/review, conflicts, missing/over-cap accounting, losing candidates, empty tests and milestones. These are fake-agent checks, not live host evidence.
- Eval runner selftest passed. User-scope install: **23 rows passed** (15 links, 3 drivers, 3 permission lists, canonical hook, local decision probes). Graph: **511 nodes, 92 edges, 5 pending proposals, 0 errors**. Existing scanner/test unclosed-file warnings were fixed in the touched code.
- User settings preserved at `C:/Users/Yeonatan/.claude/settings.json.pre-omniharness-3`. Swarm junctions and driver installed; unrelated hooks kept their original matchers. No real workspace envelope created.

## Full battery: completed after owner autonomy amendment

The initial full `scripts/check.ps1` attempt discovered **66 tests**, skipped **0**, and failed after 56.422 seconds: only the two visual methods failed, with five failure records (four viewport/theme subtests and the interaction test). Chromium reported `net::ERR_NETWORK_ACCESS_DENIED` when loading the portal's Google Fonts. This was not marked as a pass, and assertions/fonts were not removed or substituted. Two further local regression tests were added and passed.

The bundled skill-creator's additional `quick_validate.py` initially could not import PyYAML. Automatic approval review rejected installation and font-network access for lack of specific approvals. The owner then explicitly authorised reducing repeated confirmations and configuring the policy. AGENTS.md now records task-scoped authority for necessary dependencies/public test assets; the normal escalation mechanism accepted both actions under that updated authority. PyYAML **6.0.3** was installed in the selected Python. No sandbox or native permission control was disabled.

Final `scripts/check.ps1`: **68/68 Python tests passed, 0 skipped, 62.544 seconds**, including both visual methods. All Node suites, eval selftest, 23 installation rows and the graph check also passed; the command exited 0. The final log is `%TEMP%/omniharness-t13-verified.log`.

The additional bundled skill validator passed for Swarm after its compatibility information was moved into `metadata`: that validator accepts fewer top-level fields than the portable Agent Skills specification. The information was preserved; neither validator nor test assertions were weakened. Both repository skill-layout checks passed after this metadata change, and `git diff --check` is clean. Validation is complete for this local slice; the live-host limitations below remain open.

## Scope limits

Configuration and local JSON probes do not establish actual interception in a live host. Codex/Hermes remain manual policy adapters. S3 refuses paid work until a trusted host enforces reservations and reports total actual usage; its installed driver is not a certification of that missing adapter. No B8/B9 result, live isolation proof or evolutionary improvement is claimed.
