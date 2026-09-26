# Pillar 3 slice: NIST StRD Longley reproduction

Status: **implemented offline slice, reference run on one Windows host; no second-operator run recorded yet** · 2026-09-26

This is the V1 pillar 3 scenario from [the release contract](V1-RELEASE-CONTRACT.md): one pinned public experiment behind an input/environment/command/output manifest, a published numeric claim checked against the generated results, a retained failed check, and a cited section draft whose numerals are gated against the results. Files live in [`experiments/nist-longley/`](../../experiments/nist-longley/). The offline test is `tests/test_nist_longley.py`.

## Manifest summary

| Part | Content |
|---|---|
| Claim | NIST certified values for the Longley linear least-squares problem (7 parameters, 16 observations, "higher level of difficulty"). NIST computed them to 500 digits and rounded them to fifteen significant digits. Checked: 7 estimates, 7 standard deviations, residual SD and R², 16 values in total. |
| Inputs | `data/Longley.dat` (sha256 `fc4b0c82…80ea`), `data/v-Longley.shtml` (certified values, sha256 `95b1c087…a405`), `data/Longley.shtml` (landing page, sha256 `5c0dbee1…97e4`). Fetched from `https://www.itl.nist.gov/div898/strd/lls/data/` on 2026-09-26 between 04:45:03Z and 04:45:21Z. Full URLs and hashes are in `manifest.json`. `.gitattributes` keeps the served CRLF bytes. |
| Transcription | `certified.json` holds the page's strings verbatim. The test checks each string against both the page and lines 31 to 51 of `Longley.dat`. |
| Environment | Python ≥ 3.10 and numpy ≥ 1.26, no network. Each run records Python, numpy, BLAS/LAPACK build, platform, cond₂(X) and the input/output sha256 in `results/run.json`. |
| Commands | `run.py` fits two ways: `lstsq`, which is `numpy.linalg.lstsq` (LAPACK SVD) with SDs from the same SVD, and `normal-equations`, which is the naive `inv(X'X) @ X' @ y` in float64. `check.py --method M` scores each value by `LRE = -log10(|x-c|/|c|)`, clipped to [0, 15], with a non-finite result scoring 0. It returns PASS only if every LRE ≥ `threshold_lre`. |
| Threshold | `threshold_lre = 5`, declared before any comparison ran. The bound −log10(cond₂(X)·ε) is 5.97 digits for this design matrix (cond₂(X) = 4.859e9), floored to 5. |
| Outputs | `results/results.csv`, `results/run.json`, `results/check-lstsq.json`, `results/check-normal-equations.json`, and `draft/section.tex` with `draft/references.bib`. |

## Reference run (this repository, 2026-09-26)

Windows-11-10.0.26200, Python 3.12.14, numpy 2.3.5, scipy-openblas 0.3.30 (BLAS and LAPACK). The `results.csv` sha256 was `80f062d7…da57` and was identical across two runs on this host.

| Check | Verdict | Minimum LRE | Weakest value |
|---|---|---|---|
| `lstsq` (SVD) | **PASS** | 10.93 | B1 |
| `normal-equations` (control) | **PASS** | 7.41 | B5 |
| facts gate, `draft/section.tex` | **PASS** | 6 of 6 decimals matched | none |
| facts gate, `draft/section-mutated.tex` | **FAIL** (retained) | 1 unmatched: `304.8542` | residual SD with one altered digit |

**The control did not fail.** The brief expected the naive normal equations to fail, since cond₂(X'X) = 2.384e19 exceeds 1/ε and so no digit is guaranteed. They still kept at least 7.41 digits. The column-scaled cond₂(X) of 4.328e4 explains the gap. It predicts about 6.4 digits for the normal equations and about 11.0 for the SVD solve, against 7.41 and 10.93 observed; the unscaled worst-case bound was pessimistic. The threshold was **not** raised to force a failure. The search found no verifiable literature threshold above 5 digits, and one unverified secondary summary attributes "four or five digits" to McCullough (1998). Any value between 7.41 and 10.93 would have been chosen by looking at the results. The control's per-value LREs stay committed. The retained failed check is the claim check: the mutated draft is rejected. `check.py`'s FAIL path is also exercised by a planted negative control in the test, where every value is off by a relative 1e-4 (LRE 4).

## Second-operator rerun

From a checkout of the commit that added this slice. Use `py`, `python3` or a full interpreter path if `python` is not on PATH.

```
cd experiments/nist-longley
python -c "import hashlib,json; m=json.load(open('manifest.json')); [print(i['path'], hashlib.sha256(open(i['path'],'rb').read()).hexdigest()==i['sha256']) for i in m['inputs']]"
python run.py
python check.py --method lstsq
python check.py --method normal-equations
python ../../.agents/skills/thesis-review/scripts/thesis_checks.py facts --csv results/results.csv --tex draft/section.tex --decimal point
python ../../.agents/skills/thesis-review/scripts/thesis_checks.py facts --csv results/results.csv --tex draft/section-mutated.tex --decimal point
git diff --stat -- results
cd ../..
python -m unittest tests.test_nist_longley
```

Expected: every input line prints `True`; both checks print `"verdict": "PASS"` and exit 0; the first facts gate exits 0 with `"unmatched": []`; the second exits 1 with `"unmatched": ["304.8542"]`; the unit test is `OK`. `run.py` overwrites the committed reference results, so `git diff -- results` shows exactly what differs in the operator's environment. Optionally re-download `Longley.dat` from its manifest URL and compare the sha256. The two `.shtml` pages embed a per-request Cloudflare token, so a fresh fetch differs in bytes. For those, compare the certified strings, not the hash.

## Environment differences

- **Acceptance is the verdicts, not the bytes.** The acceptance verdict is `lstsq` PASS together with the facts-gate pair (PASS, then FAIL on the mutation). A different `results.csv` sha256 or different low-order digits with the same verdicts is an **explained environment difference** when the operator's `run.json` differs in numpy, BLAS/LAPACK build, CPU kernel or platform. Keep both `run.json` files and the `git diff` as evidence.
- **Margins.** `lstsq` has 5.9 digits of margin over the threshold. The draft's four-decimal numerals can change only if a value sits within about 1e-10 relative of a rounding boundary. If the regenerated `results.csv` fails the facts gate, report that as a difference; do not edit the draft to match.
- **The control is the sensitive case.** The normal equations have 2.4 digits of margin. A FAIL there on another BLAS/LAPACK is a documented environment difference of the control, recorded with `run.json`, as long as `lstsq` still passes. It is not grounds to change the threshold.
- **Not explainable by environment.** A `lstsq` FAIL, a changed input hash, or a certified string that no longer matches the committed sources is a failed reproduction, or a data change to investigate. Never lower the threshold or re-transcribe from memory to recover a PASS.

## Known limitations of the facts gate

These live in `.agents/skills/thesis-review/scripts/thesis_checks.py`, which was outside this slice's edit scope. Both are evaluator-correctness defects and are recorded here as open work, not fixed:

1. `NUMERAL` ends with the lookahead `(?![\d.,])`, so a numeral directly followed by `,` or `.` (for example "84.9149, and") is skipped, never counted and never checked. The first draft had 6 decimals and the gate counted 4. The draft now keeps numerals in `$…$`, and the test asserts that the gate counts every decimal in the prose. A likely fix is the lookahead `(?!\d|[.,]\d)` plus a regression case in `tests/test_checks.py`.
2. The minus sign is outside the numeral. A negative CSV value (formatted `-3482258.6346`) can never match its TeX numeral, and a sign flip of a positive value in the text goes undetected. The draft therefore cites only positive values. Five of the seven Longley coefficients are negative and are not quoted.

## Sources

- NIST StRD Longley: [dataset page](https://www.itl.nist.gov/div898/strd/lls/data/Longley.shtml), [certified values](https://www.itl.nist.gov/div898/strd/lls/data/LINKS/v-Longley.shtml), [data file](https://www.itl.nist.gov/div898/strd/lls/data/LINKS/DATA/Longley.dat), [certification method](https://www.itl.nist.gov/div898/strd/lls/data/LINKS/c-Longley.shtml) (500-digit computation rounded to fifteen significant digits; no acceptance threshold is given).
- Longley, J. W. (1967), *Journal of the American Statistical Association* 62, 819–841, as cited on the NIST page.
- LRE conventions consulted, none of which gives a pass threshold for linear regression: [Wikibooks, Numerical Comparison of Statistical Software](https://en.wikibooks.org/wiki/Statistics/Numerical_Methods/Numerical_Comparison_of_Statistical_Software) and [SAS, Assessing the Numerical Accuracy of SAS Software](http://support.sas.com/kb/22/addl/fusion_22946_1_statisticalaccuracy.pdf).
