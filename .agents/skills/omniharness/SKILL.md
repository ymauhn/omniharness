---
name: omniharness
description: Activate OmniHarness in the current session, on demand. Loads the harness rules (AGENTS.md, CONTEXT.md), verifies the user-scope install and the gate, reports drift or benchmark regressions, and offers the install when something is missing. Use when the user says "omniharness", "activate the harness", "load the harness rules", or wants a session to follow the OmniHarness rules. Not needed for ordinary work; the rules are opt-in per session.
license: MIT
compatibility: Python 3.12+ on the host for scripts/install.py and evals/run.py. Invoked as /omniharness on Claude Code, $omniharness on Codex, or by name on Hermes.
metadata:
  version: "0.1.0"
  layer: steering
---

# omniharness

One command that turns a fresh session into an OmniHarness session. Nothing here is automatic: the rules bind only after this skill has run, and the installer only runs after the owner says yes.

## Where things are

This file lives at `<root>/.agents/skills/omniharness/SKILL.md`; the repository root is three directories up. When the path shown at load time is a junction under `~/.claude/skills` or `~/.agents/skills`, resolve it: the root is the directory that contains `AGENTS.md`, `gauntlet/`, `harness/` and `evals/`. On the reference machine it is `C:/Users/Yeonatan/master_team`.

## Steps

1. Read `<root>/AGENTS.md` in full and `<root>/CONTEXT.md`. From this point they bind the session: the five invariants, the routing table, the HITL gate, deletion as triage, the way of working with the owner.
2. Run `python <root>/scripts/install.py --check` and show its rows. If any row is FAIL, run `--dry-run`, show the plan, and ask before running the install (`--adopt` only when the plan lists renames). Never install unasked.
3. Run `python <root>/evals/run.py regress`. Print its lines if there are any: a `REGRESSION` line is the trigger to recommend a Gauntlet cycle (invariant 4); recommend it, do not start it.
4. Report in at most five lines: rules loaded; install state; gate state (`~/.claude/settings.json` carries the ask list and the guard hook; they bind every session started after the merge, so they are active in this session unless the install ran a moment ago); regressions; the routing rows that matter for the repository the session is in (tests present? a `.tex` and result CSVs? a `.claude/gauntlet-loop.json`?).
5. Stop and wait for the owner's task.

If the user wrote `status` after the command, do steps 2 to 4 only. If the user wrote `setup`, walk through `<root>/docs/install.md` for a new machine instead of step 2 (prerequisites, junctions, hosts, verification), still asking before every write.

## What this skill never does

Write to `~/.claude/CLAUDE.md`. Commit. Delete. Run a paid benchmark. Change `AGENTS.md`.
