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
- **Arm.** One configuration of a benchmark run: the harness arm carries AGENTS.md and the gate; the control arm is a bare project. A **baseline record** is one JSON file per run in `evals/results/`.

## Where do I look

| Question | Place |
|---|---|
| What rules does the agent read? | `AGENTS.md` (`CLAUDE.md` imports it) |
| The Gauntlet driver and its skill | `gauntlet/` (Claude-only; installed to `~/.claude/workflows/gauntlet-driver.js` and `~/.claude/skills/gauntlet-loop`) |
| The gate | `harness/settings.json`, `harness/guard_bash.py` |
| The academic layer | `.agents/skills/thesis-review/` (SKILL.md, `scripts/thesis_checks.py`, `references/`) |
| Benchmarks | `evals/run.py`, `evals/cases/*`, `evals/results/`; zero-token tests in `tests/` |
| Optional tools | `docs/integrations/` (one page each, with the gate), `recipes/` (tutorials), `docs/catalog/` (free tiers, community skills, MCP servers) |
| Installing on a new machine or host | `docs/install.md`, `scripts/install.py` |
| Why things are this way | `docs/PHASE0_AUDIT.md`, `docs/adr/` |
