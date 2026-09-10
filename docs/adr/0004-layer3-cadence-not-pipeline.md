# ADR 0004: the academic layer is a review cadence plus scripts, not the twelve-agent factory

Date: 2026-09-10. Status: accepted.

## Context

The thesis factory (a Cowork plugin with a twelve-agent blueprint and an eight-node Workflow script) never executed: its output directories held only README files. The dissertation was written through a documented chat cadence: a numbered parecer, the author's verdicts item by item, a confirmed plan, the edit, a diff and integrity check, delivery of the `.tex` with a changelog. The factory's rules contradicted the author's binding style rules (decimals, voice), hard-coded one dissertation's metric names, audited an LLM digest instead of the CSVs, asked for experiments the author had forbidden, and let an agent mutate the style file unasked. The dissertation is finished; the next users are an article under review and future papers.

## Decision

Layer 3 is one portable skill, `thesis-review`, whose workflow is that cadence and whose gates are subcommands of one stdlib script: `facts` (set membership of every CSV value at manuscript precision against the numerals in the `.tex`), `style` (the author's actual criteria, skipping verbatim and listing blocks), `integrity` (no changes outside the target chapter, label and citation closure, a numbered changelog) and `bib`. The style rules are kept verbatim as a reference file the model never edits; the judge rubric survives as reference text loaded only for a scored parecer; every domain token moves to a per-manuscript `project.md` whose path travels in the invocation. Missing values are `—` or `n/a` plus a limitations item, never a request for a run.

## Consequences

Nothing is drafted from raw results. Ideas from the factory that were never exercised (crawler, gap matrix, self-updating registry, patience loop, a parallel-lens judge workflow) are not rebuilt; a peer-panel reference can be added the day a panel-style parecer is requested. Compilation runs in Docker (`texlive/texlive`, first pull gated) because no TeX is on the audited machine's PATH.
