# Handoff: continuing OmniHarness on Codex

Written 2026-09-11 at the close of the Claude Code session that built portal v3.1. The next session runs on Codex; it is also the harness's host-portability test, so every divergence is a finding to record (T1), not something to paper over.

## Where we are

- Repository: https://github.com/ymauhn/omniharness, branch `master`, clean tree at the handoff commit (see `git log -1`). Public portal live at https://ymauhn.github.io/omniharness/ (GitHub Pages, `.github/workflows/pages.yml` deploys `site/public` as committed). Members edition: a private claude.ai artifact the owner shares (`site/showcase/log.md` records the URL); it stays as a mirror until ticket T12.
- Done: five invariants and the plan gate rule (`AGENTS.md`); skills `skills-graph`, `scout`, `detour`, `skill-installer`, `omniharness`, `thesis-review` in `.agents/skills/`; the Gauntlet driver and the scout driver as Claude-only adapters; benchmarks B1–B5 recorded in `docs/benchmarks.md`; portal v3.1 (collider event display, force-graph, Geist type, PT-BR/EN switch, theme toggle, authors placeholders, logo) with the Playwright battery `tests/test_visual.py` and the record in `site/showcase/`.
- Decided, not built: the commercial phase. The owner answered the plan gate (`docs/commercial/grilling.md`); the spec is `docs/commercial/spec.md`; the tickets are `docs/commercial/TICKETS.md`. Two rounds: R1 authors, roadmap, library structure, Supabase Auth with the real member gate; R2 Asaas checkout, RLS on subscriptions, webhooks, restricted content. Ceiling 4 M tokens for both, report at the end of each round.
- Added 2026-09-14 (phase B, decided at D1-D5 in `docs/scout/context-ingestion/pre-scout.md`): the `prompt-enhancer` skill (spec `docs/scout/prompt-enhancer/spec.md`, tickets P1-P4) comes first and feeds T11; the `ingest` pipeline with two routes, export (default, offline, SQLite FTS5) and session (gated, cookies, a warning on every run) (spec `docs/scout/context-ingestion/spec.md`, tickets I1-I6); six repositories read and catalogued with edges (crawl4ai, claude-video, screenshot-to-code, archify, openmontage as a curated subset, orca as a reading); tickets O1 and A1 for the two intakes. No scout fan-out was run (D5).
- Open items the owner owns: authors' names, bios and photos; the Supabase project and the OAuth apps; the Asaas sandbox; the plan prices; the thesis-review expansion (roadmap only, by decision).

## Initialise and validate on Codex

1. Clone and enter the repository. Python 3.11 or 3.12 and Node 20 or newer are required; Playwright is optional (the visual tests skip without it; installing it is a gated `pip`).
2. Read, in this order: `AGENTS.md` (the rules; Codex reads it natively), `CONTEXT.md` (the vocabulary), `docs/commercial/spec.md`, `docs/commercial/TICKETS.md`.
3. Check the install, then adopt it into the user scope:

```bash
python scripts/install.py --check
```

```bash
python scripts/install.py --adopt
```

   On Windows the installer uses junctions; on Linux or macOS it is untested (the installer was written and measured on Windows 11). Whatever it prints that differs from `docs/install.md` goes into T1's report.
4. Run the zero-token battery and the eval self-test:

```bash
python -m unittest discover tests
```

```bash
node tests/test_driver.js
```

```bash
python evals/run.py selftest
```

   Expected: 33 Python tests (the 2 visual ones skip without Playwright), 3 driver scenarios PASS, selftest OK.
5. Activate the harness in the session: `$omniharness` (Codex) loads the rules for this session only, checks the install and reports regressions. It is opt-in per session; nothing is imported globally.
6. Rebuild the portal once to prove the toolchain: `python scripts/site_build.py --report` (needs ffmpeg on PATH for the downscaled captures; without it the build says so).

## What is different on Codex (known before the test)

- No Workflow tool: `$scout` runs its sources one by one with WebSearch instead of the `scout-driver` workflow (the SKILL.md says so); the Gauntlet loop (`gauntlet/`) is Claude-only and stays out of scope.
- No Claude hooks: `harness/settings.json` and `harness/guard_bash.py` do not run; the HITL list in `AGENTS.md` is the enforcement. Name the call and its cost, wait for the yes, every time.
- No impeccable plugin: build against `site/DESIGN.md` and `.impeccable/design.json`; the detector, critique, audit and finish reviewer run in a later Claude Code session, and each ticket's log entry says the pass is owed.
- Paths: the repo is Windows-first; a `.cmd` or a junction assumption that breaks is a T1 finding and a T3 roadmap row, not a silent fix.

## Start here

Ticket T1 (`docs/commercial/TICKETS.md`) is the parity check itself: run the steps above, write `docs/experiments/codex-parity-2026-09.md` with every divergence as a numbered list (command, output), and stop for the owner's yes before any fix wider than one line. Then, by the owner's D4, P1-P4 (`prompt-enhancer`) come next and can run in parallel with T2, T3, T4 and T5; T6 waits for T5's owner steps; I1-I6 (`ingest`) follow the prompt-enhancer; O1 and A1 when a session can afford an intake.

Rules that do not change with the host: the plan gate is already answered for this phase (`grilling.md`), so no new grilling round is needed unless a ticket's assumption breaks; the scout fan-out is optional and gated (about 450 k subagent tokens at the B4 measurement); commits and pushes only on the owner's say-so; reports carry measured numbers only; chat in the owner's language, harness docs in English.
