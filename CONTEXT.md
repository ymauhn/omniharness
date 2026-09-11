# CONTEXT

Domain terms used in prompts, code and docs. Decisions live in `docs/adr/`; the audit that produced them in `docs/PHASE0_AUDIT.md`.

- **Layer.** One of the six seams: steering and memory, execution, academic, ingestion, multimodal, security and growth. Layers are routing rows in AGENTS.md, not directories.
- **Skill.** A directory with a SKILL.md under `.agents/skills/`, six spec fields only, progressive disclosure: description at startup, body when invoked, references by phase.
- **Adapter.** A host-specific piece (a Workflow script, a hook, a settings fragment) under `gauntlet/` or `harness/`, installed by `scripts/install.py`.
- **Gate.** The human confirmation required before any network or credit action. Enforced by the ask list in `harness/settings.json` and the hard blocks in `harness/guard_bash.py`.
- **Gauntlet.** Hunt, refute, report. A *hunter* is one agent per area that must execute an experiment. A *lens* is one refuter perspective. A finding survives when refuters are a strict minority; a tie is refuted.
- **jaVistos.** The seed of already-known findings (`file:line — title`) passed back so a rerun does not hunt them again. **regras** are owner rules: violating one raises severity; items the owner already decided never resurface.
- **Parecer.** A numbered review (`C6-1`, `C6-2` …) the author answers item by item. A **verdict** is the author's number plus decision.
- **Checkpoint.** `git tag ckpt/<case>/<ts>` on `git stash create || HEAD`, created before any paid run.
- **Ring.** One of the three sources of the skills graph: *installed* (SKILL.md files the hosts read), *catalog* (the marketplace manifest and `docs/catalog/` tables, on disk), *remote* (a dated snapshot of the awesome lists, fetched behind the gate). A *missing* node is an edge endpoint this machine lacks.
- **Edge.** A typed link between two skills: `calls` (parsed from SKILL.md), `precedes`, `feeds`, `alternative-to`, `guided-by` (curated in `skills-graph.toml`), `candidate-for` (a proposal). A **proposal** is a learned edge in `proposals.jsonl` waiting for the owner's `approve`.
- **Dossier.** What `scout` writes after the fan-out: references with URL, why they matter, the pattern each shows; then patterns, gaps and recommendations. A **routine** is PLAN.md's numbered list of steps, each naming the installed skill that runs it. A **detour** is one bounded round of three alternatives from three worlds, with a verdict, never a change to the routine.
- **Arm.** One configuration of a benchmark run: the harness arm carries AGENTS.md and the gate; the control arm is a bare project. A **baseline record** is one JSON file per run in `evals/results/`.

## Where do I look

| Question | Place |
|---|---|
| What rules does the agent read? | `AGENTS.md` (`CLAUDE.md` imports it) |
| The Gauntlet driver and its skill | `gauntlet/` (Claude-only; installed to `~/.claude/workflows/gauntlet-driver.js` and `~/.claude/skills/gauntlet-loop`) |
| Demand to plan | `.agents/skills/scout/` (skill, sources), `scout/scout.workflow.js` (driver, installed as `scout-driver`), `.agents/skills/detour/`; plans in `<repo>/docs/scout/<slug>/` |
| The gate | `harness/settings.json`, `harness/guard_bash.py` |
| The academic layer | `.agents/skills/thesis-review/` (SKILL.md, `scripts/thesis_checks.py`, `references/`) |
| Which skill does what, and what is missing | `docs/skills-graph/` (snapshot, README), `.agents/skills/skills-graph/` (script, curated TOML, proposals) |
| Benchmarks | `evals/run.py`, `evals/cases/*`, `evals/results/`; zero-token tests in `tests/` |
| Optional tools | `docs/integrations/` (one page each, with the gate), `recipes/` (tutorials), `docs/catalog/` (free tiers, community skills, MCP servers) |
| Installing on a new machine or host | `docs/install.md`, `scripts/install.py` |
| Why things are this way | `docs/PHASE0_AUDIT.md`, `docs/adr/` |
