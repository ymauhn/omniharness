# skill-installer

The intake and installation routine, as a skill: `.agents/skills/skill-installer/` with `scripts/skill_installer.py` and the manifest `installers.toml`. It exists so that "prepare the environment" is a plan the owner reads and approves, not a series of commands an agent improvises.

## What it does

`plan <tool>` probes the machine at zero network and prints one row per step: `OK` (the probe says it is done), `TODO` (runnable, with the exact command and the AGENTS.md gate entry that fires), `WAIT` (blocked on an environment variable the owner has not set), `YOU` (owner-only: a key to create, a binary to download after checking its signature). `apply <tool> --yes` runs the `TODO` rows in order, logs each command and exit code to `install-log.jsonl`, and stops at the first failure; without `--yes` it refuses. `env` lists every variable the manifest mentions as set or missing, names only. `register <tool>` appends a `[[node]]` to `skills-graph.toml` with the measured status (`installed`, or `partial (n/m steps)`), so the graph knows the tool as a whole even when it has no SKILL.md.

Probes: `plugin:<name>` (installed_plugins.json), `marketplace:<name>` (known_marketplaces.json), `mcp:<name>` (`~/.claude.json` and `.mcp.json`), `env:<VAR>`, `path:<exe>`, `file:<glob>`, `manual` (never auto-satisfied).

## The manifest

One table per tool: kind, url, license, `graph_id`, `env`, and `steps`. A step has `id`, an optional `run`, a `check`, an optional `gate`, `requires_env`, `owner_only` and `note`. The three shipped entries:

| Tool | Steps | Owner-only |
|---|---|---|
| impeccable (Claude plugin) | marketplace add, plugin install | the launcher's binary (`universal.zip`, 15.6 MB, signed `.sig.json` on the release) |
| magic-mcp (21st, hosted MCP) | `claude mcp add --transport http --scope user 21st ... --header "x-api-key: $API_KEY_21ST"`, a manual smoke test | the key, free Builder plan at 21st.dev/mcp |
| skill-scanner (pip) | `pip install cisco-ai-skill-scanner` | none |

Intake findings recorded before the impeccable entry was written (2026-09-10): `.claude-plugin/plugin.json` declares one skill directory and no hooks; the design detector hook is opt-in through `/impeccable hooks on`; the launcher downloads a signed binary on first `impeccable context`; Apache-2.0.

## When to reach for it

A PLAN.md gap names a catalog tool; the owner says "install X" or "which keys are missing"; a recipe reaches a `STOP: confirm` install line and you want the plan in one screen.

Not for: a tool with an unread manifest (intake first), anything with a credential (the owner does it), a binary download (the owner does it after checking the signature).

## It's working if

- `python -m unittest tests.test_skill_installer` passes (synthetic home: probes, plan, refusal without `--yes`, apply, register).
- `plan impeccable` on a fresh machine prints two `TODO` rows with `STOP: confirm` and one `YOU` row.
- `apply` without `--yes` exits 1 and runs nothing.
- After `register`, `skills_graph.py build` shows the tool's node with its status.
