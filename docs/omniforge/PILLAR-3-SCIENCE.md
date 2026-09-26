# Pillar 3 slice: NIST StRD Longley reproduction

Status: **implemented offline slice, reference run on one Windows host; no second-operator run recorded yet** · 2026-09-26

This is the V1 pillar 3 scenario from [the release contract](V1-RELEASE-CONTRACT.md): one pinned public experiment behind an input/environment/command/output manifest, a published numeric claim checked against the generated results, a retained failed check (a mutated manuscript claim that the facts gate rejects), and a cited section draft whose numerals are gated against the SVD results. Files live in [`experiments/nist-longley/`](../../experiments/nist-longley/). The offline test is `tests/test_nist_longley.py`.

## Manifest summary

| Part | Content |
|---|---|
| Claim | NIST certified values for the Longley linear least-squares problem (7 parameters, 16 observations, "higher level of difficulty"). NIST computed them to 500 digits and rounded them to fifteen significant digits. Checked: 7 estimates, 7 standard deviations, residual SD and R², 16 values in total. |
| Inputs | `data/Longley.dat` (sha256 `fc4b0c82…80ea`), `data/v-Longley.shtml` (certified values, sha256 `95b1c087…a405`), `data/Longley.shtml` (landing page, sha256 `5c0dbee1…97e4`). Fetched from `https://www.itl.nist.gov/div898/strd/lls/data/` on 2026-09-26 between 04:45:03Z and 04:45:21Z. Full URLs and hashes are in `manifest.json`. `.gitattributes` keeps the served CRLF bytes. |
| Transcription | `certified.json` holds the page's strings verbatim. The test checks each string against both the page and lines 31 to 51 of `Longley.dat`. |
| Environment | Python ≥ 3.10 and numpy ≥ 1.26, no network. numpy is declared in `experiments/nist-longley/requirements.txt` as numpy ≥ 1.26 (the reference run used 2.3.5, recorded in `results/run.json`); it is also a dependency of the repository test run (`tests/test_nist_longley.py`, see [install](../install.md)). Each run records Python, numpy, BLAS/LAPACK build, platform, cond₂(X) and the input/output sha256 in `results/run.json`. |
| Commands | `run.py` fits two ways and writes one CSV per method: `lstsq`, which is `numpy.linalg.lstsq` (LAPACK SVD) with SDs from the same SVD, and the **control** `normal-equations`, which is the naive `inv(X'X) @ X' @ y` in float64. `check.py --method M` scores each value of `results/M.csv` by `LRE = -log10(|x-c|/|c|)`, clipped to [0, 15], with a non-finite result scoring 0. It returns PASS only if every LRE ≥ `threshold_lre`. The facts gate reads `results/lstsq.csv` only, so a control value cannot pass as an SVD result. |
| Threshold | `threshold_lre = 5`, declared in the manifest. Git history cannot show that it preceded the comparison: the threshold, the results and the checks entered together in commit `bb99a59`, whose message says "declared before the comparison"; that wording is not substantiated. Basis: the bound −log10(cond₂(X)·ε) is 5.97 digits for this design matrix (cond₂(X) = 4.859e9), floored to 5. It is a normwise bound; applied to each value it is a heuristic, not a guarantee. |
| Outputs | `results/lstsq.csv`, `results/normal-equations.csv`, `results/run.json`, `results/check-lstsq.json`, `results/check-normal-equations.json`, and `draft/section.tex` with `draft/references.bib`. |

## Reference run (this repository, 2026-09-26)

Windows-11-10.0.26200, Python 3.12.14, numpy 2.3.5, scipy-openblas 0.3.30 (BLAS and LAPACK); the same build as the bundled Codex runtime Python that `scripts/check.ps1` selects on this host (how numpy was installed into it is not recorded). The pooled `results.csv` sha256 was `80f062d7…da57`, identical across two runs. After the per-method split the same values give `lstsq.csv` `990efb97…19e2` and `normal-equations.csv` `bee6e9f3…6aab`, again identical across two runs; both check outputs were byte-identical to the earlier ones.

| Check | Role | Verdict | Minimum LRE | Weakest value |
|---|---|---|---|---|
| `lstsq` (SVD) | acceptance | **PASS** | 10.93 | B1 |
| `normal-equations` | control, informational | PASS | 7.41 | B5 |
| facts gate, `draft/section.tex` vs `results/lstsq.csv` | acceptance | **PASS** | 8 of 8 decimals matched | none |
| facts gate, `draft/section-mutated.tex` vs `results/lstsq.csv` | retained failed check | **FAIL** (expected) | 1 unmatched: `304.8542` | residual SD claim with one altered digit |

**The control is not the failed check.** The brief expected the naive normal equations to fail, since cond₂(X'X) = cond₂(X)² = 2.361e19 exceeds 1/ε and so no digit is guaranteed (numpy's `cond` of the computed X'X reads 2.384e19 because that matrix is numerically singular in float64). They still kept at least 7.41 digits. The column-scaled cond₂(X) of 4.328e4 explains the gap. It predicts about 6.4 digits for the normal equations and about 11.0 for the SVD solve, against 7.41 and 10.93 observed; the unscaled worst-case bound was pessimistic. The threshold was **not** raised to force a failure. The search found no verifiable literature threshold above 5 digits, and one unverified secondary summary attributes "four or five digits" to McCullough (1998). Any value between 7.41 and 10.93 would have been chosen by looking at the results. The control's per-value LREs stay committed, and the manifest labels it `commands.control`. The **retained failed check** is the mutated manuscript claim: `draft/section-mutated.tex` states the residual standard deviation as 304.8542 instead of 304.8541, and the facts gate (`commands.failed_check`) rejects it with exactly that numeral. The test also rejects a sign flip of each sign (`-15.0619`, `3482258.6346`) and the control's B0 standard deviation (`890420.3862`) written as an SVD value. `check.py`'s FAIL path is exercised by a planted negative control in the test, where every value is off by a relative 1e-4 (LRE 4).

## Second-operator rerun

From a checkout of this branch. Use `py`, `python3` or a full interpreter path if `python` is not on PATH.

```
cd experiments/nist-longley
python -m pip install -r requirements.txt
python -c "import hashlib,json; m=json.load(open('manifest.json')); [print(i['path'], hashlib.sha256(open(i['path'],'rb').read()).hexdigest()==i['sha256']) for i in m['inputs']]"
python run.py
python check.py --method lstsq
python check.py --method normal-equations
python ../../.agents/skills/thesis-review/scripts/thesis_checks.py facts --csv results/lstsq.csv --tex draft/section.tex --decimal point
python ../../.agents/skills/thesis-review/scripts/thesis_checks.py facts --csv results/lstsq.csv --tex draft/section-mutated.tex --decimal point
git diff --stat -- results
cd ../..
python -m unittest tests.test_nist_longley
```

Expected: every input line prints `True`; the `lstsq` check prints `"verdict": "PASS"` and exits 0; the control prints its verdict (PASS and exit 0 in the reference run; FAIL and exit 1 is allowed, see below); the first facts gate exits 0 with `"unmatched": []`; the second, the retained failed check, exits 1 with `"unmatched": ["304.8542"]`; the unit test is `OK` with either control verdict. `run.py` overwrites the committed reference results, so `git diff -- results` shows exactly what differs in the operator's environment. Optionally re-download `Longley.dat` from its manifest URL and compare the sha256. The two `.shtml` pages embed a per-request Cloudflare token, so a fresh fetch differs in bytes. For those, compare the certified strings, not the hash.

## Environment differences

- **Acceptance is the verdicts, not the bytes.** The acceptance verdict is `lstsq` PASS together with the facts-gate pair (PASS on the draft, FAIL on the mutated claim). A different CSV sha256 or different low-order digits with the same verdicts is an **explained environment difference** when the operator's `run.json` differs in numpy, BLAS/LAPACK build, CPU kernel or platform. Keep both `run.json` files and the `git diff` as evidence.
- **Margins.** `lstsq` has 5.9 digits of margin over the threshold. The draft's four-decimal numerals can change only if a value sits within about 1e-10 relative of a rounding boundary. If the regenerated `results/lstsq.csv` fails the facts gate, report that as a difference; do not edit the draft to match. The unit test gates the draft against its own fresh rerun, so it shows this case.
- **The control is informational.** The normal equations have 2.4 digits of margin. A FAIL there on another BLAS/LAPACK is a documented environment difference of the control, recorded with `run.json`, as long as `lstsq` still passes. It is not a failed reproduction and not grounds to change the threshold. The unit test accepts either control verdict; it asserts only that the control scores all 16 values, agrees with fewer digits than `lstsq`, and is retained in `results/check-normal-equations.json`.
- **Not explainable by environment.** A `lstsq` FAIL, a changed input hash, or a certified string that no longer matches the committed sources is a failed reproduction, or a data change to investigate. Never lower the threshold or re-transcribe from memory to recover a PASS.

## Facts gate corrections

Two evaluator-correctness defects in `.agents/skills/thesis-review/scripts/thesis_checks.py` were fixed after the first slice commit, with regression cases in `tests/test_checks.py`:

1. A numeral directly followed by `,` or `.` (for example "84.9149, and") was skipped, never counted and never checked. `NUMERAL` now ends at `.` or `,` unless a digit follows. The draft no longer needs to keep numerals in `$…$`, and the test still asserts that the gate counts every decimal in the prose.
2. The minus sign was outside the numeral: a negative CSV value (`-3482258.6346`) could never match, and a sign flip in the text went undetected. A leading `-` or `−` (U+2212) is now part of the numeral unless it follows a word character, a closing bracket or another dash, where it reads as subtraction, a hyphen or a `10--20` range. The draft now cites the negative intercept.

Remaining limits: a sign typeset apart from its digits (`$-$0.5`, `- 0.5`, `\textminus`) is not read as a sign, and the gate still cannot tell which CSV column a numeral came from; the per-method results files keep the control out of this draft's gate.

## Sources

- NIST StRD Longley: [dataset page](https://www.itl.nist.gov/div898/strd/lls/data/Longley.shtml), [certified values](https://www.itl.nist.gov/div898/strd/lls/data/LINKS/v-Longley.shtml), [data file](https://www.itl.nist.gov/div898/strd/lls/data/LINKS/DATA/Longley.dat), [certification method](https://www.itl.nist.gov/div898/strd/lls/data/LINKS/c-Longley.shtml) (500-digit computation rounded to fifteen significant digits; no acceptance threshold is given).
- Longley, J. W. (1967), *Journal of the American Statistical Association* 62, 819–841, as cited on the NIST page.
- LRE conventions consulted, none of which gives a pass threshold for linear regression: [Wikibooks, Numerical Comparison of Statistical Software](https://en.wikibooks.org/wiki/Statistics/Numerical_Methods/Numerical_Comparison_of_Statistical_Software) and [SAS, Assessing the Numerical Accuracy of SAS Software](http://support.sas.com/kb/22/addl/fusion_22946_1_statisticalaccuracy.pdf).
