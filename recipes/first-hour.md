# Recipe: the first hour

Clone, install, prove the zero-token checks pass, then run one small paid Gauntlet on any repository and learn to read its report.

Time: about 40 minutes of which one 5 to 10 minute paid run. Cost: one `rapido +300k` run; see step 8 for the measured numbers.

Related: `AGENTS.md` (the three commands), `gauntlet/SKILL.md` (the run itself), `docs/install.md`, [code-audit-gauntlet.md](code-audit-gauntlet.md) for the full audit.

## Prerequisites

- Claude Code with the Workflow tool (the Gauntlet driver is Claude-only; the rest of the harness is portable).
- Python 3.12 and Node 24 on PATH (`python --version`, `node --version`). No pip packages are needed: every script is stdlib.
- git. The repository you will audit must be a git repository with a clean-enough tree (untracked files are fine; the run snapshots them).

## Steps

1. **Clone and enter the repo.**

   ```bash
   git clone <url> master_team && cd master_team
   ```

2. **Dry-run the install.** `--dry-run` prints the plan (`rename`, `junction`, `copy`, `merge`) and the manual lines; it writes nothing. (`--check` is the drift check: one `OK`/`FAIL` row per junction, the driver copy and the settings ask list, exit 0 when all pass.)

   ```bash
   python scripts/install.py --dry-run
   ```

   Read the output. Two things it may print:
   - a numbered triage list (exit 1, printed instead of the plan) of targets that already exist and are not ours (on this machine: the four global gauntlet copies under `~/.claude/skills/gauntlet-loop/` and `~/.claude/workflows/gauntlet-driver.js`). The installer does not delete them; adopting renames them with a `.pre-omniharness` suffix.
   - the `~/.claude/CLAUDE.md` import line (`@<repo>/AGENTS.md`) it wants you to add by hand. It never writes to your files.

3. **Adopt.** This creates user-scope junctions (`~/.claude/skills/<skill>` and `~/.agents/skills/<skill>` pointing at `.agents/skills/<skill>`, `~/.claude/skills/gauntlet-loop` pointing at `gauntlet/`), copies the driver to `~/.claude/workflows/gauntlet-driver.js` and union-merges `harness/settings.json` into `~/.claude/settings.json`. That last merge is the gate: from now on `git push`, `git commit`, recursive deletes, `higgsfield`, `scrapling`, `agent-reach`, `firecrawl`, `pip`/`pipx`/`npm -g`/`npx skills add`, `docker pull`/`docker run`, `curl` and `wget` prompt before running, and `harness/guard_bash.py` hard-blocks the handful of commands no prompt should rescue.

   STOP: confirm. Adopting changes `~/.claude/settings.json` and creates junctions in your home directory. Re-read the `--dry-run` output, then:

   ```bash
   python scripts/install.py --adopt
   ```

   If the triage list was non-empty, decide each item yourself first; the installer exits 1 rather than overwrite a differing target.

   From now on, in any new session, `/omniharness` (Claude Code) or `$omniharness` (Codex) loads the rules, re-runs `--check` and reports regressions. The rules are opt-in per session; the installer never writes to `~/.claude/CLAUDE.md`.

4. **Run the zero-token tests.** Both must be green before anything paid.

   ```bash
   python -m unittest discover tests
   node tests/test_driver.js
   ```

   `tests/test_driver.js` runs the real driver body with a scripted `agent` stub through three scenarios (a null hunter round, a dry round plus the ±4-line duplicate window, a token ceiling that fires between hunt and refute). It takes under a second and costs nothing.

5. **Run the eval selftest.**

   ```bash
   python evals/run.py selftest
   ```

   This proves the runner itself discriminates: `regress` over three synthetic histories prints exactly one line for a pass drop, one for a 1.3× cost jump and nothing for a flat history, and an empty or garbage `claude -p` stream is a failure, never a pass. It prints `selftest ok: regress [1, 1, 0]; empty and garbage streams fail`. Benchmark B1 (`l3-gates`, the academic gates) runs under `python -m unittest discover tests` in step 4. Zero tokens. If anything fails, stop here and read the failing assertion; a paid run on a broken harness proves nothing.

6. **Pick a target repository and open Claude Code in it.** Any git repo with a test command works; a repo that just changed is best, because "what just changed" is where the bugs live. Restart the Claude Code session after step 3 so the workflow registry sees `gauntlet-driver` (the registry is memoised per working directory; see the gotchas in `gauntlet/SKILL.md`).

7. **Take a checkpoint.** Every paid cycle starts from a git tag so you can diff against it afterwards.

   ```bash
   python <path-to-master_team>/evals/run.py checkpoint gauntlet-rapido
   ```

   `checkpoint <case>` runs `git tag -f ckpt/<case>/<ts> $(git stash create || git rev-parse HEAD)` in the harness repo (`run.py` always runs git with `cwd` at its own repo root, whatever your current directory) and writes the untracked-file list to `evals/results/<ts>-<case>-untracked.txt`; the case name only labels the tag (`gauntlet-rapido` is the benchmark case this run mirrors). If you run the Gauntlet on this harness repo itself, the path is just `evals/run.py`. For any other target repo, also tag it by hand from inside it (`git tag -f ckpt/<case>/<ts> $(git stash create || git rev-parse HEAD)` and `git status --short | grep '^??' | sort > "$SCRATCH/gauntlet-antes.txt"`), because `run.py checkpoint` never tags a repo other than its own.

8. **Launch the first Gauntlet.**

   ```
   /gauntlet-loop rapido +300k
   ```

   What the tokens mean: `rapido` is the smallest preset (2 rounds max, stop after 1 dry round, 2 refuter lenses, 8 findings per round, medium effort); `+300k` caps the run's output tokens at 300,000 and the driver stops opening rounds at 80% of that so it can still refute what it already found.

   Phase 0 runs without asking: it snapshots untracked files, reads your manifest to derive the `verificar` commands (and runs each once, so a command that already fails is labelled "already failing before the gauntlet"), reads CLAUDE.md/README/docs, looks at `git log -5` and the last diff, and derives 4 to 8 areas.

   STOP: confirm. Phase 1 is one `AskUserQuestion` with up to four questions: areas, depth, scope, fix policy. The depth descriptions carry the agent and token estimates for your real number of areas. This is the only moment before spending; nothing runs until you answer. For a first run keep `rapido`, pick "só relatório" (report only) as the fix policy, and accept the areas.

   What to expect to pay, from the numbers measured in `gauntlet/SKILL.md`:

   | Measured | Value |
   |---|---|
   | Output tokens per agent (308-agent run) | mean 8.3k, median 6.4k, p90 15k, max 42k |
   | New (uncached) input per agent | 156k |
   | Cache read per agent | 3.3M |
   | Upper bound of agents, `rapido`, 6 areas | 44 (`6×2 + 8×2×2`) |
   | `+300k` in agents | ≈ 36 at the 8.3k mean, roughly one whole `rapido` |
   | Smoke test, 1 area / 1 round / 1 lens / low effort | 1 agent, 34 s, 39k subagent tokens |
   | Smoke test, 3 agents | 90 s, 112k |
   | Benchmark B2 run 1 (`rapido` over a 2-bug fixture) | about 6 to 12 agents, 50k to 180k output tokens |

   The `+Nk` ceiling limits output only. Money is dominated by cache reads (about 50 calls per agent over a ~65k context), so run `/cost` after the run for the dollar figure. If the harness recognised `+300k` as a session directive, `resumo.tetoSessao` is set and the cap is hard for the whole session; if it shows `null`, only the driver's own ceiling applies.

9. **Wait, do not poll.** The result arrives as a notification with the whole `result` object. While it runs, `/workflows` shows the live tree (`caçar:<area>:r<round>`, `refutar:<file>:<line>:L<n>`) and the driver logs one line per round: `rodada 2/5 — 3 confirmado(s) — tokens 210k de 300k`. Do not edit files in scope while hunters are measuring them.

10. **Read the report.** Phase 3 prints, before touching any file:

    ```
    🔴 ALTA (n)   | area | file:line | finding | scenario | fix | owner rule
    🟡 MÉDIA (n)  | …
    🟢 BAIXA (n)  | …
    ⚪ SEM VERIFICAÇÃO (n) — the ceiling arrived before refutation; treat as suspicion
    Refutados: n (title + the lens that killed it, one line each; you may disagree)
    Resumo: rounds, parouPor, raw → merged → confirmed, run tokens / ceiling
    ```

    How to read it:
    - A finding is **confirmed** only when the refuters were a strict minority. A tie is refuted; under `rapido` (2 lenses) a single lens vetoes. That bias is deliberate: the driver would rather drop a true finding than hand you a false one. Skim the refuted list; the lens name tells you why.
    - `gravidadeOriginal` shown as "alta→média (refutador)" means a refuter downgraded it.
    - `decisaoNecessaria` marks a finding whose fix depends on a product, balance or UX choice. The hunter listed options in `correcao`; the skill asks you, never guesses.
    - `⚪ SEM VERIFICAÇÃO` items are what the ceiling left unrefuted. They are suspicions, not findings.
    - `resumo.parouPor` is `secou` (no new findings), `rodadas` (round limit) or `teto` (ceiling). `teto` on a first run means raise `+Nk` next time or narrow with `areas=`.
    - `resumo.agentesFalhos` / `lentesFalhas` count agents that returned nothing; a high number is an infrastructure problem, not a clean codebase.

    With "só relatório" the skill stops after this table. Hygiene still runs: check that `find . -name '_gauntlet_*'` prints nothing and `git diff --stat ckpt/<tag>` is empty.

11. **Record and keep the seed.** Save the `vistos[]` list from the result; a rerun seeded with `jaVistos` skips everything already known (measured: 112k tokens down to 42k, 3 agents down to 1). If the skill offers to write `.claude/gauntlet-loop.json` with this run's `contexto`/`verificar`/`regras`/`areas`, accept: the next run starts at Phase 1 directly. Save the result object to a file and, from this harness repo, `python evals/run.py record <result.json> gauntlet-rapido` stores the baseline record in `evals/results/`; it refuses without the checkpoint tag from step 7 and without the case's `check.py`.

## What can fail

- **`Workflow "gauntlet-driver" not found`.** The registry is cached per cwd and only reads `*.js` from `~/.claude/workflows/` or `<repo>/.claude/workflows/`. `ls ~/.claude/workflows/`; if the file is there, `cd` into a subfolder in one Bash call and try again, or restart the session.
- **`gauntlet-loop precisa de args.contexto (texto) e args.areas`.** `args` reached the driver as a string. The skill passes an object; if you called the driver by hand, pass JSON, not a quoted string. Never call `/gauntlet-driver` directly; it exists for the skill.
- **Every `verificar` command reported as a finding.** Phase 0 did not run the baseline, or the command was already red. Rerun; the skill labels pre-existing failures.
- **`resumo.tokens` in the millions on a small run.** An old driver copy that returned `budget.spent()` raw. `python scripts/install.py --check` shows the drift; `--adopt` reinstalls.
- **Install refuses in a sandbox.** `OMNIHARNESS_SANDBOX=1` is set by `evals/run.py` for benchmark workspaces; unset it in a real shell.
- **The permission prompt never appears for a gated command.** The settings merge did not land or the session predates it. `python scripts/install.py --check` and restart Claude Code.
