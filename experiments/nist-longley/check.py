"""Check generated Longley results against the NIST certified values by log relative error.

Usage: python check.py [--method lstsq|normal-equations]
Prints the per-value LRE (digits of agreement) and the verdict as JSON, writes
results/check-<method>.json; exit 0 on PASS, 1 on FAIL.
PASS needs every value's LRE >= manifest.json "threshold_lre".
"""
import argparse
import csv
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIGITS = 15  # NIST rounds every certified value to fifteen significant digits


def lre(x, c):
    """-log10(|x - c| / |c|), clipped to [0, DIGITS]; a non-finite result scores 0."""
    if not math.isfinite(x):
        return 0.0
    if x == c:
        return float(DIGITS)
    return min(DIGITS, max(0.0, -math.log10(abs(x - c) / abs(c))))


def floor2(v):
    """Report digits truncated, never rounded up across the threshold."""
    return math.floor(v * 100) / 100


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--method", choices=["lstsq", "normal-equations"], default="lstsq")
    a = ap.parse_args(argv)
    threshold = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))["threshold_lre"]
    certified = json.loads((HERE / "certified.json").read_text(encoding="utf-8"))["values"]
    with open(HERE / "results/results.csv", newline="", encoding="utf-8") as f:
        got = {r["name"]: float(r["value"]) for r in csv.DictReader(f) if r["method"] == a.method}
    scores = {k: lre(got[k], float(c)) for k, c in certified.items()}
    worst = min(scores.values())
    out = {
        "method": a.method,
        "threshold_lre": threshold,
        "min_lre": floor2(worst),
        "verdict": "PASS" if worst >= threshold else "FAIL",
        "lre": {k: floor2(v) for k, v in scores.items()},
    }
    text = json.dumps(out, indent=2) + "\n"
    (HERE / f"results/check-{a.method}.json").write_bytes(text.encode())
    print(text, end="")
    return 0 if out["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
