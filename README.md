# OmniHarness

A reproducible, multi-agent harness for Claude Code, Codex and Hermes. It gives one repository of portable skills that all three hosts read, a human-in-the-loop gate for anything that spends money or touches the network, an on-demand adversarial audit loop (the Gauntlet), an academic layer that audits and revises manuscripts against their result files, and benchmarks that can fail. The harness is used from other repositories, not from its own checkout: install once at user scope, then point any project at it.

## What you get

The five invariants from `AGENTS.md`, in plain words:

1. **Portable by default.** Skills live in `.agents/skills/` with only the six Agent Skills frontmatter fields, so Claude Code, Codex and Hermes read the same files. The Claude-only pieces (the Gauntlet driver, the hook) live apart in `gauntlet/` and `harness/` and are installed as adapters.
2. **Human in the loop.** Nothing that spends credits or reaches the network runs silently. The agent names the call and its estimated cost, then waits for an explicit yes. Never inside a loop.
3. **No blind deletion.** A removal becomes a numbered triage list (path, reason, evidence) for the owner to decide. Replaced copies keep a `.pre-omniharness` suffix.
4. **Gauntlet on demand.** The hunt-and-refute loop runs when asked, or when `python evals/run.py regress` reports a drop. Every paid cycle starts from a git checkpoint tag.
5. **Academic layer.** `thesis-review` audits and revises existing manuscripts against their CSV results and binding style rules. It never invents a number and never asks for a new experiment.

## Tree

```
AGENTS.md              canonical rules: invariants, routing table, HITL list, intake and triage procedures
CLAUDE.md              one line, @AGENTS.md
CONTEXT.md             domain terms (layer, gate, lens, jaVistos, parecer, checkpoint, arm) and a "where do I look" map
.agents/skills/        portable skills, six spec fields only: thesis-review (SKILL.md, scripts/thesis_checks.py, references/)
gauntlet/              Claude-only pair: gauntlet-loop SKILL.md, gauntlet.workflow.js driver, args.exemplo.json, ROADMAP.md
harness/               the gate: settings.json (deny/ask fragment) and guard_bash.py (PreToolUse hard blocks)
scripts/install.py     user-scope installer: junctions, byte-compared driver copy, settings union-merge, drift check
evals/                 run.py (claude -p runner, record, checkpoint, regress, selftest), cases/, results/ (append-only)
tests/                 zero-token checks: test_layout.py, test_checks.py, test_runner.py, test_driver.js
docs/                  install.md, PHASE0_AUDIT.md, adr/, integrations/ (one page per optional tool), catalog/
recipes/               end-to-end tutorials with STOP: confirm lines at every gated step
```

## Quick start

```
python scripts/install.py --check
python scripts/install.py --adopt
python -m unittest discover tests && node tests/test_driver.js
python evals/run.py selftest
```

Then, in any new session, `/omniharness` (Claude Code) or `$omniharness` (Codex) loads the rules, verifies the install and reports regressions. The rules are opt-in per session; nothing is imported into your global instructions file.

```
```

`--check` writes nothing and reports drift; `--adopt` creates the junctions, copies the driver, merges the gate into `~/.claude/settings.json`, and prints the two lines you add by hand (the `~/.claude/CLAUDE.md` import and the Hermes `external_dirs` entry). Full walkthrough, flags and uninstall: [docs/install.md](docs/install.md).

## Which host reads what

`<repo>` is the absolute path of this checkout; `~` is the user home.

| | Claude Code | Codex | Hermes |
|---|---|---|---|
| Instructions | `~/.claude/CLAUDE.md` containing `@<repo>/AGENTS.md` (added by hand) | `AGENTS.md` chain from `~/.codex/AGENTS.md` down to the cwd (32 KiB cap) | `AGENTS.md` or `.hermes.md` in the project |
| Portable skills | `~/.claude/skills/<name>` junction to `<repo>/.agents/skills/<name>` | `~/.agents/skills/<name>` junction to the same target; `.agents/skills` inside a repo is read natively | `~/.hermes/skills` plus `skills.external_dirs: [~/.agents/skills]` in `~/.hermes/config.yaml` (added by hand) |
| Gauntlet | `~/.claude/skills/gauntlet-loop` junction to `<repo>/gauntlet`; driver copied to `~/.claude/workflows/gauntlet-driver.js` | not available (no Workflow tool) | not available (no Workflow tool) |
| Gate | `permissions.deny`/`ask` merged into `~/.claude/settings.json`; PreToolUse hook `python "<repo>/harness/guard_bash.py"` | not installed by the harness; the HITL section of `AGENTS.md` is the enforcement | no hooks; the HITL section of `AGENTS.md` is the enforcement |

## The gate

Every command that spends credits, reaches the network, installs something, deletes recursively or commits sits behind a confirmation. On Claude Code that is enforced twice: `harness/settings.json` carries 5 `deny` entries (`.env*`, `*.pem`, `*.key`, `*cofre*.json`) and 26 `ask` entries (`git push`, `git commit`, `git clone`, recursive deletes, `higgsfield`, `scrapling`, `agent-reach`, `firecrawl`, `pip install`/`pipx install`/`npm install -g`/`npx skills add`/`npx -y`/`uvx`/`uv add`/`uv tool install`, `docker pull`/`run`/`compose`, `curl`, `wget`), and `harness/guard_bash.py` is a PreToolUse hook that hard-blocks the handful of commands no prompt should rescue (`rm -rf` on a root or HOME, force push without lease, hard reset to a remote, disk formatting, download piped into a shell, `DROP TABLE`, `del /s /q` on a drive root, writes to a block device, `rm` of `*.env` or `*cofre*` files). Single-file `rm` stays free so Gauntlet hygiene never prompts. On a host without hooks, the "HITL gate" section of `AGENTS.md` is the enforcement. Source and rationale: [harness/](harness/), [docs/adr/0003](docs/adr/0003-hitl-and-checkpoint.md).

## Benchmarks

Three canonical benchmarks live under `evals/cases/`; each either runs at zero tokens or carries a control arm that must differ from the harness arm, otherwise it reports itself invalid. `l3-gates` proves the academic checks discriminate on a fixture with five planted defects and four must-not-fire controls (0 tokens, `tests/test_checks.py`). `gauntlet-rapido` runs the real driver body against a scripted agent stub (0 tokens, `tests/test_driver.js`), then one live `rapido` run as the cost baseline. `hitl-triage` sends a prompt that asks for a recursive delete, an unsafe skill install and a credit-spending call to a harness arm and a bare control arm, and checks the gate held. Paid arms go through `python evals/run.py run <case> --arm harness|control` (headless `claude -p`, bounded by `--max-budget-usd`, stdout to a file, tree-kill on timeout), `record` refuses a result without a `checkpoint` tag, and `regress` compares the newest record against the median of the previous runs. `claude plugin eval` is not used: it is early-access gated on the reference account and passes without running ([docs/adr/0001](docs/adr/0001-runner-is-claude-p.md)).

## Read next

- [recipes/](recipes/README.md): first hour, code audit with the Gauntlet, thesis review, resilient scraping, creative video.
- [docs/integrations/](docs/integrations/README.md): one page per optional tool, each with its cost, its gate entry and what is installed on the reference machine.
- [docs/catalog/](docs/catalog/README.md): free tiers, community skill packs, MCP servers.
- [docs/adr/](docs/adr/): why the runner is `claude -p`, why install is by junction, why the gate is an ask list plus one hook, why the academic layer is a cadence and not a pipeline.
- [docs/PHASE0_AUDIT.md](docs/PHASE0_AUDIT.md): the audit that produced all of the above; its facts are the ground truth for every page here.

## Status

v0.1, Windows-first. Reference machine: Windows 11, Claude Code 2.1.267, Python 3.12.10, Node 24.19, audited 2026-09-10. Codex and Hermes paths are taken from their documentation; neither host has been exercised end to end on the reference machine (Codex 0.151.0-alpha.7.1 is installed but not on PATH; Hermes is not installed).

## License

MIT (add LICENSE file before publishing).
