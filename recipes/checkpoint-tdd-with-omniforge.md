# Recipe: test-first checkpoints with OmniForge

Learn the engineering workflow OmniForge uses for pillar 1 (a delimited bug, fixed test-first, closed with reviewable evidence) on a small practice challenge, then run the same three steps on a real task. The workflow has three pieces, all in the library (`library/manifest.json`):

| Library entry | Kind | What it is |
|---|---|---|
| `checkpoint-build` | skill | `.agents/skills/checkpoint-build/`: small checkpoints, each with a failing test first, current evidence and two independent reviews |
| `engineering-checkpoint-template` | template | `library/templates/engineering-checkpoint.workflow.json`: the Lab's "Do bug à evidência" preset, exported unchanged (Reproduzir, Corrigir, Revisar) |
| `checkpoint-tdd-tutorial` | tutorial | this page |

Cost: zero tokens for sections 1 to 3; local Python only. Section 4 uses your own host session.

## Prerequisites

- `python --version` prints 3.12 or later. On Windows, use `python`, never `python3`.
- The commands below run from the repository root in Windows PowerShell.
- `python scripts/library.py verify` prints `OK` for every entry. A `FAIL` means a pinned source changed after review: stop and read the diff (see "What can fail").

## 1. Install the library entries

```powershell
python scripts/library.py list
python scripts/library.py install checkpoint-build --dry-run
python scripts/library.py install checkpoint-build
python scripts/library.py install engineering-checkpoint-template
python scripts/library.py install checkpoint-tdd-tutorial
```

`list` shows each entry, its install state in your home and what installing does. The skill becomes two junctions, `~/.claude/skills/checkpoint-build` and `~/.agents/skills/checkpoint-build`, so Claude Code and Codex both find it. The template and the tutorial are copied into `~/.omniharness/library/`. If you already ran `python scripts/install.py --adopt`, the skill junctions exist and the install prints `Nothing to do.`

Installing never edits `~/.claude/settings.json`. Anything the install would replace is first renamed with a `.pre-omniharness` suffix. `python scripts/library.py uninstall <entry>` removes only a link to the entry's source or a copy still equal to the pinned hash; an edited copy is listed for triage and left in place, and backups are always kept.

**STOP: confirm** before the non-dry-run install: it writes into your user profile.

## 2. The workflow in three steps

The template's three nodes are the checkpoint-build loop in miniature:

1. **Reproduzir.** Read the relevant code and the project rules. Reproduce the problem in a small test that fails for the expected reason. Record the command and the real failure.
2. **Corrigir.** Make the smallest fix inside the approved scope, starting from that reproduction. Run the test and the relevant checks. Keep the failures and limits you found.
3. **Revisar.** Review the diff independently against the acceptance criteria. Tie every claim to evidence; hand off with the tests you ran and the real open items.

`checkpoint-build` adds what a real task needs around that loop: one active checkpoint at a time, two repair cycles by default, visual evidence when a UI changes, and two independent reviewers of the actual diff. A green test from the implementer alone does not close a checkpoint.

## 3. Practise on the paginate-bug challenge

The statement is in [challenges/paginate-bug/README.md](../challenges/paginate-bug/README.md). The starter is `paginate` from the Gauntlet benchmark fixture.

1. **Copy the starter.**

   ```powershell
   Copy-Item challenges\paginate-bug\starter.py $env:TEMP\mod.py
   ```

2. **Reproduce (red).** Before touching the code, turn the docstring into one failing check of your own:

   ```powershell
   Push-Location $env:TEMP
   python -c "from mod import paginate; assert paginate(list(range(10)), 1, 3) == [0, 1, 2], paginate(list(range(10)), 1, 3)"
   Pop-Location
   ```

   The starter fails with `AssertionError: [0, 1, 2, 3]`: page 1 of size 3 returns four items. Then run the verifier to see the whole contract:

   ```powershell
   python harness\challenges.py verify paginate-bug $env:TEMP\mod.py
   ```

   It prints a JSON verdict and exits 1. With the unchanged starter: `"verdict": "FAIL"`, `"reason": "3 failed check(s) in 7 tests"`, plus the submission's and the verifier's sha256 and the test output.

3. **Fix (green).** Make the smallest change that honours the docstring, in `$env:TEMP\mod.py`. Rerun your check, then the verifier until it prints `"verdict": "PASS"` and exits 0. Keep the input validation: `submissions/negative.py` shows a fix that passes the page tests and still fails, because it silently returns `[]` for page 0.

4. **Record your progress.**

   ```powershell
   python harness\challenges.py progress record paginate-bug $env:TEMP\mod.py
   python harness\challenges.py progress show
   ```

   `record` verifies again and appends the verdict, the challenge version, the timestamp and both hashes to your progress file; a failed attempt is recorded too. `show` works in any later session:

   ```
   local-owner: revision 1 (...\OmniForge\data\progress\local-owner.json)
   paginate-bug: completed v1 at 2026-09-26T04:54:28+00:00; 1 attempt(s)
   ```

   The file is `$env:OMNIFORGE_DATA_DIR\progress\<member>.json`, or `%LOCALAPPDATA%\OmniForge\data\progress\<member>.json` when that variable is unset. `--member <label>` keeps a separate file per member (default `local-owner`).

5. **Review.** Read `submissions/positive.py` and `submissions/negative.py`, and compare them with your diff. Could you point to the test that proves each line of your fix is needed?

## 4. Run it on a real task

In the OmniForge Lab ([docs/omniforge/LAB.md](../docs/omniforge/LAB.md)): open the project, go to **Workflows**, pick **Do bug à evidência** under "Sugestões · revisar antes de salvar", review it, tick the confirmation and **Salvar no projeto**. Selecting a step then offers "Criar … tarefas até este nó": this only records local, open tasks with the pinned workflow version; no model runs until you send a prompt yourself.

In a Claude Code or Codex session, name the skill (`checkpoint-build`) and use `/tdd` for the red-green loop. Paste the three step prompts from `~/.omniharness/library/engineering-checkpoint.workflow.json` when you want the exact wording.

## What can fail

| Symptom | Cause | Fix |
|---|---|---|
| `library.py verify` or `install` prints `FAIL  <entry>` | The source differs from its pinned sha256 (a local edit or an unreviewed update) | `git diff` the source; re-pin in the manifest only after the change is reviewed |
| `uninstall` prints `Triage:` and exits 1 | You edited the installed copy, or something else sits at the target | Nothing was removed; keep, move or delete it yourself |
| verdict `FAIL`, reason `timeout after 20s` | An infinite loop in the submission | Fix the loop; the verifier stops the child process |
| verdict `FAIL`, reason `no test result: the run ended early` or `exit code N` | The submission exits or crashes while imported | Remove the `exit` or the crash at import time |
| `record` exits 3 with `conflict:` | Another writer changed the progress file while you verified | Nothing was written; run `record` again |
| `record` or `show` exits 2 with `error:` | An unknown challenge, an invalid member label or an unreadable progress file | Fix the argument; an unreadable progress file is left untouched for you to inspect |

## Safety

The verifier is **not a sandbox**. It runs the submission as you, with your files and network, and a timeout stops only the child process it started. Verify only code you wrote or have read, until the isolation boundary tracked as V-04 in [VALIDATION-PENDING.md](../docs/omniforge/VALIDATION-PENDING.md) holds.

## Links

- Skill: [.agents/skills/checkpoint-build/SKILL.md](../.agents/skills/checkpoint-build/SKILL.md)
- Template source: `PRESETS` in [omniforge-lab/workflows.mjs](../omniforge-lab/workflows.mjs)
- Library and challenge CLI: [docs/omniforge/PILLAR-4-LIBRARY.md](../docs/omniforge/PILLAR-4-LIBRARY.md)
