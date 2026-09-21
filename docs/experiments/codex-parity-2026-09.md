# Codex host parity: T1

Date: 2026-09-20 (America/Sao_Paulo). Checkout: `C:/Users/Yeonatan/master_team`, branch `master`, starting commit `f9d9b2a878d3ab55035439847f18c45ed2064359`.

Status: T1's local scope completed. The owner explicitly authorised the two missing links, Python runtime configuration, Detour/runner correctness fixes and this report, then required visual dependencies, a complete suite with no skips, and a T1 commit. That authorisation supersedes T1's original one-line-fix limit. No model benchmark or push was performed.

## Reproduction

Run `./scripts/check.ps1` from PowerShell. It selects the existing Codex bundled Python on this host, checks Python >= 3.12 and uses that absolute executable for all Python commands. `-Python <absolute-path>` or `OMNIHARNESS_PYTHON` selects another installed runtime. It does not change the user's PATH.

The interpreter used here is:

```text
C:\Users\Yeonatan\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
Python 3.12.14
Node v24.19.0
Git 2.54.0.windows.1
```

The suite sets PATH inside the Python process before discovery. Setting it only in the parent PowerShell process did not survive this bundled runtime's startup: `shutil.which('python')` still returned `None` until the in-process adjustment.

## Numbered findings and disposition

1. **Python missing from this host session's PATH.** `python --version` was not recognised; `py -0p` printed `No installed Pythons found!`. Invoking the bundled interpreter directly initially yielded `Ran 33 tests ... FAILED (failures=1, skipped=2)`: `test_probes` assumed Python was discoverable on PATH. The Windows runner now selects the existing interpreter explicitly and supplies its directory to discovery. Benchmark subprocesses also receive that directory, after the case's shim directory so the safety shims retain precedence.

2. **Two missing skill links.** The initial `scripts/install.py --check` returned 1, with `FAIL` for `C:/Users/Yeonatan/.claude/skills/skill-installer` and `C:/Users/Yeonatan/.agents/skills/skill-installer`. Both were absent, not conflicting installations. The dry run listed only those junctions and, after the runtime fix, the hook update. They now point to this checkout's `.agents/skills/skill-installer`.

3. **Configuration presence did not prove guard operation.** The old check covered only `permissions.ask`. A missing deny list, missing hook or incorrect matcher could pass. New tests reproduced each case before the fix. The check now verifies ask, deny and the canonical Bash hook, then invokes the trusted local guard with `git status` and `git push --force origin main` as JSON data, expecting exit codes 0 and 2. Neither shell command is executed. A deliberately inert guard fails the check. This verifies configuration and local guard behaviour; it does not certify interception inside a live Claude session or add a Codex hook adapter.

4. **Hook depended on bare `python`.** Both the installed user hook and generated benchmark settings now pin `sys.executable` as an absolute, quoted path. The original settings were preserved at `C:/Users/Yeonatan/.claude/settings.json.pre-omniharness-2`. Existing unrelated hooks and settings are retained. The installer now backs up each changed configuration rather than retaining only the first-ever backup. All installation checks passed after application.

5. **Empty Detour control responses passed.** Before the fix, `detour.check('.', events, {'result': ''}, 'control')` returned `{'pass': True, 'failures': []}`, including with earlier tool narration. Empty, whitespace-only or absent final text now fails both arms. Intermediate assistant text is not substituted for a final answer. A completed free-form control answer still passes the control-discrimination criterion; a correctly structured control answer still marks the comparison invalid. This is not a quality score.

6. **Process failure could produce an approved record.** Before the fix, a synthetic result with an error subtype and process exit 1 produced `pass=true`. Scoring now requires a known zero process exit, a successful result subtype, no error flag, nonempty final text and an accepting grader without failures. Timeout failures are retained. A missing stream grader cannot implicitly pass.

7. **Offline rescoring assumed exit 0.** New runs persist `_process.json` with the actual process exit and runner failures. `rescore` reads it; absence leaves the exit unknown and fails validation. Tests cover success, process failure, timeout and missing provenance. Legacy records and streams have not been overwritten or retroactively declared valid.

8. **Historical regression alerts are not comparable baselines.** `evals/run.py regress` printed two alerts for `detour-bounded`, comparing interrupted attempts with later runs under different budgets and control configurations. Eight local JSON records exist but are gitignored. The comparator still groups by case/arm and returns exit 0 after printing alerts; repair and migration are the next eval slice. These alerts did not trigger paid work.

9. **Visual prerequisites resolved after owner authorisation.** The initial run skipped two tests because Playwright was absent; those skips were not passes. Installed Playwright 1.63.0, pyee 13.0.1 and greenlet 3.5.6 in the runner's Python, then Chromium/Headless Shell 153.0.8010.12 (revision 1243), Playwright FFmpeg revision 1011 and Winldd revision 1007. Dependencies are pinned in `tests/visual/requirements.txt`. Both visual tests now execute and pass, covering desktop/mobile, light/dark, graph rendering, interaction, clipboard, translation and persistence. Playwright manages its own binaries; screenshots require no external ffmpeg command or global PATH change. The visual suite now errors on missing prerequisites, and `check.ps1` rejects any skipped test. The earlier in-memory HTML reproduction was byte-identical (162,450 bytes, 94 nodes, 92 edges); no portal source change was needed.

10. **Portability limits remain explicit.** Scout and Gauntlet Workflow adapters were verified with Node stubs, not executed as live workflows in Codex. The graph scanner passed with 510 nodes, 92 edges, five pending proposals and zero structural errors; this is its scan coverage, not a complete inventory of Codex plugin capabilities. Python 3.12 is required on Windows because the installer uses `os.path.isjunction`; the handoff's earlier suggestion of 3.11 is insufficient there.

## Validation record

Regression tests were observed failing before the corresponding fixes: empty control; process/error-result acceptance; rescoring with known successful provenance; missing deny/hook and stale interpreter configuration. Existing positive controls remained passing.

Final command: `./scripts/check.ps1`.

- Python: 41 discovered, 41 passed, 0 skipped, in 49.436 s. Includes `test_pages` and `test_states` with installed Chromium.
- Node: 3 Gauntlet scenarios, 5 Scout scenarios and the site validation passed.
- Eval runner selftest passed.
- Install: 19 checks passed (13 links, 2 drivers, ask, deny, hook and local guard probes).
- Skills graph: 510 nodes, 92 edges, 5 proposals waiting, 0 errors.
- `git diff --check`: clean.

Existing ResourceWarnings from unclosed file handles in the graph scanner/tests remain visible; they are not test failures and were not suppressed. Expected FAIL/ERROR text inside synthetic negative fixtures is distinct from the unittest result.

## Follow-up

The next work is defined in `docs/evals/PLAN.md`. The strategic decision is recorded in ADR 0006. Live agent-host hook interception and complete graph inventory coverage remain roadmap items; the local visual battery is complete. The owner also authorised implementation of E1 after the T1 commit.
