# Claude changes and S3 continuation

Inspected 2026-09-21 on `C:/Users/Yeonatan/master_team`. Local `master` still points to T1 `1a2289cd69ba48685a5f131563e20cf4a9591a90`; E1/T13 remain dirty and unstaged. No new local delivery commit was found. Read-only fetch updated remote refs; no merge, checkout, reset, stash application or real-repository commit occurred.

## What Claude changed

1. `fix/guard-never-asks` / `7a9b4386cab33a4f9bac9313860c5deb132a7b0f` adds a regression contract: PreToolUse is Bash-only, the guard blocks explicitly destructive input but never asks, and malformed input defers to native permissions. The current source guard is identical to the restored original. The prior all-tool envelope guard/settings remain in stash `8105be6`; preserve it.
2. Restoring settings also removed this working delivery's narrow allow entries and S4 auxiliary hooks. Targeted tests reproduced six failures and one error across 21 tests. Reconciliation retains the guard, restores only those auxiliary controls, ports Claude's guard test into the dirty package, and updates installer/manual-envelope tests. This is not a cherry-pick of the remote branch or a recreation of the previous asking hook.
3. `origin/master` at `90534e4` contains merged Phase C planning from `caf9a13`: device-lab, video-read and video-forge. `origin/claude/omniharness-screen-control-skill-5es5ni` at `28d2096` adds D4 verification/integration documentation. These are planning/reference changes, not installed runtime skills. The D4 report's own counts are 17 agents, 86 pages, six failed fetches and 143/175 supported claims; this session did not rerun that research. Local master is one commit ahead and two behind origin/master.

## Effect on the agreed plan

The guard amendment removes repetitive native asking; monetary policy moves to the coordinator/manual envelope. Do not silently restore the stashed interception design. Native permission lists and hard blocks stay authoritative.

The new device/video plans reinforce the need for per-attempt accounting, budget caps and isolation, but remain behind R1/T13 in their own plan. Their remote additions should be integrated through a reviewed merge after checkpointing the dirty local delivery, under the owner's commit request. No plan direction or runtime source was imported merely because it appeared remotely.

This continuation implements the next local S3 slice: SQLite atomic reservations with failed/unknown attempt handling; final whole-tree telemetry parsing; pinned real Git worktrees and audits of committed, staged, working, ignored and renamed paths; driver preflight and post-worker verification. The envelope shares the corrected parser. See [ACCOUNTING.md](../t13/ACCOUNTING.md), the [historical usage reread](swarm-usage-2026-09.json) and [validation](../t13/VALIDATION.md).

## Host changes and limitations

The installer updated the Swarm driver and restored the three hook events with pinned Python 3.12.14. Settings backup: `C:/Users/Yeonatan/.claude/settings.json.pre-omniharness-5`. No new package was necessary for this slice. Native Claude delivery is not inferred from direct script probes.

Docker Desktop 4.85.0 was already installed but stopped. A hidden start failed before the Linux engine became available, at the existing `Docker/run/dockerInference` socket. Windows refused an exact backup rename of that object. No Docker data/socket was deleted, no factory reset performed, and no image/container/model was run. Docker queries used an empty temporary client-config path, not credential-bearing Docker configuration.

OS containment and enforceable provider caps remain acceptance dependencies. Complete local tests do not make those checks pass. Next work must recover the runtime, prove containment of home/sibling/coordinator/network access, then wire the provider executor. Preserve B8/B9 and evolutionary claims until that evidence exists.
