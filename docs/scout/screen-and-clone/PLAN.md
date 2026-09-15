# PLAN: screen capture, device control and video cloning

Written after the plan gate of 2026-09-15 (`grilling.md`, every answer the owner's). No dossier: the *scout* fan-out over market and technique references was never opened, because the session had no approved network budget at the plan gate; the facts behind the plan came from the repository itself and are listed at the top of `grilling.md`. A separate, narrower fan-out was approved later and ran as ticket D4 — documentation verification, not reference research. Spec: `spec.md`. Tickets: the Phase C block of `../../commercial/TICKETS.md`.

## Goal

Three skills. `device-lab` records a screen — the phone's, the desktop's, or one window or region — and drives an Android phone with a queryable view tree, locators, actions, assertions and a trace, the way Playwright drives a browser. `video-read` reads a reference video and writes its style, its structure and its rhythm as a prompt. `video-forge` turns that prompt into a clone through a questionnaire, an asset ledger, a plan gate and a part-by-part production loop that holds visual consistency and stops at a ceiling.

## Success criterion (the owner's bar)

1. `device-lab` resolves every locator form against a fixture view tree **with no device attached**, and a failing `expect` exits non-zero with a trace naming the step.
2. `--route=social` refuses with stdin closed; every hard-block pattern is denied by `harness/guard_bash.py` in a unit test.
3. `video-read` reproduces a synthetic fixture's known cut points within one frame, and its palette is identical across two runs.
4. `video-forge` runs end to end against a shimmed `higgsfield` CLI **spending nothing**, trips the continuity gate on a planted broken clip, and stops at a ceiling set below the storyboard's total while still delivering the finished parts.
5. Every command in an integration page carries a source marker, and no command is presented as fact without one. An item that is genuinely open keeps a **U** marker, is named in the page's own open-items list, and is not relied on by code — D4 closed most of the spec's marks this way and left five items openly marked rather than quietly promoted.
6. The zero-token battery stays green throughout: `python -m unittest discover tests`, `node tests/test_driver.js`, `node tests/test_scout_driver.js`, `python evals/run.py selftest`.

## Where we are

**Steps 1-4 done.**

Steps 1-3 (2026-09-15): the plan gate was run and answered; `grilling.md`, `spec.md` and this file exist, and the Phase C tickets are written.

**Step 4, ticket D4, done (2026-09-15).** 86 unique pages opened across 8 documentation domains, 17 agents, every claim re-checked by an independent refuter: 143 survived, 32 were killed. Output: `../../integrations/android-adb.md` and `../../integrations/ffmpeg-capture.md`, each command carrying a source marker (**G** Google page opened, **A** AOSP mirror, **F** ROM fork, **M** FFmpeg manual source, **C** FFmpeg C source, **U** unverified). Measured run and open items: `../../experiments/d4-device-surface-verification-2026-09-15.md`. The spec's nine `UNVERIFIED` marks are down to three, and five of its commands were plainly wrong — the `/dev/tty` dump form, `--wipe-data` as an adb flag, the unescaped comma in `gt(scene,0.3)`, `screencap -p` without its redirect, and three `uiautomator` behaviours no design would have guessed.

Still no code, no skill directory, no change to `AGENTS.md`, `CONTEXT.md`, `harness/settings.json` or `skills-graph.toml`. `python scripts/install.py --check` still reports no drift, because nothing installable was added.

Next: **D1**, and before or alongside it the two free closures D4's critic named — run the `ffmpeg` composites locally (no network, no gate, one minute) and one minute with a phone for `screenrecord --help` and the `/dev/tty` question. Both are cheap and both turn a marked composition into an observation on a named build. Phase C remains blocked by T1 (host parity) like every other phase, and the owner's answer to Q5 put it behind R1 and T13 in the queue.

## Routine

1. **Plan gate** — `grilling` without a fan-out; the owner answered Q1–Q8 and said yes to the plan of action. Done, 2026-09-15.
2. **Spec** — `to-spec` → `spec.md`, every device command marked UNVERIFIED at the time of writing. Done; reconciled against the verified surface in step 4, three marks remaining.
3. **Tickets** — the Phase C block (D1–D4, V1–V3, F1–F4, C1) in the repository's own per-ticket format. Done.
4. **Verify the device surface** — ticket D4, first among the implementation tickets even though it is numbered last in its group. Done 2026-09-15: research fan-out, adversarial refutation, completeness critic; two integration pages written, the spec reconciled, the open items named rather than dropped.
5. **Build `device-lab`** — D1 (capture and sidecars), D2 (tree, locators, assertions on fixtures), D3 (actions, flows, trace, the gate table implemented in `harness/settings.json` and `guard_bash.py`). Under `/tdd`, seams first, with the ponytail ruleset on. Every test runs with no device and no network.
6. **Build `video-read`** — V1 (router, cuts, rhythm, palette on a synthetic fixture), V2 (transcript, on-screen text, hook, and the `style.md` / `pattern.md` / `clone-prompt.md` artifacts). STOP: confirm — V2's first run installs `faster-whisper` and downloads a model.
7. **Bridge to `ingest`** — V3, the URL route delegated to ticket I2's `ingest media`. Blocked by I1 and I2; until they exist, `video-read` prints the gated `yt-dlp` command instead of implementing a second downloader.
8. **Build `video-forge`** — F1 (questionnaire, asset ledger, storyboard; zero paid calls), F2 (the loop, the four consistency mechanisms, the continuity gate, tested against a shimmed CLI), F3 (ceiling, 80 % warning, 100 % stop, `per-clip` and `per-batch`).
9. **The first real video** — F4. STOP: confirm — this is the first ticket that spends credits. Cost named from the filled cost table before the first call; actual spend recorded against the estimate.
10. **Register** — C1: nodes and edges in `skills-graph.toml`, routing rows and HITL entries in `AGENTS.md`, terms in `CONTEXT.md`, a showcase line. Only now, when the code runs. STOP: confirm before `git commit`.
11. **Review** — `/code-review` on the device and budget surfaces, `/security-review` on the gate changes, `/simplify` on the locator resolver.

## Gaps

1. **`adb` and `scrcpy` are not on the reference machine** and are not in `docs/PHASE0_AUDIT.md`. The install is gated; `../../integrations/android-adb.md` records the exact download URLs, the licence that must be accepted, and the Linux `plugdev`/udev steps.
2. **Google's and FFmpeg's own hosting is egress-blocked** from this environment, so every AOSP and ffmpeg fact is mirror- or source-sourced, on branch refs rather than pinned commits. Recorded at the top of both integration pages; pinning the SHAs is the one methodological gap D4 left open.
3. **`docs/roadmap.md` does not exist** — it is ticket T3's deliverable. The three roadmap rows live at the bottom of `spec.md` until T3 creates the file, then they move.
4. **iOS control has no free path on Windows.** Recorded as a roadmap row, marked `not shipped`, never as a capability.
5. **No flow file format in the standard library.** JSON is the recommendation in `spec.md`; D3 decides and records the reason.
6. **Candidates for the skills graph** (catalog ring, `alternative-to` edges, not dependencies): `bradautomates/claude-video` against `video-read`, `calesthio/openmontage`'s Screen Demo pipeline against `device-lab record desktop`, `remotion-dev/skills` and `video-db/skills` against `video-forge`'s assembly, `fal-ai-community/skills` against `higgsfield` as a generation provider. C1 proposes them; the owner approves.

## Detours considered

None taken. One was weighed and rejected in the spec without a `detour` round, because the answer was not close: **Appium or `uiautomator2` instead of raw `adb`**. Rejected — the view tree is XML and the actions are one `adb shell input` each, so the standard library covers the job, and the working rules put "stdlib?" ahead of "write code" and both ahead of "add a dependency". A `detour` is available later if the locator resolver turns out to need more than a rectangle centre.

## Sources

The owner's answers in `grilling.md`. On disk: `docs/PHASE0_AUDIT.md` (reference machine), `docs/integrations/{higgsfield,faster-whisper,browser-automation}.md`, `docs/catalog/community-skills.md`, `docs/commercial/TICKETS.md` (tickets I1–I3 and T13's invariant 2 amendment), `recipes/creative-video-higgsfield.md`. No external source was read: no fan-out was approved.
