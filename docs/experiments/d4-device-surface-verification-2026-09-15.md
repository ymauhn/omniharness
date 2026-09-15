# D4: adversarial verification of the device and ffmpeg command surface

Date: 2026-09-15. Ticket: **D4** of the Phase C block (`../commercial/TICKETS.md`). Spec verified: `../scout/screen-and-clone/spec.md`. Output: `../integrations/android-adb.md`, `../integrations/ffmpeg-capture.md`.

## Why this ran first

Phase C's spec was written in a session with no network and no Android device, so every `adb`, `scrcpy` and `ffmpeg` command in it was the agent's own knowledge, marked `UNVERIFIED` in nine places. Writing `device-lab` against those flags would have been code against guesses. D4 exists to replace the guesses before any code, and the owner approved the documentation reads.

## Method

A Workflow run, `d4-verify-device-surface`, in three phases:

1. **Research** — 8 agents, one per documentation domain (adb core; adb capture; uiautomator; input and `am`; scrcpy; ffmpeg capture devices; ffmpeg filters and options; install paths). Each returned structured facts, every fact carrying the URL actually opened and a verbatim quote.
2. **Refute** — 8 independent skeptics, pipelined so each started as soon as its researcher finished. Each reopened the sources itself and tried to **refute** every claim. The standing rule was deliberately harsh: *a claim you could not confirm yourself is refuted, not accepted; a page you could not open is a refutation.*
3. **Critique** — one completeness critic checked what survived against the spec's own list of 20 items and named what must keep its `UNVERIFIED` mark.

## Measured

| | |
|---|---|
| Agents | 17 (8 + 8 + 1), 0 errors, 0 skipped, 0 empty |
| Tool calls | 476 |
| Unique pages opened | 86, of which **6 failed** |
| Claims established | 175 |
| Survived refutation | **143** |
| Killed or never confirmed | **32** |
| Wall clock | 62.7 min |
| Subagent tokens | 1,226,205 |
| Credits spent | 0 |

The pages read exceeded the "about four" the agent estimated to the owner when asking. Same category of call (WebFetch, free, no side effects), larger count; reported rather than glossed.

## What the spec had wrong

Five findings that would each have produced broken code:

1. **`adb exec-out uiautomator dump /dev/tty`** — the spec's primary way of getting the view tree. Documented nowhere, and the evidence argues against it: the dumper opens its target with a plain `FileWriter`, and `exec-out` yields a socketpair, not a terminal. Replaced by the documented two-step `dump /sdcard/window_dump.xml` + `adb pull`.
2. **`--wipe-data` listed as an adb hard-block.** It is an *emulator* option (`emulator @<avd> -wipe-data`). The real destructive adb surface is `pm uninstall`, `pm clear`, `pm remove-user`, `rm -r|-R|-rf`, `reboot bootloader|recovery|sideload`, `disable-verity`, `remount` — all now verified.
3. **`select='gt(scene,0.3)'`** — the comma must be escaped (`gt(scene\,0.4)`); unescaped, the filtergraph parser reads it as an argument separator. And 0.4 is the documented example while 0.3 is the bottom of the documented sane range, not a default.
4. **`adb exec-out screencap -p`** — the redirect is part of the documented form (`> screen.png`); the on-device variant takes no `-p` at all.
5. **Three `uiautomator` behaviours no design would have guessed**: the success line is misspelled in AOSP (`UI hierchary dumped to:`), it is printed even when the write failed, and a dump during an animation *fails* rather than returning stale XML.

`scrcpy`'s licence guess (Apache-2.0) was the one guess that held, confirmed from the repository's `LICENSE` file.

## What is still open, and how to close it

D4 did not close everything, and the remaining items are named rather than quietly dropped:

| Open item | Why it stayed open | Cheapest way to close it |
|---|---|---|
| Is `screenrecord`'s 180 s a ceiling or only a default? | Google's page says both default and maximum; AOSP fork source says default only, with `--time-limit 0` removing it. Google's own hosting is egress-blocked, so the fork could not be checked against it | `adb shell screenrecord --help` on a real device, recorded with `ro.build.fingerprint` |
| The `/dev/tty` form's actual behaviour | Unverified in *both* directions — no page says it works, none says it fails | Run it on a device and paste the literal output as an observation |
| `select`+`showinfo` and `-sseof -0.1 -frames:v 1` composites | Every option is documented separately; neither composite appears on any page | Run them locally. `ffmpeg` needs no network and no gate — this is free and takes a minute |
| Windows OEM USB driver step | The page was named in a refutation but never opened | One WebFetch |
| Any named Android version for the AOSP facts | Mirror refs are branches, not pinned commits, and one version trap was already found (`uiautomator --verbose` is an Android 5.1 artifact) | Resolve each citation to a commit SHA |
| iOS control | Out of D4's scope; never researched | Stays a roadmap row, `not shipped` |

## Two environment limits worth recording for every future ticket

- **`android.googlesource.com` and `cs.android.com` are egress-blocked** here (`{"error_type":"EGRESS_BLOCKED"}`). No AOSP fact in either integration page was read from Google-hosted source; all of it came through `aosp-mirror/*`, `mirror/platform_packages_modules_adb`, or ROM forks. Both pages say so at the top.
- **`ffmpeg.org` is egress-blocked**, reproduced by two independent agents. The `doc/*.texi` sources in the FFmpeg repository are what those HTML pages are generated from and were used instead. `doc/filters.texi` on `master` is ~960 KB and exceeds a fetcher's window, so a few sections were reachable only in older tags, which the page notes per line.

The practical lesson for the harness: a documentation page being unreachable is not a reason to fall back on memory. It is a reason to read the source the page is generated from, and to say which one you read.

## What the method itself was worth

The refutation phase killed 32 of 175 claims — 18 %. Most were killed not because the command was wrong but because **the citation did not support it**: one URL stapled to two assertions, a quote that was paraphrased rather than verbatim, a fact true of a different version of the same file. Several killed claims were then *re-established* by the refuter with a better source (`palettegen`, `ebur128`, `silencedetect`'s metadata keys, the `select` scene example). A single-pass research agent would have shipped all 175, and roughly one command in six on those pages would have been subtly wrong.

The one methodological weakness the critic named and that this run did not fix: no citation pins a commit SHA.
