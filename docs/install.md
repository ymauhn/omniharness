# Installing OmniHarness

User-scope install: the repository stays where you cloned it and the hosts reach it through junctions and one copied file. Nothing is deleted; anything that would be replaced is renamed with a `.pre-omniharness` suffix, and only under `--adopt`. Rationale: [adr/0002](adr/0002-roots-and-user-scope-install.md).

`<repo>` below is the absolute path of the checkout (on the reference machine `C:/Users/Yeonatan/master_team`; in Git Bash `/c/Users/Yeonatan/master_team`). `~` is your home directory.

## Prerequisites

- Python 3.12+ (`python --version`; the reference machine has 3.12.10; the installer uses `os.path.isjunction`, new in 3.12). Stdlib only, no pip packages.
- Node 18+ (`node --version`; reference 24.19). Plain Node, no npm packages; only `tests/test_driver.js` needs it.
- git on PATH.
- Claude Code (reference 2.1.267) for the Gauntlet and the enforced gate. Codex and Hermes get the portable skills and the prose gate; see their sections.
- Optional: Docker for the thesis-review compile gate (`docker run --rm -v "$PWD":/w -w /w texlive/texlive latexmk -pdf main.tex`; the first `docker pull texlive/texlive` is about 2 GB and is gated: STOP: confirm. The agent says "The compile gate pulls `texlive/texlive` (about 2 GB, one time) and runs it in Docker; alternatively hand me the Overleaf `.log`. Proceed?" and waits). Without Docker, hand the agent an Overleaf `.log` instead. Whether Docker is installed on the reference machine is not recorded in the audit ([integrations/overleaf.md](integrations/overleaf.md)).

## Claude Code, step by step

All flags of `scripts/install.py`:

| Flag | Effect |
|---|---|
| (none) | Plan, then apply. Exits 1 with a numbered triage list if any target exists and is not ours. |
| `--check` | Drift check only, writes nothing. One `OK`/`FAIL` row per junction, the driver copy (byte compare) and the settings ask list. Exit 0 when all pass. |
| `--dry-run` | Print the plan and the manual lines, write nothing. |
| `--adopt` | Rename conflicting targets to `<path>.pre-omniharness` (then `-2`, `-3` if taken) before linking. |
| `--no-agents` | Skip the `~/.agents/skills/<name>` junctions (Codex/Hermes side). |
| `--home <dir>` | Use another home directory (the tests use a temp dir). |

The installer refuses to run when `OMNIHARNESS_SANDBOX=1` is set (benchmark sandboxes set it). Exit codes: 0 ok, 1 triage needed / check failed / sandbox, 2 usage.

1. **Clone.**

   ```
   git clone <url> master_team
   cd master_team
   ```

2. **See what exists.** Writes nothing.

   ```
   python scripts/install.py --check
   ```

   On a fresh machine every row is `FAIL`; that is expected. On a machine that already has a global `gauntlet-loop` skill, the plain run (next step) lists it for triage instead of touching it.

3. **Preview the plan.**

   ```
   python scripts/install.py --dry-run
   ```

   Prints one line per action (`rename`, `junction`, `copy`, `merge`) plus the two manual lines from step 5.

4. **Apply.** Confirm you accept the renames listed in step 3, then:

   ```
   python scripts/install.py --adopt
   ```

   What it does, in order:
   1. Renames any existing target that is not already a junction to us: `<path>` becomes `<path>.pre-omniharness`. Without `--adopt` the script prints `1. <path>: real directory; would be renamed to ...` and exits 1.
   2. Creates junctions (`cmd /c mklink /J`, no admin needed): `~/.claude/skills/<name>` and `~/.agents/skills/<name>` for every directory under `<repo>/.agents/skills/`, and `~/.claude/skills/gauntlet-loop` to `<repo>/gauntlet`.
   3. Copies `<repo>/gauntlet/gauntlet.workflow.js` to `~/.claude/workflows/gauntlet-driver.js` if the bytes differ (the Workflow registry only reads `*.js` from that directory, so this file cannot be a link).
   4. Union-merges `harness/settings.json` into `~/.claude/settings.json`: appends the `deny` and `ask` entries that are missing, adds the `PreToolUse` Bash hook `python "<repo>/harness/guard_bash.py"` unless a `guard_bash.py` hook is already there, keeps every other key untouched. If a settings file existed, it is copied first to `~/.claude/settings.json.pre-omniharness` (only once; a later run does not overwrite the backup).
   5. Prints the manual lines.

5. **Add the two lines by hand.** The script prints them and never writes them:

   - `~/.claude/CLAUDE.md`: add the line `@<repo>/AGENTS.md`. This is the Windows-safe import; there is no second copy of the rules to drift.
   - Hermes only: see the Hermes section.

6. **Restart Claude Code** in the project you will work on. The Workflow registry is memoised per working directory, so a session opened before step 4 does not see `gauntlet-driver`.

## Codex (manual)

Nothing to install: Codex reads `~/.agents/skills` natively, and step 4 already created `~/.agents/skills/<name>` junctions (unless you passed `--no-agents`). Inside a repository, Codex also reads `.agents/skills` from the cwd up to the repo root.

- Instructions: Codex reads the `AGENTS.md` chain from `~/.codex/AGENTS.md` down to the cwd, 32 KiB cap. To use the harness rules in a project, add `@<repo>/AGENTS.md` (or a copy of the file) to that project's `AGENTS.md`, or to `~/.codex/AGENTS.md` for every project.
- Gauntlet: not available (Codex has no Workflow tool). The `gauntlet-loop` skill is not linked under `~/.agents/skills` on purpose.
- Gate: Codex reads a same-shaped `~/.codex/hooks.json`, but the harness does not write it. The "HITL gate" section of `AGENTS.md` is the enforcement.
- On the reference machine `codex.exe` 0.151.0-alpha.7.1 lives under `%LOCALAPPDATA%\OpenAI\Codex\bin\` and is not on PATH; call it by full path or add that directory to PATH.

## Hermes (manual)

Hermes (NousResearch/hermes-agent, MIT, Python) is not installed on the reference machine and has not been exercised. Install it from its own repository (UNVERIFIED: the audit records only that a Windows installer exists and gives no command; read the project's install page before running anything, and treat the install as a gated network action: STOP: confirm. The agent names the install command and waits for a yes before running it).

Then add to `~/.hermes/config.yaml`:

```yaml
skills:
  external_dirs:
    - ~/.agents/skills
```

- Instructions: Hermes reads `AGENTS.md` or `.hermes.md` in the project.
- Gauntlet: not available.
- Gate: Hermes has no hooks. The "HITL gate" section of `AGENTS.md` is the only enforcement; the agent must name each gated call and wait for a yes.

## Verify

```
python scripts/install.py --check
python -m unittest discover tests
node tests/test_driver.js
node tests/test_driver.js ~/.claude/workflows/gauntlet-driver.js
python evals/run.py selftest
```

Expected: `--check` prints `OK` on every row and exits 0; the unittest run is green (it also runs the installer against a temporary home, so it proves the installer itself); `test_driver.js` runs the driver body with a stub agent in under a second, and the second invocation proves the installed copy; `selftest` prints `selftest ok: regress [1, 1, 0]; empty and garbage streams fail`.

Inside Claude Code: `/gauntlet-loop`, `thesis-review`, `omniharness` and `skills-graph` appear in the skill list, and a `git push` or `curl` in Bash prompts before running.

## Uninstall

Run these in a plain terminal, not from inside Claude Code: `rmdir` is on the ask list, so the agent would prompt on every line.

1. Remove the junctions. `rmdir` on a junction removes the link only; the repo files are untouched. In `cmd.exe`:

   ```
   rmdir "%USERPROFILE%\.claude\skills\thesis-review"
   rmdir "%USERPROFILE%\.agents\skills\thesis-review"
   rmdir "%USERPROFILE%\.claude\skills\gauntlet-loop"
   ```

   (one pair per directory under `.agents/skills/`). Do not use `rd /s` or `Remove-Item -Recurse` on a junction.

2. Delete the driver copy: `del "%USERPROFILE%\.claude\workflows\gauntlet-driver.js"`.

3. Restore the settings: copy `~/.claude/settings.json.pre-omniharness` over `~/.claude/settings.json` (if there was no settings file before the install, there is no backup; delete the merged file or remove the `permissions` entries and the `guard_bash.py` hook by hand).

4. Restore anything renamed in step 4.1 of the install: rename `<path>.pre-omniharness` back to `<path>`.

5. Remove the `@<repo>/AGENTS.md` line from `~/.claude/CLAUDE.md` and, for Hermes, the `external_dirs` entry.

## Troubleshooting

- **Junction creation fails on Windows.** `mklink /J` needs no admin rights but both sides must be on local NTFS volumes and the link name must not exist yet. Check that `~/.claude/skills` and `~/.agents/skills` exist as real directories (the installer creates them) and that no file of the same name is in the way. If the repo lives on a mapped drive, `--check` may still report `FAIL` because `realpath` stops at the drive letter; the installer then falls back to comparing `SKILL.md` through the link, so a `FAIL` there means the bytes really differ.
- **`python` vs `python3`.** On Windows `python3` resolves to the Microsoft Store stub. Every command in this repo and the installed hook use `python`. If a hook you copied from elsewhere says `python3`, change it.
- **`/gauntlet-loop` cannot find `gauntlet-driver`.** The Workflow registry is memoised per working directory. Restart the session after installing, or `cd` into a subfolder and back to force a re-read.
- **`--check` fails on the driver row after you edited `gauntlet/gauntlet.workflow.js`.** Rerun `python scripts/install.py` (or `--adopt`); it recopies the driver when the bytes differ. The installed file is a copy by design.
- **`claude plugin eval` prints an early-access notice.** Expected on the reference account: `init` exits 1 creating nothing and `eval .` exits 0 having run nothing. The harness does not use it; benchmarks go through `python evals/run.py` ([adr/0001](adr/0001-runner-is-claude-p.md)).
- **The installer says `refusing: OMNIHARNESS_SANDBOX=1`.** You are inside a benchmark sandbox created by `evals/run.py`. Unset the variable in a real shell.
- **Triage list, exit 1.** A target exists and is not ours. Read each numbered line, decide, then rerun with `--adopt` to rename it, or remove it yourself. The installer never deletes.

## Activate in a session

The harness rules are opt-in. Nothing is imported into `~/.claude/CLAUDE.md`; instead, in any new session run:

- Claude Code: `/omniharness` (add `status` to only check the install and regressions, `setup` to walk through this page on a new machine)
- Codex: `$omniharness`
- Hermes: invoke the `omniharness` skill by name

The skill reads `AGENTS.md` and `CONTEXT.md`, runs `python scripts/install.py --check` and `python evals/run.py regress`, reports in five lines, and offers the install only when a row fails. It never writes to your global instructions, never commits, never deletes, never starts a paid run.
