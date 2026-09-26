# NIST StRD Longley reproduction

V1 pillar 3 slice: refit the [NIST StRD Longley](https://www.itl.nist.gov/div898/strd/lls/data/Longley.shtml) linear regression from pinned public data, check the certified values by log relative error (LRE), and gate a cited draft paragraph against the generated SVD results. Protocol, expected verdicts and the environment-difference policy: [docs/omniforge/PILLAR-3-SCIENCE.md](../../docs/omniforge/PILLAR-3-SCIENCE.md).

```
cd experiments/nist-longley
python -m pip install -r requirements.txt   # numpy, pinned to the reference run
python run.py                               # results/lstsq.csv, results/normal-equations.csv, results/run.json
python check.py --method lstsq              # acceptance check: PASS, exit 0
python check.py --method normal-equations   # control, informational: PASS in the reference run
python ../../.agents/skills/thesis-review/scripts/thesis_checks.py facts --csv results/lstsq.csv --tex draft/section.tex --decimal point           # PASS, exit 0
python ../../.agents/skills/thesis-review/scripts/thesis_checks.py facts --csv results/lstsq.csv --tex draft/section-mutated.tex --decimal point   # retained failed check: exit 1, unmatched 304.8542
```

| Path | What |
|---|---|
| `manifest.json` | inputs (URL, retrieval time, sha256), environment, commands, outputs, threshold, expected verdict, control, retained failed check |
| `requirements.txt` | numpy, the one dependency of this experiment and of `tests/test_nist_longley.py` |
| `data/` | NIST files byte for byte (CRLF kept by `.gitattributes`) |
| `certified.json` | certified values transcribed verbatim from `data/v-Longley.shtml`, with its sha256 |
| `run.py`, `check.py` | fit (SVD `lstsq`, and the naive normal equations as a control), LRE check |
| `results/` | reference run outputs, one CSV per method, committed |
| `draft/` | cited section (gated against `results/lstsq.csv` only), its one-digit mutation (the retained failed check: the gate rejects the mutated claim), bibliography |

Offline test: `python -m unittest tests.test_nist_longley` from the repository root.
