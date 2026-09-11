# detour

A bounded excursion from the main path: three alternatives from three worlds, each with a viability test and a cost, one verdict, then back. The skill is `.agents/skills/detour/`; it is portable and needs no tool beyond reading local files.

## What it does

Given a decision or a plan step, in one response: the main path and its success criterion in one line each; exactly three detours, each from a different world (a physical object or place, a screen or document tradition, a ritual or procedure), each with `Reframe`, `Changes`, `Viability test`, `Cost`; a verdict that recommends at most one or says the main path stands; and, when a PLAN.md exists, the round appended under `## Detours considered` with the routine untouched.

## When to reach for it

- A step whose obvious answer is the category default and nobody has looked sideways.
- A dossier from `scout` that shows two or more viable routes.
- A decision the owner keeps postponing because every option looks the same.

Not for: brainstorming without a bar (it stops and asks for the success criterion), research (no network inside a detour), execution (nothing is built).

## Bounds, and why

No WebFetch, WebSearch, subagents or installs inside a detour: the point is a cheap round that costs one response, so the owner can afford to ask for it often. Exactly three detours: fewer is a hunch, more is a list nobody reads. One round: a second detour on the same decision is a new command, so the excursion never turns into a loop. The routine in PLAN.md is never edited by a detour: adoption is the owner's act.

## Benchmark

`evals/cases/detour-bounded/`: a fixed decision (a members area for a static site with no backend) sent to a harness arm with the skill and a control arm without it. The grader checks the structure (three detours, each with a viability test, one verdict) and the bounds (no network tool calls, no subagents, at most six turns). The control arm passes only when it fails those checks, otherwise the benchmark reports itself invalid. Numbers in `docs/benchmarks.md`, B5.

## It's working if

- `python -m unittest tests.test_layout` passes (six spec fields plus `disable-model-invocation`, with `agents/openai.yaml` beside it).
- `/detour <decision>` returns three detours with viability tests and one verdict, without a single tool call that reaches the network.
- `python evals/run.py run detour-bounded --arm harness` records `pass: true`.
