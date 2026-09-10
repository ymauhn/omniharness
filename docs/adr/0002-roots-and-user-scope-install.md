# ADR 0002: `.agents/skills` and `gauntlet/` are the roots; install is user-scope by junction

Date: 2026-09-10. Status: accepted.

## Context

Codex reads `.agents/skills` in a repo and `$HOME/.agents/skills` for the user; Cursor reads the same; Hermes accepts any directory through `skills.external_dirs`; Claude Code reads `~/.claude/skills` and `.claude/skills` and follows symlinks at the skill-name level (the higgsfield skills on the audited machine are symlinks). The Agent Skills specification admits six frontmatter fields. The gauntlet driver is a Claude Workflow script with a named registry that only reads `*.js` from `~/.claude/workflows` or `<repo>/.claude/workflows`; it has no equivalent in Codex or Hermes. The harness is used from other repositories, not from its own checkout.

## Decision

Portable skills live in `.agents/skills/<name>/` with the six spec fields only (enforced by `tests/test_layout.py`). The Claude-only pair (skill plus driver) lives in `gauntlet/`. `AGENTS.md` is the canonical instructions file; `CLAUDE.md` is the documented one-line import `@AGENTS.md`, so there is no second copy to drift. `scripts/install.py` links at user scope: junctions from `~/.claude/skills/<name>` and `~/.agents/skills/<name>` to the repo, a junction from `~/.claude/skills/gauntlet-loop` to `gauntlet/`, and a byte-compared copy of the driver into `~/.claude/workflows/gauntlet-driver.js`. It prints the lines the owner adds by hand to `~/.claude/CLAUDE.md` and to Hermes' `config.yaml`, and never writes those files. An existing target that differs is renamed with a `.pre-omniharness` suffix only under `--adopt`; otherwise it is listed for triage and the installer exits 1.

## Consequences

No skillkit and no manifest until the repo is published as a plugin; three hosts need three links, not a tool. `vercel-labs/skills` is the fallback installer if one is ever wanted. Nothing lives under a repo-level `.claude/`.
