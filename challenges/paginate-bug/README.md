# Challenge: paginate-bug (v1)

`starter.py` holds `paginate(items, page, size)`, taken from the Gauntlet benchmark fixture `evals/cases/gauntlet-rapido/buggy/mod.py`. Its docstring is the contract:

- pages are 1-based and hold exactly `size` items;
- the last page may be shorter, and a page past the end is `[]`;
- `page < 1` or `size < 1` raises `ValueError`.

The starter breaks the contract. Find the failure, write a test that shows it, and make the smallest fix that honours the whole docstring. Keep the name and signature: the verifier copies your file as `mod.py` and imports `mod.paginate`.

## Verify and record

From the repository root in Windows PowerShell:

```powershell
Copy-Item challenges\paginate-bug\starter.py $env:TEMP\mod.py
python harness\challenges.py verify paginate-bug $env:TEMP\mod.py
python harness\challenges.py progress record paginate-bug $env:TEMP\mod.py
python harness\challenges.py progress show
```

`verify` runs the hidden suite in `hidden/` in a fresh temporary directory and prints a JSON verdict with the submission's and the verifier's sha256. A timeout, a crash or an accidental early exit is `FAIL`. `progress record` verifies again and appends the verdict to your progress file; `progress show` lists what you completed, also after a restart.

`submissions/positive.py` is a reference solution (PASS). `submissions/negative.py` is a plausible wrong fix (FAIL): read it only after your own attempt, and work out which part of the contract it drops.

**Not a sandbox.** The verifier runs the submission as you, with your files and network. Verify only code you wrote or have read, until the isolation boundary tracked as V-04 in `docs/omniforge/VALIDATION-PENDING.md` holds. The submission also runs inside the verifier's test process. A submission that tampers with the verdict, for example by writing the result file itself, can forge a `PASS` and a completed progress record. A `PASS` shows that the suite passed only if your code did not tamper.

The step-by-step tutorial is [recipes/checkpoint-tdd-with-omniforge.md](../../recipes/checkpoint-tdd-with-omniforge.md).
