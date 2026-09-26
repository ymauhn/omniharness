# OmniForge — lean swarm plan (1–2 days)

Owner-approved direction, 2026-09-26. Start from branch `claude/v1-audit-2026-09-26` (see [HANDOFF-PAUSE](HANDOFF-PAUSE-2026-09-26.md)). This plan replaces the V1 contract sequence for now; the contract stays as the long-term reference, not as today's gate.

## Goal and decisions

**Goal:** a useful Windows-first agent OS with the **engine on**: a task in the Lab runs a real Claude Code or Codex session in its own git worktree, shows live status, and ends with a reviewable diff, merge and an evidence bundle. Clean, practical code is a top criterion.

| Decision | Choice |
|---|---|
| Base | **Keep our Lab** (Node + xterm.js + node-pty, the same stack as MulmoTerminal). Copy modules/patterns from open projects instead of forking one. |
| Differentiators | All three: proof of work (evidence bundle + Gauntlet on demand), mascot + Prompt Copilot, PT-BR skills library. |
| Memory | Keep the versioned scoped memory. |
| Offer | The OS is free and acts as the lure; services/library come later. Landing is redone after the offer is decided. |
| Cut from the UI for now | Arsenal UI, JEV key flow, E2/genetic pilot work, pillar 3/5 expansion (already-delivered slices stay in the repo). |
| Laya/JEV | Optional **System-1 router** seam only (package W6), because it is already built and both speak the same wire protocol. Not on the critical path. |
| Managed isolation | Stays closed. The engine runs **interactive native sessions** under the owner's own login (owner-local use). A distributed product must use API-key authentication for Claude automation. |
| Languages | No C++/Java. TypeScript/JavaScript for the Lab, Python for harness/evals. A native helper, if ever needed (Windows Job Object), would be a tiny Rust or C# binary. |

## Reuse map (respect each license; keep attribution in a NOTICE file)

| Need | Take from | License |
|---|---|---|
| Live agent status grid, worktree per session, cost panel | [MulmoTerminal](https://github.com/receptron/mulmoterminal) | MIT |
| Status via native agent lifecycle hooks, issue intake pattern | [Emdash](https://github.com/generalaction/emdash) | Apache-2.0 |
| Diff viewer with inline comments, one-click merge | [parallel-code](https://github.com/johannesjo/parallel-code) | MIT |
| Plan/Build modes, worktree lifecycle UX | [Jean](https://github.com/coollabsio/jean) | Apache-2.0 |
| Optional terminal runtime/persistence via socket API | [Herdr](https://herdr.dev/docs/socket-api/) | Apache-2.0 (Windows beta) |
| Do **not** fork | Superset (Elastic 2.0, no resale), OpenChamber (OpenCode-only), T3 Code (early, heavy build) | — |

## Token policy

- The OS itself adds **no model calls**: status from hooks/process events, usage read from the CLIs' own session files, marked observed or unknown.
- Gauntlet and any review runs **only when the user clicks it**.
- Building this plan: implementers on a mid-tier model for mechanical packages; **one** independent review per package at the end (not two per slice, no reconciliation loop unless the review finds a real defect). Deterministic tests are the main gate.

## Skills to load when coding

`ponytail` (always on) and `ponytail-review` before merge; `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion`; `mattpocock-skills:codebase-design` for W1; `/code-review` and `/security-review` once at the end. DevOps (W7 CI): candidate [akin-ozer/cc-devops-skills](https://github.com/akin-ozer/cc-devops-skills) (GitHub Actions/Dockerfile/Bash generator+validator pairs); install only after the repository's intake scan (`_intake/`, read every file) and the owner's OK.

## Work packages (disjoint file scopes; one worktree each)

**Wave 0 (serial, first — everything builds on it)**

- **W0 Cleanup.** One durable-write helper per language (`omniforge-lab/lib/fsutil.mjs`, `harness/fsutil.py`) replacing the copies in core/extensions/key-vault/manage and the harness modules; remove the dead `ShellCoordinator` and move its two tests to `PtyCoordinator`; list every removal in the PR body. *Accept:* full Lab + Python suites green, no behaviour change.

**Wave 1 (parallel after W0)**

- **W1 Front-end modules.** Split the inline `index.html` script into `omniforge-lab/app/*.mjs` (state/api, workspace+terminals, tasks, graphs, forms); tests import modules instead of slicing HTML. *Accept:* no line > 200 chars in app code; E2E 15/15 unchanged.
- **W2 Engine.** `omniforge-lab/engine.mjs` + route `POST /api/tasks/:id/run {host}`: create a git worktree/branch for the task, open a PTY session in it running `claude` or `codex`, bind it with `assignTask`; install/refresh native status hooks (Claude Code `hooks` → local POST with the token; Codex `notify`) and map events to `working/blocked/idle/done`; read token usage from the CLIs' session files after exit (`~/.claude/projects/**.jsonl`, `~/.codex/sessions/**`), reusing `harness/claude_native.py`/`codex_accounting.py` parsers where they fit. *Accept:* a real one-line task on a scratch repo runs in each host, status changes are visible, usage is shown or explicitly unknown.
- **W3 Review & merge.** Per-task diff (base…branch) with file list and inline view, "Aprovar e fazer merge" (refuses on conflicts or failing test command), and an **evidence bundle** saved on the task: test command + exit code + output hash, diff stat, usage receipt, reviewer note. *Accept:* E2E covers diff → merge and a refused merge.
- **W4 Fleet board.** Status grid of running agents (colour by state, blocked first, desktop notification on blocked/done) and kanban columns from task status. *Accept:* E2E with a fake agent process driving states.

**Wave 2 (parallel after W2/W3)**

- **W5 Gauntlet on demand.** Button on a task that runs the existing Gauntlet skill against the task diff in a native session and stores its findings in the evidence bundle. *Accept:* disabled until a diff exists; cost shown as observed/unknown.
- **W6 System-1 router (optional).** Use the existing Laya worker / JEV adapter (same protocol) to *suggest* host and skill for a new task; abstain falls back to lexical; show latency. *Accept:* offline tests only; never auto-dispatches.
- **W7 Docs + CI.** README (what it does, install, run), ARCHITECTURE (one page), STATUS (what works/what is closed); move journals to `docs/archive/`; a GitHub Actions workflow running the Lab + Python suites on Windows. *Accept:* README quick start works on this host.
- **W8 Honest mini-benchmark (day 2).** 10 small real tasks from this repo, with and without Gauntlet, reporting pass rate, wall time and observed tokens, including failures.

## Validation and stop rules

Per package: focused tests first (red before green), then `npm --prefix omniforge-lab test` and `python -m unittest discover tests` with **zero skips**; E2E for UI packages. Before merge to `master`: full `scripts/check.ps1`, one `/code-review`, `ponytail-review`. Never merge `site/public/**` without the owner's publication decision. Stop and report if a package needs a new paid service, credentials, or a change to managed-admission gates.
