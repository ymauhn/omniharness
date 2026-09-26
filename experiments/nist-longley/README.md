# NIST StRD Longley reproduction

V1 pillar 3 slice: refit the [NIST StRD Longley](https://www.itl.nist.gov/div898/strd/lls/data/Longley.shtml) linear regression from pinned public data, check the certified values by log relative error (LRE), and gate a cited draft paragraph against the generated results. Protocol, expected verdicts and the environment-difference policy: [docs/omniforge/PILLAR-3-SCIENCE.md](../../docs/omniforge/PILLAR-3-SCIENCE.md).

```
cd experiments/nist-longley
python run.py                               # results/results.csv, results/run.json
python check.py --method lstsq              # PASS, exit 0
python check.py --method normal-equations   # control, PASS in the reference run, exit 0
python ../../.agents/skills/thesis-review/scripts/thesis_checks.py facts --csv results/results.csv --tex draft/section.tex --decimal point
```

| Path | What |
|---|---|
| `manifest.json` | inputs (URL, retrieval time, sha256), environment, commands, outputs, declared threshold, expected verdicts |
| `data/` | NIST files byte for byte (CRLF kept by `.gitattributes`) |
| `certified.json` | certified values transcribed verbatim from `data/v-Longley.shtml`, with its sha256 |
| `run.py`, `check.py` | fit (SVD `lstsq` and the naive normal equations), LRE check |
| `results/` | reference run outputs, committed |
| `draft/` | cited section, its one-digit mutation (retained failed check), bibliography |

Offline test: `python -m unittest tests.test_nist_longley` from the repository root.
