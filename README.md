# OmniHarness

A reproducible, multi-agent harness for Claude Code, Codex and Hermes. It gives one repository of portable skills that all three hosts read, a human-in-the-loop gate for anything that spends money or touches the network, an on-demand adversarial audit loop (the Gauntlet), an academic layer that audits and revises manuscripts against their result files, and benchmarks that can fail. The harness is used from other repositories, not from its own checkout: install once at user scope, then point any project at it.

This checkout also builds **OmniForge Lab**, a Windows local app that runs real Claude Code and Codex sessions on this harness's own tasks; see [OmniForge Lab](#omniforge-lab) below, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it is built and [docs/STATUS.md](docs/STATUS.md) for what is proven and what is still open.

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
.agents/skills/        portable skills: thesis-review, omniharness, skills-graph (scripts/skills_graph.py, skills-graph.toml), scout (references/sources.md), detour, skill-installer (installers.toml)
scout/                 Claude-only driver: scout.workflow.js, installed as ~/.claude/workflows/scout-driver.js
gauntlet/              Claude-only pair: gauntlet-loop SKILL.md, gauntlet.workflow.js driver, args.exemplo.json, ROADMAP.md
harness/               the gate: settings.json (deny/ask fragment) and guard_bash.py (PreToolUse hard blocks)
scripts/install.py     user-scope installer: junctions, byte-compared driver copy, settings union-merge, drift check
evals/                 run.py (claude -p runner, record, checkpoint, regress, selftest), cases/, results/ (append-only)
tests/                 zero-token checks: test_layout.py, test_checks.py, test_runner.py, test_skills_graph.py, test_skill_installer.py, test_driver.js, test_scout_driver.js
docs/                  handoff-codex.md (start here on Codex), commercial/ (spec, tickets, plan gate record), install.md, PHASE0_AUDIT.md, adr/, integrations/ (one page per optional tool), catalog/, skills-graph/ (generated snapshot), scout/, detour/, skill-installer/
docs/ARCHITECTURE.md   OmniForge Lab: processes, data files, trust boundaries, module map
docs/STATUS.md         OmniForge Lab: what works and its proof, what is closed or pending, known limitations
docs/omniforge/        Lab feature docs (LAB.md, INSTALL.md, SWARM-PLAN, VALIDATION-PENDING.md, ...); docs/t13/ the E1/T13 accounting/isolation journal
docs/archive/          superseded dated handoffs, checkpoints and comparison notes; kept for the record, not for current instructions
recipes/               end-to-end tutorials with STOP: confirm lines at every gated step
site/                  community portal: index.html (source), public/ (GitHub Pages edition, built by scripts/site_build.py), showcase/ (the record of the build), surface brief, DESIGN.md
omniforge-lab/         OmniForge Lab: server.mjs, engine.mjs (agent runs), review.mjs (diff/merge/evidence), app/ (page modules), test/
```

## Quick start

For this Codex Windows host, run `./scripts/check.ps1`: it uses the existing bundled Python 3.12+ explicitly, runs the local battery and verifies the installed gate. Another existing runtime can be selected with `-Python <absolute-path>`. [T1 findings and coverage limits](docs/experiments/codex-parity-2026-09.md); [next eval slice](docs/evals/PLAN.md).

```
python scripts/install.py --check
python scripts/install.py --adopt
python -m unittest discover tests && node tests/test_driver.js
python evals/run.py selftest
```

Then, in any new session, `/omniharness` (Claude Code) or `$omniharness` (Codex) loads the rules, verifies the install and reports regressions. The rules are opt-in per session; nothing is imported into your global instructions file.

Measured baseline for the three benchmarks (agents, tokens, cost, what each arm did): [docs/benchmarks.md](docs/benchmarks.md).

`--check` writes nothing and reports drift; `--adopt` creates the junctions, copies the driver, merges the gate into `~/.claude/settings.json`, and prints the two optional lines you may add by hand (the `~/.claude/CLAUDE.md` import for always-on rules, and the Hermes `external_dirs` entry). Full walkthrough, flags and uninstall: [docs/install.md](docs/install.md).

## The portal

`site/index.html` is one page in two editions: `python scripts/site_build.py` writes `site/public/index.html` (the GitHub Pages edition, member-only guide bodies removed, the evolution captures downscaled with ffmpeg) and, with `--artifact`, the members edition as a claude.ai artifact fragment. The page embeds the skills graph from `docs/skills-graph/graph.json` and renders it with force-graph (the page's one library, pinned with an integrity hash), so the flow diagram cannot drift from the repository (`node tests/test_site.js` fails if a step cites a missing node). `python -m unittest tests.test_visual` drives Playwright over both viewports and both colour schemes and asserts measurements (overflow, contrast, console errors, rendered nodes, tooltip time, drawer, filter, copy, the theme toggle's contrast, the language switch with every slot translated and the choice kept across a reload). The public edition is served by GitHub Pages at https://ymauhn.github.io/omniharness/ (`.github/workflows/pages.yml` deploys `site/public` as committed; nothing is built on the runner). The page is authored in English and translated in place from `site/i18n/pt-BR.json`, one dictionary keyed by the English markup that the build embeds; the reader's language and theme choices live in `localStorage`. The page's own evolution (v1 one-shot, v2 through the flow, v3 redesigned through the plan gate and impeccable) is its case study, with the record in `site/showcase/` and `docs/scout/portal-v3/`.

## OmniForge Lab

OmniForge Lab (`omniforge-lab/`) is a local, token-gated web app for one Windows user: it drives real Claude Code and Codex sessions on this repository's own tasks and turns each run into a reviewable change. What it does today, all implemented and covered by tests (see [docs/STATUS.md](docs/STATUS.md) for the exact file behind each claim):

- **Runs a task as a real agent session.** "Run" on a task creates a disposable git worktree and branch, launches an interactive `claude` or `codex` session there in its own terminal pane, and shows live status (working/blocked/idle/done) from the CLI's own lifecycle hooks — no polling, no model call from the Lab itself.
- **Review, diff and gated merge.** A task's diff against its base commit, file by file; "Aprovar e fazer merge" runs the given test command and refuses on its failure or timeout (the field is optional — leaving it blank merges without running a test), refuses on a merge conflict or a repository that moved under it, and otherwise merges the change into the project's real branch as a merge commit (`git merge --no-ff`, never a fast-forward).
- **Evidence bundle.** Every merge attempt (accepted or refused) is appended to the task's evidence file: the test command, its exit code and output hash, the diff stat, the token usage the CLI itself recorded, and the reviewer's note.
- **Agentes fleet board and kanban.** A live grid of running agents (blocked runs first, optional desktop notification) and a kanban of task status, both driven by the same run/task events as the rest of the page.
- **Versioned scoped memory.** Project/session notes with edit history, conflict detection on concurrent writes, and archival, read by a bounded context brief instead of an unbounded dump.
- **Workflows.** Saved per-project task DAGs and prompt snippets; creating tasks from one never starts a model on its own.
- **Prompt Copilot and mascot.** A two-skin mascot and lexical (or, once explicitly enabled, a local Laya model) suggestions over the composer and selected text, wired to the skills catalog.

### Install and run on Windows

Prerequisites: Node.js 22+ (`omniforge-lab/package.json` pins `engines.node >= 22`) and this checkout. From the repository root:

```powershell
npm ci --prefix omniforge-lab
npm start --prefix omniforge-lab
```

Open the exact `http://127.0.0.1:<port>/?token=<token>` URL the server prints; opening `omniforge-lab/index.html` as a `file://` page does not work, since every control needs the authenticated `/api/*` routes. Add the checkout folder as a project inside the running page (project paths must already exist); app data lives in the gitignored `.omniforge-lab/` at the repository root, or wherever `OMNIFORGE_DATA_DIR` points. `omniforge doctor` (`scripts\omniforge.cmd doctor`) checks Node, the Lab's native module, Python, Git and the Claude/Codex CLIs and prints what to install for a row that is missing.

Run on this host, 2026-09-26 (Windows 11 Pro, Node v24.19.0, npm 11.17.0):

```
> scripts\omniforge.cmd doctor
ok       node   Node.js 24.19.0
ok       lab    node-pty 1.2.0-beta.15; terminal shell C:\Windows\...\powershell.exe
ok       python Python 3.12 at ...\python.exe (via bundled Codex runtime)
ok       git    git version 2.54.0.windows.1 (optional)
ok       claude logged in: API key (ANTHROPIC_API_KEY; signed in via claude.ai) (optional)
missing  codex  codex CLI not found (optional) -> install it (npm install -g @openai/codex), then run: codex login
Doctor: required prerequisites are ready.

> npm ci --prefix omniforge-lab
added 4 packages
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts: node-pty@1.2.0-beta.15
                                                       (this session's sandbox had not pre-approved that package's
                                                        install script; node-pty still loads from its bundled
                                                        win32-x64 prebuild, so the Lab runs regardless)

> npm start --prefix omniforge-lab
OmniForge Lab: http://127.0.0.1:52541/?token=<redacted>
Candidato local: PTYs e Copilot; Laya exige ativação. Ctrl+C solicita o encerramento das sessões.

GET  /                          -> 200 (the Lab page)
GET  /api/state  (with token)   -> 200 {"projects":[],"sessions":[],"tasks":[],...}
GET  /api/state  (without token)-> 403
```

`npm --prefix omniforge-lab test` runs the Lab's own suite (297/297 on this host, zero skips); the repository-wide `python -m unittest discover tests` also drives it end to end in a real Chromium tab through Playwright. Full manager (`pack`/`install`/`update`/`repair`/`uninstall`) walkthrough, a packaged release layout and its own recorded host evidence: [docs/omniforge/INSTALL.md](docs/omniforge/INSTALL.md). Day-to-day Lab notes, current slice and known host quirks (a `node-pty` cleanup message on Windows shutdown, terminal pane behaviour, memory/asset limits): [docs/omniforge/LAB.md](docs/omniforge/LAB.md).

### What is closed or pending

- **Managed isolation is closed by design, not by gap.** The engine runs interactive sessions under the owner's own Claude/Codex login in a plain git worktree; a host PTY is a terminal convenience, not a container or Job Object boundary. A distributed product build would need its own API-key-authenticated, sandboxed executor — a separate, unbuilt mode ([docs/omniforge/SWARM-PLAN-2026-09-26.md](docs/omniforge/SWARM-PLAN-2026-09-26.md), [docs/t13/NATIVE-ISOLATION.md](docs/t13/NATIVE-ISOLATION.md)).
- **JEV live is pending.** The classifier adapter and its offline tests are in; a live typed call needs the owner to connect a provider account and credits ([docs/omniforge/VALIDATION-PENDING.md](docs/omniforge/VALIDATION-PENDING.md) V-02).
- **Codex live retry is pending.** The last real end-to-end run found the Lab resolving a sandboxed Codex build with no code-mode host, so every tool call failed closed; a retry with the complete Codex build is deferred behind the weekly allowance ([docs/omniforge/VALIDATION-PENDING.md](docs/omniforge/VALIDATION-PENDING.md) V-08).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the process map and trust boundaries, and [docs/STATUS.md](docs/STATUS.md) for the full what-works/what's-open ledger with its test evidence.

## Which host reads what

`<repo>` is the absolute path of this checkout; `~` is the user home.

| | Claude Code | Codex | Hermes |
|---|---|---|---|
| Instructions | opt-in per session with `/omniharness`; optionally a `~/.claude/CLAUDE.md` line `@<repo>/AGENTS.md` (added by hand) for always-on rules | `AGENTS.md` chain from `~/.codex/AGENTS.md` down to the cwd (32 KiB cap) | `AGENTS.md` or `.hermes.md` in the project |
| Portable skills | `~/.claude/skills/<name>` junction to `<repo>/.agents/skills/<name>` | `~/.agents/skills/<name>` junction to the same target; `.agents/skills` inside a repo is read natively | `~/.hermes/skills` plus `skills.external_dirs: [~/.agents/skills]` in `~/.hermes/config.yaml` (added by hand) |
| Gauntlet | `~/.claude/skills/gauntlet-loop` junction to `<repo>/gauntlet`; driver copied to `~/.claude/workflows/gauntlet-driver.js` | not available (no Workflow tool) | not available (no Workflow tool) |
| Gate | `permissions.deny`/`ask` merged into `~/.claude/settings.json`; PreToolUse hook `python "<repo>/harness/guard_bash.py"` | not installed by the harness; the HITL section of `AGENTS.md` is the enforcement | no hooks; the HITL section of `AGENTS.md` is the enforcement |

## The gate

Every command that spends credits, reaches the network, installs something, deletes recursively or commits sits behind a confirmation. On Claude Code that is enforced twice: `harness/settings.json` carries 5 `deny` entries (`.env*`, `*.pem`, `*.key`, `*cofre*.json`) and 26 `ask` entries (`git push`, `git commit`, `git clone`, recursive deletes, `higgsfield`, `scrapling`, `agent-reach`, `firecrawl`, `pip install`/`pipx install`/`npm install -g`/`npx skills add`/`npx -y`/`uvx`/`uv add`/`uv tool install`, `docker pull`/`run`/`compose`, `curl`, `wget`), and `harness/guard_bash.py` is a PreToolUse hook that hard-blocks the handful of commands no prompt should rescue (`rm -rf` on a root or HOME, force push without lease, hard reset to a remote, disk formatting, download piped into a shell, `DROP TABLE`, `del /s /q` on a drive root, writes to a block device, `rm` of `*.env` or `*cofre*` files). Single-file `rm` stays free so Gauntlet hygiene never prompts. On a host without hooks, the "HITL gate" section of `AGENTS.md` is the enforcement. Source and rationale: [harness/](harness/), [docs/adr/0003](docs/adr/0003-hitl-and-checkpoint.md).

## Benchmarks

Three canonical benchmarks live under `evals/cases/`; each either runs at zero tokens or carries a control arm that must differ from the harness arm, otherwise it reports itself invalid. `l3-gates` proves the academic checks discriminate on a fixture with five planted defects and four must-not-fire controls (0 tokens, `tests/test_checks.py`). `gauntlet-rapido` runs the real driver body against a scripted agent stub (0 tokens, `tests/test_driver.js`), then one live `rapido` run as the cost baseline. `hitl-triage` sends a prompt that asks for a recursive delete, an unsafe skill install and a credit-spending call to a harness arm and a bare control arm, and checks the gate held. Paid arms go through `python evals/run.py run <case> --arm harness|control` (headless `claude -p`, bounded by `--max-budget-usd`, stdout to a file, tree-kill on timeout), `record` refuses a result without a `checkpoint` tag, and `regress` compares the newest record against the median of the previous runs. `claude plugin eval` is not used: it is early-access gated on the reference account and passes without running ([docs/adr/0001](docs/adr/0001-runner-is-claude-p.md)).

## Read next

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/STATUS.md](docs/STATUS.md): OmniForge Lab's processes, data files, trust boundaries and its what-works/what's-open ledger.
- [docs/omniforge/LAB.md](docs/omniforge/LAB.md) and [docs/omniforge/INSTALL.md](docs/omniforge/INSTALL.md): day-to-day Lab notes and the packaged install/update/repair/uninstall manager.
- [recipes/](recipes/README.md): first hour, code audit with the Gauntlet, thesis review, resilient scraping, creative video.
- [docs/integrations/](docs/integrations/README.md): one page per optional tool, each with its cost, its gate entry and what is installed on the reference machine.
- [docs/catalog/](docs/catalog/README.md): free tiers, community skill packs, MCP servers.
- [docs/adr/](docs/adr/): why the runner is `claude -p`, why install is by junction, why the gate is an ask list plus one hook, why the academic layer is a cadence and not a pipeline.
- [docs/PHASE0_AUDIT.md](docs/PHASE0_AUDIT.md): the audit that produced all of the above; its facts are the ground truth for every page here.

## Status

Harness v0.1, Windows-first. Reference machine: Windows 11, Claude Code 2.1.267, Python 3.12.10, Node 24.19, audited 2026-09-10. Codex and Hermes paths are taken from their documentation; neither host has been exercised end to end on the reference machine (Codex 0.151.0-alpha.7.1 is installed but not on PATH; Hermes is not installed). OmniForge Lab is a separate, faster-moving development prototype inside the same checkout; its own status, test counts and open items are [docs/STATUS.md](docs/STATUS.md), not this line.

## License

MIT, see [LICENSE](LICENSE).
