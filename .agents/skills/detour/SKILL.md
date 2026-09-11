---
name: detour
description: Bounded lateral thinking for a stuck decision or a plan step with an obvious answer that might be the wrong one. One round, no network, no installs, no agents. Produces exactly three detours from three different worlds, each with a one-line viability test and its cost, then recommends at most one or says the main path stands. Command only, /detour on Claude Code and $detour on Codex; never triggered by a loose phrase; scout calls it when a dossier shows more than one viable route.
license: MIT
compatibility: Any host; reads local files only. No tools that spend credits or reach the network are allowed inside a detour.
metadata:
  version: "0.1.0"
  layer: steering
disable-model-invocation: true
---

# detour

`/detour <the decision, or the plan step and why it feels stuck>` on Claude Code, `$detour` on Codex, by name on Hermes. Arguments in `$ARGUMENTS`. When called from `scout`, the input is the dossier's competing routes and the demand. Hermes has no `disable-model-invocation`; the description's "command only" sentence is the guard there.

A detour is a bounded excursion: one response, then back on the main path. It exists because the first workable answer is often the category default, and the harness would rather see two alternatives and reject them than never see them.

## The round

1. **Main path and bar.** One line each: the main path as it stands (from PLAN.md, the surface brief or the owner's words) and the success criterion it must meet. No bar written down means the detour cannot be judged; ask for it in the same message and stop.
2. **Three detours, three worlds.** Exactly three, each from a different world than the main path and than each other: a physical object or place, a screen or document tradition, a ritual or procedure people already follow. For each, four lines: `Reframe` (the decision seen from that world, one sentence), `Changes` (which routine steps it alters, adds or removes), `Viability test` (one cheap check the owner can run in minutes, with the observation that would kill the detour), `Cost` (tokens, time, gate entries it would touch, what it depends on that is not installed). A detour that needs an install or a key says so in `Cost`; it is not run here.
3. **Verdict.** Score each detour on two axes only, fit to the success criterion and cost, and recommend at most one, or write `Verdict: the main path stands` with the reason. No merging of detours into the main path "just a little": a detour is adopted whole by the owner or not at all.
4. **Back on the path.** If a PLAN.md exists, append the round under `## Detours considered` (date, the three detours in one line each, the verdict) and change nothing in `Routine`. Otherwise print the block. Stop. A second detour on the same decision needs a new command.

## Bounds

Inside a detour: read local files, nothing else. No WebFetch, no WebSearch, no subagents, no Bash that installs, fetches or deletes, no edits outside the `Detours considered` block. One round; no follow-up questions except the missing success criterion. Exactly three detours; more is a list, fewer is a hunch.
