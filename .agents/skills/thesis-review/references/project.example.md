# project.md (template)

Copy this file into the manuscript's repository as `project.md`, fill it in, and pass its path when invoking `thesis-review`. Everything domain-specific lives here so the skill stays generic.

## Manuscript

- Title:
- Kind: thesis chapter | conference paper | journal article | revise-and-resubmit
- Language of the text: (rules below assume English prose; state the decimal separator convention of the result files if it differs)
- Chapter or section under review, its `\chapter` label and its label prefix (e.g. `cap:resultados`; `sec:res_`, `tab:res_`, `fig:res_`):
- Earlier chapters whose notation binds this one (paths):

## Result files (ground truth)

| File | What it holds | Delimiter and decimal separator | Notes |
|---|---|---|---|
| `results/all.csv` | one row per run and split | `;` and comma | converted to point by the checks |

Selection rule: (e.g. "select on validation, report test once").

## Metrics and precision

| Column | Name in prose | Decimals | Direction |
|---|---|---|---|
| `wfmax` | `w_fmax` | 4 | higher is better |
| `smin` | `smin` (bits) | 2 | lower is better; say so in every caption |

## Names

- Baselines (exact spelling):
- Model variants:
- Splits:
- Symbols already defined (with the equation or section that defines them):

## Terminology (use / do not use)

| Use | Do not use |
|---|---|
| fixed, non-parametric propagation | propagation (when the contrast with a trained model matters) |

## Venue overrides

Two or three lines when the venue's rules differ from `style-rules.md` (voice, decimals, citation style). Nothing here means the style rules apply unchanged.

## Interpretability threshold

Differences below (value) are not interpreted as differences. Statistical tests: (none | which).
