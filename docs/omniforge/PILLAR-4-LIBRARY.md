# Pillar 4 slice: library and practice challenge

Status: **CLI slice implemented and tested; owner review and a Lab view pending, not a V1 pass** · 2026-09-26

The [V1 release contract](V1-RELEASE-CONTRACT.md) asks pillar 4 for an installable library entry for one reviewed skill, one template and one tutorial tied to the demonstrated engineering workflow, plus one practical coding challenge with an executable verifier, a positive and a negative submission, and progress a member can see after a restart. This page records what exists, how to use it and what it does not prove. Enrollment, billing and moderation are out of scope.

## What ships

| Piece | Path | Notes |
|---|---|---|
| Manifest | `library/manifest.json` | Per entry: `id`, `kind` (skill, template or tutorial), repo-relative `source`, `sha256`, `installs` (home-relative targets) and `review` (provenance) |
| Skill | `.agents/skills/checkpoint-build/` | Its `SKILL.md` hash equals the `reviewed_at 2026-09-25` row in `docs/skills-graph/skill-metadata.json`; the reviewer rehearsal is in `docs/research/helix-2026-09-25.md` |
| Template | `library/templates/engineering-checkpoint.workflow.json` | The Lab's `engineering-checkpoint` preset ("Do bug à evidência"), exported unchanged from `omniforge-lab/workflows.mjs`; a test fails if the two drift |
| Tutorial | `recipes/checkpoint-tdd-with-omniforge.md` | Library install, the three-step workflow, the challenge, and the Lab/host path for a real task |
| Installer | `scripts/library.py` | `list`, `verify`, `install <entry>`, `uninstall <entry>`, `--dry-run`, `--home` |
| Challenge | `challenges/paginate-bug/` | Statement, starter from `evals/cases/gauntlet-rapido/buggy/mod.py`, hidden tests, `submissions/positive.py` and `submissions/negative.py` |
| Verifier and progress | `harness/challenges.py` | `verify <challenge> <submission>`, `progress show`, `progress record <challenge> <submission>` |

## Library CLI

```powershell
python scripts/library.py list                       # entries, install state in ~, and what installing does
python scripts/library.py verify                     # every source against its pinned sha256; exit 1 on a mismatch
python scripts/library.py install checkpoint-build --dry-run
python scripts/library.py install <entry>            # one entry only
python scripts/library.py uninstall <entry>
```

- A skill installs as junctions `~/.claude/skills/<name>` and `~/.agents/skills/<name>` (symlinks off Windows) pointing to its repo directory, through the same `mklink`/`points_to` helpers as `scripts/install.py`. A template or tutorial is copied to `~/.omniharness/library/`.
- A file source is pinned by its sha256. A directory is pinned by the sha256 of its sorted `relpath NUL file-sha256 LF` lines, ignoring `__pycache__`. A mismatch fails `verify` and refuses `install`.
- A replaced target is renamed with a `.pre-omniharness` suffix first (`install.free_backup`). Uninstall removes only a link to the entry's source or a copy still equal to the pinned hash. Anything else is printed as a numbered triage list and nothing is removed; backups are always kept.
- Targets must match `.claude/skills/<name>`, `.agents/skills/<name>` or `.omniharness/library/<file>`, and sources must stay inside the repository. The installer therefore cannot write `~/.claude/settings.json`. `OMNIHARNESS_SANDBOX=1` refuses install and uninstall, as in `scripts/install.py`.

## Challenge CLI

```powershell
python harness\challenges.py verify paginate-bug <submission.py>             # JSON verdict; exit 0 PASS, 1 FAIL
python harness\challenges.py progress record paginate-bug <submission.py>    # verify, then append; exit 3 on conflict
python harness\challenges.py progress show [--member <label>]
```

- `verify` copies the submission as `mod.py` beside the hidden tests in a new temporary directory. It runs them in a child Python (`-B -E -s -X utf8`) with a minimal environment (PATH, PATHEXT, SYSTEMROOT, WINDIR, TEMP, TMP, TMPDIR) and the challenge's timeout (20 s). The verdict carries the challenge id and version, `PASS`/`FAIL`, a reason, the test count, the submission's sha256, the verifier's sha256 (driver plus hidden tests), the duration and the output tail.
- `PASS` requires a zero exit code and the suite's own result file with at least one test run and no failure, error, skip or expected failure. A timeout, a crash, `os._exit`, `SystemExit` at import, a syntax error or an empty file is `FAIL`.
- Progress is one JSON file per member: `$OMNIFORGE_DATA_DIR/progress/<member>.json`, or `%LOCALAPPDATA%/OmniForge/data/progress/<member>.json` when the variable is unset. It holds `schema`, `member` (default `local-owner`), `revision` and, per challenge, every attempt with version, verdict, reason, UTC timestamp and both hashes. A failed attempt is recorded too; `show` reports a challenge as completed once a `PASS` exists.
- Writes happen under an exclusive lock file with an atomic replace. `record` reads the revision under the lock, verifies, then writes only if the revision is unchanged; otherwise it exits 3 and writes nothing. `--expected-revision N` makes the check explicit. An unreadable or foreign progress file makes the command fail (exit 2) and is never overwritten.

## Safety boundary

**The verifier is not a sandbox.** A submission runs as the local owner, with the owner's files and network. A timeout ends only the child process it started; any processes the submission starts itself survive. Until V-04 in [VALIDATION-PENDING.md](VALIDATION-PENDING.md) establishes a verified isolation boundary (container or Job Object with negative canaries), verify only the owner's own code. Do not offer the verifier to other members or accept third-party submissions on it.

## Evidence (2026-09-26, branch `claude/pillar4-library`, base `81d9a13`)

- Red first: before the implementation, `tests/test_challenges.py` failed with `ModuleNotFoundError: No module named 'challenges'` and `tests/test_library.py` failed with 8 errors (`FileNotFoundError: ... library/manifest.json`).
- `tests/test_library.py` installs, lists, re-installs (no-op) and uninstalls each entry in a temporary fake home whose junctions point at a temporary repository copy. It also covers backups on replacement, triage of an edited copy, tamper detection on a file and on a skill directory, manifest target confinement, and `settings.json` staying byte-identical. Separate checks cover the real manifest's `verify`, the template against the Lab preset (via Node) and the skill hash against its review record.
- `tests/test_challenges.py` covers: positive `PASS`; negative and unchanged starter `FAIL`; timeout, `os._exit(0)`, `SystemExit(0)`, a syntax error and an empty file `FAIL`; the caller's environment not reaching the submission; CLI exit codes; rejection of unknown or traversing challenge ids and invalid member labels; progress surviving a new process; a stale revision refused; four concurrent writers where each either writes or exits 3, and the final revision equals the number of writes; and a corrupt file left untouched.
- Manual CLI run: the unchanged starter gives `FAIL`, "3 failed check(s) in 7 tests"; the negative gives `FAIL`, "4 failed check(s) in 7 tests"; the positive gives `PASS`, "7 tests passed". A one-line fix of the starter recorded as completed v1 and was shown by a new process. An observed concurrent run gave exit codes `[3, 3, 1, 3]` and revision 1. All of this used a temporary data directory and home; the owner's profile, `.omniforge-lab` and `%LOCALAPPDATA%/OmniForge` were not touched.

## Limitations and pending items

- **No Lab view yet.** Progress and the library are CLI-only; a Lab panel is later work. When `OMNIFORGE_DATA_DIR` is unset, the Lab defaults to `<repo>/.omniforge-lab` while progress defaults to `%LOCALAPPDATA%/OmniForge/data`, so a future view must read the progress path above.
- **Owner review pending** for the template (the preset is labelled a proposed template) and the tutorial. The skill's review is an instruction-level rehearsal, not an observed live application.
- **Pillar 1 dogfood record absent from this branch.** The tutorial teaches the checkpoint-build/TDD workflow and the preset, but this base has no frozen pillar 1 ticket record to cite. Link it when that record lands.
- Single local member label per file; no accounts, enrollment, billing or moderation. A stale lock left by a crash mid-write must be removed by hand; the error names it. Attempts accumulate without a cap.
