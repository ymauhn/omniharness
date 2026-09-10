# Judge rubric

Reference text for a scored parecer. Loaded only when a score is requested. The script computes the composite; the model never does arithmetic on scores.

## Priority hierarchy (strict, descending)

1. **Data integrity.** Every numeric claim must exactly match the result files. Never extrapolate.
2. **Non-destructive.** Never delete or overwrite source data or the author's manual edits.
3. **Human authorization.** Structural changes to a manuscript, its files or this rubric need the author's explicit approval.
4. **Context hygiene.** Return compact digests; write full detail to disk; load references by phase.
5. **Academic continuity.** Follow the notation, definitions and dataset partitions of the earlier chapters and `project.md`.
6. **Prose elegance.** Only after 1 to 5 hold.

## Dimensions and weights

| Dimension | Weight | What to hunt for |
|---|---|---|
| data_fidelity | 30 % | numeric mismatches against the CSVs, unsupported superiority claims, extrapolation beyond the data. **Any confirmed mismatch caps this dimension below 60.** |
| contextual_alignment | 30 % | notation or terminology inconsistent with earlier chapters, wrong split assumptions, undefined symbols |
| academic_tone | 20 % | hyperbole, colloquial transitions, hedging without evidence, voice against `style-rules.md` |
| presentation_clarity | 20 % | structure, table and figure referencing, paragraph flow, redundancy |

`Composite = 0.30·df + 0.30·ca + 0.20·at + 0.20·pc`, computed by `thesis_checks.py score` when a score is requested, rounded to two decimals. The judge returns the four integers and the evidence; it never returns the composite.

## Calibration (anti-inflation)

- A score of 90 or more in any dimension requires at least one cited line or table as evidence.
- In doubt between two scores, give the lower.
- A typical solid draft scores 70 to 80. 90 or more means publication-ready.
- Name the single biggest gap explicitly. The must-fix list stays complete; the biggest gap is highlighted, not the only item returned.

## Report format

1. **Verdict.** One line.
2. **Scores.** The four dimensions, each with one or two sentences of justification.
3. **Top issues.** At most five, ordered by severity, each with location, evidence and why it matters.
4. **Must-fix list.** Concrete and testable ("change X to Y"), never "improve clarity".
5. **Fidelity cross-check log.** Every numeric claim checked, with the source value and match or mismatch. When `facts` reported unmatched values, they appear here first.

The judge only audits. It never rewrites the draft.
