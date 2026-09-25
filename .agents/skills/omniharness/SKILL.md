---
name: omniharness
description: Activate OmniHarness in the current session, on demand. Loads the harness rules (AGENTS.md, CONTEXT.md), verifies the user-scope install and the gate, reports drift or benchmark regressions, and offers the install when something is missing. Use when the user says "omniharness", "activate the harness", "load the harness rules", or wants a session to follow the OmniHarness rules. Not needed for ordinary work; the rules are opt-in per session.
license: MIT
compatibility: Python 3.12+ on the host for scripts/install.py and evals/run.py. Invoked as /omniharness on Claude Code, $omniharness on Codex, or by name on Hermes.
metadata:
  version: "0.2.0"
  layer: steering
---

# omniharness

One command that turns a fresh session into an OmniHarness session. The owner's task approval covers its routine supporting setup and validation under AGENTS.md; check that existing authority before asking again. The menu records additional bounded session/model authority and never invents an owner answer.

## Where things are

This file lives at `<root>/.agents/skills/omniharness/SKILL.md`; the repository root is three directories up. When the path shown at load time is a junction under `~/.claude/skills` or `~/.agents/skills`, resolve it: the root is the directory that contains `AGENTS.md`, `gauntlet/`, `harness/` and `evals/`. On the reference machine it is `C:/Users/Yeonatan/master_team`.

## Steps

1. Read `<root>/AGENTS.md` in full and `<root>/CONTEXT.md`. From this point they bind the session: the five invariants, the routing table, the HITL gate, deletion as triage, the way of working with the owner.
2. Run `python <root>/scripts/install.py --check` and show its rows. If any row is FAIL, run `--dry-run` and show the plan. Apply routine updates already covered by the owner's task; ask only for new scope or unresolved conflicts (`--adopt` only for authorised renames). Never treat an unrelated capability installation as an ordinary task dependency.
3. Run `python <root>/evals/run.py regress`. Print its lines if there are any: a `REGRESSION` line is the trigger to recommend a Gauntlet cycle (invariant 4); recommend it, do not start it.
4. Run `python <root>/.agents/skills/skills-graph/scripts/skills_graph.py route "<the owner's task, or the repository's obvious jobs>"` once (zero tokens). The words come from the task if the owner gave one, otherwise from what the repository shows (tests, a `.tex` with result CSVs, a frontend, a `.claude/gauntlet-loop.json`). Keep the top installed rows; catalog rows are candidates that need intake, not tools for this session.
5. Report rules, install, gate probes, regressions and relevant routes. Distinguish a configured/tested hook from verified interception by the running host. On Codex/Hermes apply the policy manually; no native hook parity is claimed.
6. For an explicit activation or mode request, run `python <root>/harness/envelope.py menu --root <project>` and offer its modes: Balanced (recommended), Swarm, Strict; US$2 default, 80% warning, separate optional token ceiling, paths, hosts, installs and four-hour expiry. Ask one concise round for the owner's selection and scope. Do not write approval before the answer or interrupt already authorised routine work merely to create an envelope. The plan gate remains separate. No universal USD/token conversion.
7. After the explicit answer, run `python <root>/harness/envelope.py start --root <project> --session-id <actual-host-session-id> --approval-reference <owner-message-reference> --mode <mode>` with the approved budget, scope, host/install flags and the actual host transcript via `--transcript` when available. Do not invent a session id, message reference or usage. If the host exposes no stable id, remain Strict and explain the missing binding. Display the recorded envelope. Missing cost evidence prevents certification of budgeted network/model calls.

`mode <name>` repeats the approval round with the new complete scope and uses `start --replace` to archive the old envelope. Never widen it silently. `status` runs the checks above plus `envelope.py status --root <project> --session-id <id>`. `explain` sends a proposed host-shaped request as JSON on stdin to `envelope.py explain --root <project>`: it evaluates/logs but never executes. Exit 0=allow, 3=ask, 2=deny. In Codex/Hermes, call this boundary before gated work and honour the result plus the host sandbox. Read `<root>/docs/t13/README.md` for formats and limitations.

If the user wrote `setup`, walk through `<root>/docs/install.md` for a new machine instead of step 2, within the owner's existing authorization.

## What this skill never does

Write to `~/.claude/CLAUDE.md`. Commit. Delete. Run a paid benchmark. Change `AGENTS.md`.
