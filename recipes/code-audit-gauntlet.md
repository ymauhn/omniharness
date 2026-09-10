# Recipe: code audit with the Gauntlet

A full adversarial audit of a codebase: hunters per area in parallel rounds, every finding refuted by independent lenses, a severity report, a fix loop with a hard iteration cap, and hygiene that leaves no probe files behind.

Owner of every behaviour below: `gauntlet/SKILL.md` (the six phases) and `gauntlet/gauntlet.workflow.js` (the driver). Config format: `gauntlet/args.exemplo.json`. Do [first-hour.md](first-hour.md) once before this.

Cost: paid, per preset. The numbers below are measured, not guessed.

## Prerequisites

- `python scripts/install.py --check` reports no drift (the installed driver equals `gauntlet/gauntlet.workflow.js`).
- The target repository is a git repo. Untracked files are fine.
- A test or build command that passes today, or the honest statement that there is none.

## The six phases at a glance

| Phase | Who acts | Spends | What happens |
|---|---|---|---|
| 0 Reconnaissance | skill | no | snapshot untracked files, read `.claude/gauntlet-loop.json` or derive `verificar` and areas from the manifest, `git log -5`, last diff |
| 1 Questions | you | no | one `AskUserQuestion`: areas, depth, scope, fix policy |
| 2 Driver | workflow | yes | hunters per area in rounds, merge near-duplicates, N lenses per finding, stop on dry / rounds / ceiling |
| 3 Report | skill, then you | no | severity table, refuted list, one question round for fixes and `decisaoNecessaria` items |
| 4 Fixes | skill | tokens | failing test first, minimal fix, verify, at most 5 attempts per finding |
| 5 Close | skill | no | full `verificar`, hygiene diff, summary, offer commit and config |

## Presets and the cost formula

| Preset | max rounds | dry rounds to stop | lenses | findings per round | effort |
|---|---|---|---|---|---|
| `rapido` | 2 | 1 | 2 | 8 | medium |
| `padrao` | 5 | 2 | 3 | 20 | medium |
| `profundo` | 8 | 3 | 4 | 40 | refuter high |

Survival rule: a finding survives when refuters are a strict minority. A tie is refuted; under `rapido` (2 lenses) one lens is enough to kill.

Upper bound of agents (the real run converges earlier when it dries up):

```
agents_max = areas × maxRounds + maxFindingsPerRound × maxRounds × lenses
```

With 6 areas: `rapido` ≈ 44, `padrao` ≈ 330, `profundo` ≈ 1 328 (the harness cuts at 1 000). At the measured mean of 8.3k output tokens per agent: `+300k` ≈ 36 agents ≈ one whole `rapido`; `+1M` ≈ 120 agents; a complete `padrao` on this repo consumed about 2.5M output tokens. Per agent the measured input is 156k new plus 3.3M cache read, so the dollar cost is dominated by cache reads; `+Nk` caps output only. Use `/cost` for money.

The trigger controls all of it:

```
/gauntlet-loop [rapido|padrao|profundo] [+300k] [areas=a,b] [desde=<ref>] [so-relatorio] [sem-perguntas] [free text = FOCO]
```

`desde=<ref>` narrows scope to `git diff --stat <ref>`; `areas=` filters by `key`; `so-relatorio` stops after Phase 3; `sem-perguntas` skips Phase 1 (all areas, `padrao`, fix alta+média); any other text becomes `FOCO:` in the hunters' context.

## Steps

1. **Write `.claude/gauntlet-loop.json` in the target repo.** Five stable keys; the skill adds `raiz`, `preset`, `tetoTokens`, `escopo` and the "O QUE MUDOU / FOCO" block at run time. Worked example, adapted from `gauntlet/args.exemplo.json` for a TypeScript browser game with vitest (the same shape the skill's own smoke test used):

   ```json
   {
     "contexto": "Ladder Fighter: a single-page TypeScript game (Vite + vitest). Core loop in src/game/ladder.ts builds a bracket of opponents and advances the player; src/game/state.ts holds the reducer; src/ui/*.ts renders into a <canvas>. Experiments run with `npx vitest run <file>`; there is no server. Traps: the game uses requestAnimationFrame, so timing tests need vi.useFakeTimers(); localStorage is mocked in tests/setup.ts.",
     "verificar": [
       "npx tsc --noEmit",
       "npx vitest run",
       "npm run build"
     ],
     "regras": [
       "The player never faces themself in a bracket",
       "The last stage is always the boss",
       "Do not touch src/ui/legacy/* this round; it is scheduled for deletion",
       "Decided 2026-09-10: the 150 ms input debounce in src/ui/input.ts is intentional, do not report it"
     ],
     "areas": [
       {
         "key": "bracket",
         "prompt": "Read src/game/ladder.ts and tests/ladder.test.ts. Write a _gauntlet_ script that builds 200 random brackets with seeds 1..200 and asserts: no player-vs-self pairing, last stage is the boss, every opponent appears at most once. Report only pairings you produced and the seed that produced them. Each finding needs a scenario you EXECUTED; if none, return findings: []."
       },
       {
         "key": "state",
         "prompt": "Read src/game/state.ts. Drive the reducer with a _gauntlet_ script through win, lose, restart and back-navigation in every order of length 4. Look for dangling promises, listeners not removed, a stage that can be re-entered after the boss. Prove with the exact action sequence you ran."
       },
       {
         "key": "input-ui",
         "prompt": "Read src/ui/input.ts and src/ui/render.ts. Using vitest with fake timers, simulate a 320x568 viewport and rapid key presses; measure text clipping and any per-frame allocation in the render loop (count objects created in one frame). A finding is a number you measured, not an opinion."
       },
       {
         "key": "persistence",
         "prompt": "Read src/game/save.ts. Corrupt the localStorage payload in 10 ways (truncate, wrong version, NaN scores) and load. A crash or silent data loss is a finding; include the payload that caused it."
       }
     ],
     "prefixoTmp": "_gauntlet_"
   }
   ```

   Rules for writing prompts: ask for the experiment, not the opinion. Say where to look, what to run, what to measure and what counts as proof. "Run X and MEASURE" survives refutation; "look for performance problems" dies there.

   A `regras` line does two things. Violating one raises the finding's severity and puts it first in its band (`regraDoDono`). And a line that records a decision ("Decided …: the 150 ms debounce is intentional") stops that item from resurfacing: hunters see it in context and refuters treat it as settled, so no future run reports it again. Every time you answer "that is on purpose" in Phase 3, add the sentence here.

2. **Check the baseline by hand once.** Run each `verificar` command yourself. A command that is red today must be labelled "already failing before the gauntlet" in `contexto`, otherwise every hunter reports it.

3. **Checkpoint.** From the harness repo:

   ```bash
   python evals/run.py checkpoint <case>
   ```

   (`<case>` labels the tag, e.g. `gauntlet-rapido`; `git tag -f ckpt/<case>/<ts> $(git stash create || git rev-parse HEAD)` plus an untracked-files snapshot.) `record` later refuses a result without this tag. `run.py` runs git with `cwd` at the harness repo root, so this tag lands on the harness repo; tag the target repo by hand from inside it with the same command and snapshot its untracked files (`git status --short | grep '^??' | sort > "$SCRATCH/gauntlet-antes.txt"`, the file step 8 diffs against).

4. **Launch.**

   ```
   /gauntlet-loop padrao +1M
   ```

   Phase 0 finds the config and only adds "what changed". Phase 1 asks its single round.

   STOP: confirm. The Phase 1 answer is the spend authorisation. The depth options carry the agent estimate for your real number of areas; with 4 areas as above, `padrao` ≈ `4×5 + 20×5×3 = 320` agents max. If that is more than you want, answer `rapido` or add `areas=bracket,state` to the trigger and rerun.

5. **Do not touch the scope while it runs.** Hunters are measuring live files. Follow with `/workflows`; the driver logs `rodada n/N — k confirmado(s) — tokens X de Y` per round. The result object arrives as a notification: `{ confirmados[], naoVerificados[], refutados[], resumo, vistos[] }`.

6. **Read the Phase 3 report and answer once.** The skill prints the severity table before touching any file, then one `AskUserQuestion`: which to fix (todos / só alta / alta+média / nenhum, pre-selected from Phase 1) plus one question per `decisaoNecessaria` finding with the options the hunter listed in `correcao` and "leave as is". More than four decisions are grouped by theme into a second call, never one at a time.

   STOP: confirm. This is where you decide. Anything you mark "leave as is, it is intentional" goes into `regras` (step 1) so it never comes back.

   With `so-relatorio` the run ends here.

7. **The fix loop (Phase 4).** Order alta → média → baixa, grouping findings in the same file. Per finding:
   1. If the project has a test runner, the skill writes the failing test first, translated from `cenario`/`evidencia`, under a permanent name (no `_gauntlet_` prefix; it stays).
   2. Minimal fix; `correcao` is a starting point, not an order.
   3. Quick verify: the new test plus the cheapest `verificar` command covering the file.
   4. **Five attempts, then stop.** On the fifth without green the skill runs `git checkout -- <files it touched>` for that finding, marks it "não resolvido" with what was tried, and moves on. It never leaves a half-fix in the tree.
   5. Anything depending on a balance number, product behaviour or UX choice that was not decided in step 6: the skill stops and asks. It does not invent the number.
   6. No commit without asking.

8. **Close (Phase 5).** The skill runs every `verificar` command in full and pastes the summary (n tests green, build ok; a failure is named, never hidden). Then hygiene:

   ```bash
   find . -name '_gauntlet_*' -not -path './node_modules/*' -print; echo "sobras: $(find . -name '_gauntlet_*' -not -path './node_modules/*' | wc -l)"; git status --short | grep '^??' | sort > "$SCRATCH/gauntlet-depois.txt"; comm -13 "$SCRATCH/gauntlet-antes.txt" "$SCRATCH/gauntlet-depois.txt"
   ```

   `_gauntlet_*` files are deleted (single-file `rm` is free in the gate on purpose). Anything else new and untracked that the `comm` shows is listed and you are asked; it may be another run's leftover (`__zz_probe_*`, `_tmp-*`) or your own file. Nothing is deleted on your behalf.

   STOP: confirm. Two offers at the end: the commit (message listing the fixed findings; `git commit` is on the ask list) and, if the repo had no config yet, saving this run's `contexto/verificar/regras/areas` to `.claude/gauntlet-loop.json`.

9. **Record the baseline.** From the harness repo, `python evals/run.py record <result.json> <case>` stores the result object as one JSON in `evals/results/` (it refuses without the `ckpt/<case>/*` tag and without `evals/cases/<case>/check.py`); `python evals/run.py regress` compares the newest run against the median of the previous five (pass drop or a 1.2× cost jump prints one line each) once five exist. AGENTS.md invariant 4: a reported drop is a reason to run the Gauntlet again.

10. **Rerun without paying twice.** Take `vistos[]` from the previous result and pass it as `jaVistos`. Hunters skip those `file:line — title` keys, so a rerun costs only what is new. Measured on the smoke test: the same call with `jaVistos` set went from 3 agents / 90 s / 112k tokens to 1 agent / 68 s / 42k, zero new findings. Benchmark B2 expects the seeded second run to use at most 4 agents. Typical shape after a fix round:

    ```
    /gauntlet-loop rapido +300k desde=ckpt/<case>/<ts>
    ```

    with the skill passing `jaVistos` from the stored record. `desde=` limits the hunt to what changed since the checkpoint, which is exactly the fixes you just made.

## Hygiene, in one place

- Every probe an agent writes carries the `prefixoTmp` (`_gauntlet_` by default) and is deleted by the agent before it answers; verified in the smoke test (`sobras: 0`).
- Phase 0 snapshots untracked files; Phase 5 diffs. What escaped the prefix shows up there and is triaged, not deleted.
- Tests written in Phase 4 are permanent and named normally.
- The checkpoint tag lets you `git diff --stat ckpt/<case>/<ts>` at any time; on a report-only run that diff must be empty.
- `.gitignore` in this repo carries `_gauntlet_*`; add the same line to the target repo if it lacks one.

## What can fail

- **`parouPor: "teto"` with a large `naoVerificados` list.** The ceiling arrived before refutation. Those items are suspicions, not findings. Rerun with a larger `+Nk`, fewer `areas=`, or seed `jaVistos` with the confirmed ones so the budget goes to the unverified batch.
- **`parouPor: "secou"` after round 1 with `agentesFalhos` > 0.** Hunters returned nothing. On the patched driver a null round no longer bumps the dry counter, but check `resumo.agentesFalhos` before trusting a clean result.
- **A finding appears that you already decided.** Its decision is not in `regras`, or the run did not receive `jaVistos`. Add the line; reruns respect it.
- **Refuted findings you believe are real.** The lens name in the refuted list says why it fell. You can override in Phase 3 by asking for the fix explicitly; the tie-kills bias is deliberate and documented.
- **A fix loops five times.** The skill reverts and reports "não resolvido" with the attempts. Take it manually or narrow the scenario; do not raise the cap.
- **Registry does not see the driver after a reinstall.** The name cache is per cwd; `cd` into a subfolder in one Bash call or restart the session (gotchas in `gauntlet/SKILL.md`).
- **`args` passed as a string.** `a.areas.length` explodes. The skill passes an object; never call `/gauntlet-driver` directly.
- **`node --check` on the driver says `Illegal return statement`.** Normal: the harness wraps the body in an async function. The wrapped syntax check is in the skill's Troubleshooting section, and `node tests/test_driver.js` runs the body for real.
