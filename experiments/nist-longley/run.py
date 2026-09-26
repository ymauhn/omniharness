"""Fit the NIST StRD Longley model two ways and record what ran.

Usage: python run.py   (writes results/results.csv and results/run.json next to this file)

lstsq             numpy.linalg.lstsq (LAPACK SVD); standard deviations from the same SVD.
normal-equations  the naive (X'X)^-1 X'y in float64, kept as the failed-check case.
"""
import csv
import hashlib
import json
import platform
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
DATA = "data/Longley.dat"
RESULTS = "results/results.csv"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load():
    d = np.loadtxt(HERE / DATA, skiprows=60)  # the header says data lines 61-76; columns y, x1..x6
    return np.column_stack([np.ones(len(d)), d[:, 1:]]), d[:, 0]


def fit(X, y, method):
    n, p = X.shape
    if method == "lstsq":
        b = np.linalg.lstsq(X, y, rcond=None)[0]
        _, s, vt = np.linalg.svd(X, full_matrices=False)
        cov = ((vt.T / s) ** 2).sum(axis=1)  # diag((X'X)^-1) = diag(V S^-2 V')
    else:
        inv = np.linalg.inv(X.T @ X)
        b = inv @ X.T @ y
        cov = np.diag(inv)
    r = y - X @ b
    sd = np.sqrt(r @ r / (n - p))
    with np.errstate(invalid="ignore"):  # a negative variance from the naive inverse becomes nan, and fails the check
        b_sd = sd * np.sqrt(cov)
    rows = {f"B{i}": b[i] for i in range(p)} | {f"B{i}_sd": b_sd[i] for i in range(p)}
    return rows | {"residual_sd": sd, "r_squared": 1 - (r @ r) / ((y - y.mean()) @ (y - y.mean()))}


def main():
    X, y = load()
    (HERE / "results").mkdir(exist_ok=True)
    with open(HERE / RESULTS, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["method", "name", "value"])
        for method in ("lstsq", "normal-equations"):
            w.writerows([method, k, repr(float(v))] for k, v in fit(X, y, method).items())
    deps = np.show_config(mode="dicts")["Build Dependencies"]
    run = {
        "command": " ".join(["python", *sys.argv]),
        "python": sys.version,
        "numpy": np.__version__,
        "blas": {k: deps["blas"].get(k) for k in ("name", "version", "openblas configuration")},
        "lapack": {k: deps["lapack"].get(k) for k in ("name", "version")},
        "platform": platform.platform(),
        "cond2_X": float(np.linalg.cond(X)),
        "inputs": {DATA: sha256(HERE / DATA)},
        "outputs": {RESULTS: sha256(HERE / RESULTS)},
    }
    (HERE / "results/run.json").write_bytes((json.dumps(run, indent=2) + "\n").encode())


if __name__ == "__main__":
    main()
