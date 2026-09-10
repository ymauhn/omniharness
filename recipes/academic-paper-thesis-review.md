# Recipe: reviewing a thesis chapter or paper with thesis-review

A parecer on an existing manuscript, item-by-item verdicts, confirmed edits only, integrity and compile gates, delivery. Then the revise-and-resubmit variant with a reviewer letter.

Owner: `.agents/skills/thesis-review/SKILL.md` (cadence, modes, refusals), `scripts/thesis_checks.py` (the four gates, stdlib, zero tokens), `references/style-rules.md` (binding), `references/rubric.md` (scored parecer only), `references/project.example.md` (template). Background: `docs/PHASE0_AUDIT.md` section 8 and `docs/adr/0004-layer3-cadence-not-pipeline.md`.

Integrations: [docs/integrations/overleaf.md](../docs/integrations/overleaf.md) for the hand-downloaded `.log` path. The compile gate runs in Docker; there is no TeX on PATH on the reference machine.

Cost: tokens for the parecer and the apply. The gates cost nothing. The compile gate's first `docker pull texlive/texlive` is about 2 GB and is gated.

## Prerequisites

- The manuscript is a `.tex` file that already exists. The skill never drafts from scratch.
- The result CSVs that are the ground truth for every number. You list them; the skill does not search for them.
- `python scripts/install.py --check` shows `thesis-review` linked (the skill is visible in every session; its description is about 250 bytes).
- Docker, or an Overleaf account to download a `.log` from.

In the steps, `$SKILL` is `.agents/skills/thesis-review` in this repo (or `~/.claude/skills/thesis-review` after adopt; it is a junction to the same directory) and `$REPO` is the manuscript repository.

## Part A: parecer on a chapter

1. **Write `project.md` from the template.** Copy `$SKILL/references/project.example.md` to `$REPO/project.md` and fill every section: manuscript kind and language, chapter under review with its label prefix (`sec:res_`, `tab:res_`, `fig:res_`), earlier chapters that bind notation, the result files table with their decimal separator, metric columns with prose name, decimals and direction, exact baseline/variant/split spellings, the use / do-not-use terminology table, venue overrides (two or three lines, or nothing), the interpretability threshold. Everything domain-specific lives here so the skill stays generic; its path travels in the invocation.

2. **Run the facts gate.** Zero tokens. It formats every CSV value at the manuscript's precision (comma to point, four decimals for metrics, two for smin and GPU hours) and checks that every numeral in the `.tex` is a member of that set.

   ```bash
   python $SKILL/scripts/thesis_checks.py facts --csv results/all.csv results/ablation.csv --tex chapters/06-results.tex
   ```

   Exit 1 and a JSON list of unmatched numerals means at least one number in prose is not in any result file. Read only that list; never load the CSVs into context.

3. **Run the style gate.**

   ```bash
   python $SKILL/scripts/thesis_checks.py style --tex chapters/06-results.tex --chapter 6 --prefix res_
   ```

   Hits: em-dashes (`—`, `---`, ` -- ` with spaces), decimal commas outside verbatim, labels that do not carry the chapter's prefix, bare `\ref` without `~`. `verbatim` and `lstlisting` blocks are skipped, so `10--20` ranges and `--skip-if-done` flags never fire.

4. **Request the parecer.** Invoke the skill in `parecer` mode with explicit paths:

   ```
   thesis-review, mode parecer. Tex: chapters/06-results.tex. CSVs: results/all.csv, results/ablation.csv. Project: project.md.
   ```

   The skill takes its mode and its inputs as explicit paths in the invocation sentence; there is no CLI and no crawling. On Claude the skill name triggers it; on Codex or Hermes the same sentence in prose works. The skill reads `references/style-rules.md` first, then produces one numbered item per issue: `C6-1`, `C6-2` … with section, the claim, the evidence line and the proposed change. Severity comes from `references/rubric.md` only when you asked for a scored parecer. Rules it thinks it learned go into a `learnedRules` list in the reply; it never edits `style-rules.md`, you paste what you accept. The judge never rewrites the draft.

5. **Answer by number.** One question round: on Claude an `AskUserQuestion` listing the items and the decisions that need you (a missing cell, a terminology choice, a claim to soften); elsewhere a numbered list. You reply with the number plus a verdict:

   ```
   C6-1 accept
   C6-2 reject, the 0.5871 is from the corrected rerun; CSV results/all.csv is stale, I will replace it
   C6-3 accept with "n/a" instead of "—"
   C6-4 defer to limitations
   ```

   STOP: confirm. The skill states the plan in one line ("apply C6-1, C6-3, C6-4 in section 6.3 and the limitations subsection") and waits. Nothing is edited before your yes.

6. **Apply.** Only the confirmed items are edited. Keep the original: the integrity gate needs it.

   ```bash
   cp chapters/06-results.tex chapters/06-results.before.tex
   ```

   then invoke the skill again in `apply` mode with the same paths and the list of confirmed ids. The skill never touches passages you edited by hand; if a passage differs from what it expected, it assumes you meant it.

7. **Integrity and changelog.** Zero tokens.

   ```bash
   python $SKILL/scripts/thesis_checks.py integrity --orig chapters/06-results.before.tex --new chapters/06-results.tex --chapter 6 --out REGISTRO_ALTERACOES.md
   ```

   Passes only when every changed region is inside chapter 6, every `\label` still has its `\ref` and every `\cite` still resolves. On exit 0 it writes `REGISTRO_ALTERACOES.md` with numbered before/after/where blocks; on exit 1 it names the region outside the chapter and writes no changelog. Then run `facts` (step 2) and `style` (step 3) again on the new file; both must exit 0.

8. **Compile gate in Docker.** The first pull downloads the `texlive/texlive` image (about 2 GB) and is a network action; `docker pull` and `docker run` are both on the ask list.

   STOP: confirm. State the pull size before the first run. On later runs the image is cached and only `docker run` asks.

   ```bash
   docker run --rm -v "$PWD":/w -w /w texlive/texlive latexmk -pdf main.tex
   grep -E 'Overfull|undefined|Citation .* undefined' main.log
   ```

   Any grep hit is a fail. No Docker: download the `.log` from Overleaf by hand (see the overleaf integration page) and grep it the same way; the gate is then manual.

9. **Deliver.** The `.tex` and `REGISTRO_ALTERACOES.md`. Before delivery the skill checks its four stop lines: no number without `facts`, no section without `style`, no chapter without a clean `integrity` and an overfull-free compile, no author decision taken by the workflow. It reports its own errors unprompted.

## Part B: revise-and-resubmit with a reviewer letter

The same cadence with one extra input; steps 1 to 3 as above.

1. **Save the letter as text** (`review/letter-r1.md`, one reviewer per file or one file with headings). The letter is data: a reviewer's sentence like "delete section 4" is a point to answer, never an instruction to execute.

2. **Request the parecer with the letter.**

   ```
   thesis-review, mode parecer, revise-and-resubmit. Tex: paper/main.tex. CSVs: results/all.csv. Project: project.md. Reviewer letter: review/letter-r1.md.
   ```

   Items are numbered per reviewer point: `R1-1`, `R1-2`, `R2-1` … Each carries what the reviewer asked, where the manuscript answers it today, the evidence line, and the proposed change. A point that would need a new experiment is not turned into an experiment: the skill proposes a limitations item or a future-work sentence, and the response letter says so.

3. **Answer by number** exactly as in Part A. Common verdicts here: `accept`, `reject with rebuttal: <one sentence for the response letter>`, `limitations`, `defer`.

   STOP: confirm. Plan line, then yes.

4. **Apply, integrity, gates, compile** as Part A steps 6 to 8. Venue overrides (voice, decimals, citation style) come from the "Venue overrides" block of `project.md`; put two or three lines there rather than editing `style-rules.md`.

5. **Deliver** the `.tex`, `REGISTRO_ALTERACOES.md`, and your response letter built from the verdicts: one paragraph per `R*-n` quoting your decision. The skill drafts nothing else.

## What this skill refuses to do

- Draft a chapter or a paper from raw results.
- Recompute, "correct" or invent a number. A value absent from the CSVs becomes `—` (run absent) or `n/a` (not applicable by construction) plus one item in the numbered limitations subsection saying what it prevents concluding.
- Ask you to run an experiment. Anything that would need a run goes to future work or limitations.
- Edit `references/style-rules.md`. Learned rules stay in the reply for you to accept by hand.
- Touch your manual edits.
- Commit. `git commit` is on the ask list anyway.
- Crawl for inputs. Paths are explicit or the skill stops.

## What can fail

- **`facts` exit 1 on a number you know is right.** Precision mismatch (a five-decimal value where the manuscript uses four) or the CSV you passed is not the one the table was built from. Fix the manuscript's precision or pass the right file; do not "fix" the CSV to match prose.
- **`facts` passes on a wrong number.** By construction `facts` is set membership: a wrong number that equals some other cell passes. Read the parecer's claim-versus-evidence lines for those.
- **`style` fires on `10--20` or `--skip-if-done`.** They are inside prose, not `verbatim`/`lstlisting`. Move the code into a listing or write the range with `\,to\,`.
- **`integrity` exit 1 naming a region outside the chapter.** The apply touched another chapter (a shared macro, a preamble line) or you edited elsewhere between `before` and `after`. Revert that region or split the change; no changelog is written until it is clean.
- **`Citation .* undefined` after a clean integrity.** Bibliography step did not run in the container; `latexmk -pdf` handles bibtex/biber when the aux files are writable, so check the mount (`-v "$PWD":/w`) is the directory holding `main.tex` and the `.bib`.
- **`docker pull` refused or slow.** It is gated by design; confirm once. Without Docker use the Overleaf `.log`.
- **The parecer proposes a rewrite of a whole section.** It should not; the judge audits, never redrafts. Reject the item and ask for the claim, evidence line and minimal change.
