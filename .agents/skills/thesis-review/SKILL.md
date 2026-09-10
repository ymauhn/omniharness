---
name: thesis-review
description: Audit or revise an existing LaTeX thesis or paper section against its result CSVs and binding style rules. Produces a numbered parecer the author answers item by item, applies only the confirmed items, verifies the edit with diff and integrity checks, and delivers the .tex plus a changelog. Use for a parecer on a chapter, revise-and-resubmit with a reviewer letter, style and fact checks, or bibliography QA. Never drafts from scratch, never invents a number, never asks for a new experiment.
license: MIT
compatibility: Python 3.10+ for scripts/thesis_checks.py (stdlib only). The compile gate needs Docker (texlive/texlive) or a LaTeX .log supplied by the author.
metadata:
  version: "0.1.0"
  layer: academic
---

# thesis-review

A review cadence, not a drafting pipeline. The manuscript already exists; the numbers already exist in result files; the author decides every change. Scripts run the gates at zero tokens; the model writes the parecer and applies what was confirmed.

## Inputs (explicit paths, no crawling)

- The `.tex` file or chapter to review.
- The result CSVs that are the ground truth for every number (list them; do not search for them).
- `project.md` for this manuscript: metric names and precision, label prefixes, split and baseline names, terminology. Template in `references/project.example.md`.
- Optional: a reviewer letter (turns the parecer into revise-and-resubmit, one item per reviewer point).

Read `references/style-rules.md` before any edit. Read `references/rubric.md` only when a scored parecer is requested.

## Modes

| Mode | What happens |
|---|---|
| `parecer` | Numbered audit of a section or chapter (`C6-1`, `C6-2` …; `R1-1` per reviewer point). Questions only for decisions the author must make. |
| `apply` | Edit only the items the author confirmed, then run the gates again. |
| `check` | Run `scripts/thesis_checks.py` (facts, style, integrity) and report. |
| `bib` | Run `scripts/thesis_checks.py bib` on a `.bib` and `.blg`. Becomes its own skill on its second use. |

## Cadence

1. **Gates first, at zero tokens.** `python scripts/thesis_checks.py facts --csv <files> --tex <file>` and `python scripts/thesis_checks.py style --tex <file> --chapter <label> --prefix <res_>`. Read only the unmatched numerals and the style hits; never load the CSVs into context.
2. **Parecer.** One item per issue: id, section, the claim, the evidence line, the proposed change. Severity comes from the rubric. Learned rules go into a `learnedRules` list in the reply for the author to accept by hand into `style-rules.md`; never edit that file yourself. The judge never rewrites the draft.
3. **One question round.** Present the numbered items and the decision questions together. On Claude use AskUserQuestion; elsewhere a numbered list. The author answers with number plus verdict.
4. **Confirm the plan** in one line before touching the file: which items, which sections.
5. **Apply only confirmed items.** Then `python scripts/thesis_checks.py integrity --orig <before.tex> --new <after.tex> --chapter <label> --out REGISTRO_ALTERACOES.md`: zero changed regions outside the chapter, word-level diff, label, `\ref` and `\cite` closure, and a changelog in numbered before/after/where blocks. Run `facts` and `style` again.
6. **Compile gate.** `docker run --rm -v "$PWD":/w -w /w texlive/texlive latexmk -pdf <main>.tex` (the first pull is about 2 GB and is a network action: confirm first), or grep a `.log` the author downloaded from Overleaf. Fail on `Overfull`, `undefined`, `Citation .* undefined`.
7. **Deliver** the `.tex` and `REGISTRO_ALTERACOES.md`. Report your own errors unprompted.

Four stop-and-check lines before delivery: no number without `facts`; no section without `style`; no chapter without a clean `integrity` and an overfull-free compile; no author decision taken by the workflow.

## Rules this skill enforces

- Every numeric claim matches a value in the CSVs at the manuscript's precision. Missing values are `—` (run absent) or `n/a` (not applicable by construction), never invented.
- No new experiments. Anything that would need a run goes to future work or the limitations subsection.
- Notation, labels and terminology follow `project.md` and the earlier chapters; the manuscript wins over the model's expectations.
- Never touch the author's manual edits. If a passage differs from what you expected, assume it was edited on purpose.
- Missing cells become `—` plus one item in the numbered limitations subsection, each item saying what it prevents concluding.

## What this skill never does

Draft a chapter from raw results. Recompute or "correct" a number. Ask the author to run an experiment. Edit the style rules. Commit.

## References (loaded by phase)

- `references/style-rules.md`: the binding style rules, verbatim from the author. Before any apply.
- `references/rubric.md`: priorities, judge dimensions and caps, anti-inflation lines, report format. Only for a scored parecer.
- `references/project.example.md`: template for a new manuscript's `project.md`. Only when bootstrapping.
