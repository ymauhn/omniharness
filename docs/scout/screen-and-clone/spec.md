# Spec: `device-lab`, `video-read`, `video-forge`

Written after the plan gate of 2026-09-15 (`grilling.md`, every answer the owner's). Tickets: the Phase C block of `../../commercial/TICKETS.md`. Routine: `PLAN.md`.

## The demand

Two capabilities. First, film a screen — the phone's, the computer's, or one window — and drive an Android phone the way Playwright drives a browser. Second, read a reference video, extract its style, its trend structure and its rhythm, turn that into a prompt, and produce a clone of it in parts, with the artifacts the video needs decided before anything is spent.

## Why three skills and not one

Invariant 1 wants portable skills with progressive disclosure, and the working rules want the shortest thing that does the job. The cut is by domain and, more importantly, **by cost**:

| Skill | What it does | Cost | Needs |
|---|---|---|---|
| `device-lab` | Records a screen (phone, desktop, window or region) and drives Android: view tree, locators, actions, assertions, trace | zero credits, all local | `adb`, `scrcpy`, `ffmpeg` |
| `video-read` | Reads a reference video: cuts, rhythm, hook, transcript, on-screen text, palette; writes `clone-prompt.md` | zero credits, all local | `ffmpeg`, `faster-whisper`, the model's own vision |
| `video-forge` | Questionnaire, asset ledger, storyboard, part-by-part production loop with continuity gates, assembly | credits, under a ceiling | `higgsfield`, `ffmpeg`, the two above |

`video-read` is worth having on its own: understanding a reference costs nothing. `video-forge` is the only one that spends. Fusing them would put a paid routine behind a free one's description, which is exactly how an agent ends up spending without meaning to.

## Verification status of every command in this spec

**UNVERIFIED.** This session had no approved network access and no Android device attached. Every `adb`, `scrcpy` and `ffmpeg` invocation below is a design sketch written from the agent's own knowledge, not a fact read from documentation or observed on a machine. The `higgsfield` shapes are the exception: they are quoted from `recipes/creative-video-higgsfield.md`, which quotes the installed skill files.

Ticket **D4** verifies the `adb`/`scrcpy` surface against the official documentation (a gated read) or against the owner's machine, and only then writes `docs/integrations/android-adb.md`. No command from this file is copied into an integration page before that.

## Tool inventory

| Tool | Needed for | On the reference machine? | Cost | Gate |
|---|---|---|---|---|
| `ffmpeg` 9.0 | desktop capture, keyframes, palette, assembly | yes (integrations index) | free | none |
| `adb` (Android platform-tools) | device reads, view tree, actions | **no** — not in `docs/PHASE0_AUDIT.md` | free | install asks; see the gate table |
| `scrcpy` | mirror and long recordings of the phone | **no** | free (Apache-2.0, UNVERIFIED) | install asks |
| `faster-whisper` | transcription | no; installed on demand | free, MIT | `Bash(pip install:*)` |
| `higgsfield` CLI 1.1.23 | generation | yes, with eight skills symlinked | credits | `Bash(higgsfield:*)` |
| `yt-dlp` | the URL route | no | free | **ticket I2's job, not ours** |

Nothing here needs Appium, `uiautomator2`, `browser-use` or a new Python dependency. That is deliberate — see the locator section.

---

# 1. `device-lab`

## Commands

```
device-lab devices                       # what is attached, and whether it is authorised
device-lab record <target> [options]     # target: phone | desktop | window:<title> | region:<x,y,w,h>
device-lab tree [--save <path>]          # the view hierarchy, as XML and as a readable outline
device-lab shot [--save <path>]          # one screenshot
device-lab find <locator>                # resolve a locator: matches, bounds, tap point
device-lab do <action> [args]            # one action (tap, swipe, type, key, launch)
device-lab expect <locator> <condition>  # assertion; non-zero exit on failure
device-lab run <flow.yaml>               # a whole flow, with a trace
```

## The Playwright analogy, made literal

What makes Playwright usable is not that it clicks. It is that it has **a queryable tree, locators over that tree, actions, assertions and a trace**. Android gives all five for free:

**The tree.** `adb exec-out uiautomator dump /dev/tty` returns the XML of the view hierarchy: every node with `bounds`, `resource-id`, `text`, `content-desc`, `class`, `clickable`, `enabled`. That is the DOM. (UNVERIFIED: the exact `/dev/tty` form and whether the device writes a trailing status line that must be stripped.)

**The locator.** A minimal language over that XML, resolved by our own script with `xml.etree` from the standard library:

```
text=Seguir              exact text match
text*=Segu               substring
id=com.example:id/login  resource-id
desc=Play                content-desc
class=android.widget.Button
nth=2                    disambiguates, appended with a space
```

The tap point is the centre of the matched node's `bounds`. **No Appium, no `uiautomator2`, no new dependency**: the working rules ask "stdlib? one line?" before "write code", and an XML parse plus a rectangle centre is both.

**The actions.** `adb shell input tap <x> <y>`, `input swipe <x1> <y1> <x2> <y2> [ms]`, `input text <s>`, `input keyevent <code>`, `adb shell am start -n <pkg>/<activity>`.

**The assertion.** `device-lab expect "text=Seguindo" visible` exits non-zero when it does not hold. This is the runnable check the working rules require of non-trivial logic, and it is what makes a flow a test rather than a macro.

**The trace.** Every step appends one line to `capture/<run>/trace.jsonl` — step index, action, locator, resolved bounds, exit status, timestamp, screenshot path — and saves a screenshot. A flow that failed can be read afterwards without rerunning it.

## Flows

```yaml
# flows/login.yaml
name: login to the sample app
package: com.example.app
route: app            # app | social  — see the gate table
steps:
  - launch: com.example.app/.MainActivity
  - expect: {locator: "id=com.example:id/email", condition: visible}
  - tap:    {locator: "id=com.example:id/email"}
  - type:   {text: "owner@example.com"}
  - tap:    {locator: "text=Entrar"}
  - expect: {locator: "text*=Bem-vindo", condition: visible, timeout: 5000}
```

YAML is not in the standard library. Two options, decided in ticket D3: a JSON flow file (stdlib, uglier) or a deliberately tiny YAML subset parsed by hand (no dependency, but code we own). **Recommendation: JSON for the file format, with the YAML shown above as documentation only** — it keeps the dependency count at zero and the parser at zero lines.

## Capture

| Target | Command shape (UNVERIFIED) | Notes |
|---|---|---|
| phone, short | `adb shell screenrecord --time-limit <s> /sdcard/out.mp4` then `adb pull` | no audio; Android caps a single file's length (UNVERIFIED: commonly 3 minutes) |
| phone, long | `scrcpy --record=out.mp4 --no-playback` | records the mirror, no length cap; audio on recent Android (UNVERIFIED) |
| desktop (Windows) | `ffmpeg -f gdigrab -framerate 30 -i desktop out.mp4` | the reference machine is Windows 11 |
| one window | `ffmpeg -f gdigrab -framerate 30 -i title=<Window Title> out.mp4` | title must match exactly |
| region | `ffmpeg -f gdigrab -framerate 30 -offset_x <x> -offset_y <y> -video_size <w>x<h> -i desktop out.mp4` | |
| desktop (Linux) | `ffmpeg -f x11grab -i :0.0+<x>,<y>` / `wf-recorder` on Wayland | parity row, not the reference path |

Every recording writes a sidecar `<file>.json`: source, device model, resolution, fps, duration, sha256, start time, and the exact command used. A capture with no sidecar is not a capture the harness will act on — it is how `video-read` knows what it is looking at.

Output lives under `capture/`, gitignored.

## The gate

Asking for a yes on every tap makes a flow unusable; asking for none breaks invariant 2. The split follows the precedent of ticket I3's session route and rests on the invariant 2 amendment the owner approved on 2026-09-14 (T13, answer 1): a scope the operator signs up front is the prior yes for what is inside it.

| Surface | Rule |
|---|---|
| Device reads: `devices`, `tree`, `shot`, `getprop`, `record` | free, never asks — nothing is written to the device |
| `run <flow>` on `route: app` | **one yes per flow**, stating the package, the step count, and that it writes. The loop *is* the flow, and the flow was approved as a unit |
| `run <flow>` on `route: social` | asks every time, printing the terms-of-service and account-risk warning, the app, and the step count |
| `do` as a single ad-hoc action | asks, once per action — it is not covered by a flow's yes |
| `adb install`, `uninstall`, `pm clear`, `connect`, `root`, `shell su` | asks every time |
| `adb shell pm uninstall`, `--wipe-data`, recovery/fastboot wipe, `adb shell rm -r` | **hard block** in `harness/guard_bash.py` |

New `ask` entries for `harness/settings.json`: `"Bash(adb install:*)"`, `"Bash(adb uninstall:*)"`, `"Bash(adb connect:*)"`, `"Bash(adb root:*)"`, `"Bash(scrcpy:*)"`. The flow-level and route-level gates run inside Python, match no Bash pattern, and are therefore enforced by the AGENTS.md HITL list and by the skill's own text — stated plainly, as the integrations README already does for tools called from Python.

## The social route, said plainly

Automating Instagram, TikTok or X violates those platforms' terms of service and can get the account restricted or removed. Testing your own applications carries none of that risk. The two are separate routes so the risky one cannot be entered by accident, and `--route=social` prints the warning, the app and the request count, and waits — every run, never once per session.

## Failure modes the skill must name

- `device unauthorized` — the RSA prompt on the phone was not accepted. The agent cannot accept it; the owner does, and the agent waits.
- `no devices/emulators found` — USB debugging off, cable is charge-only, or the daemon is stale.
- `uiautomator dump` returns an empty or stale tree — an animation is running; the skill retries once after a short wait and then reports, rather than tapping at coordinates from a tree that no longer describes the screen.
- A locator matches more than one node — the skill reports every match with its bounds and refuses to guess. `nth=` disambiguates.
- Coordinates from a tree taken before a rotation — the skill records orientation in the trace and refuses a tap when it changed between `tree` and `do`.
- `screenrecord` hit the device's length cap — the sidecar records the truncation instead of pretending the file is complete.

## It's working if

- `device-lab tree` on a fixture XML resolves every locator form with no device attached, and `tests/test_device_lab.py` proves it.
- A flow that fails an `expect` exits non-zero and leaves a trace that names the failing step.
- With stdin closed, `--route=social` refuses instead of proceeding (the same test I3 specifies for its session route).
- The hard-block patterns are denied by `guard_bash.py` in a unit test.

---

# 2. `video-read`

## Commands

```
video-read <source> [--slug <name>]   # source: a path, a URL, or "record" for a live capture
video-read pattern <slug>             # re-derive the structure without re-extracting
```

## The input router

The owner asked for the source to be decided from the prompt. The rule:

| The prompt shows | Route |
|---|---|
| a path that exists on disk | local file |
| an `http(s)` URL | **ticket I2's `ingest media`**, gated |
| "record", "the reel I'm watching", a device reference | `device-lab record phone` |
| none of these, or more than one | ask, once |

The URL route is **not implemented here**. Ticket I2 already specifies `ingest media --batch <n>`: gated `yt-dlp` download, ffmpeg keyframes, local faster-whisper transcription. `video-read` calls it when `ingest` exists and, until then, prints the one gated `yt-dlp` command for the owner to run and takes the resulting file as a local source. Building a second downloader would be the duplication invariant 3 forbids.

## The analysis, all local and free

- **Cuts**: `ffmpeg -i in.mp4 -vf "select='gt(scene,0.3)',showinfo" -f null -` and parse the `showinfo` timestamps, with uniform sampling as a fallback so a reel with soft transitions and no hard cuts still yields frames. (UNVERIFIED: the threshold; 0.3 is a starting point for a ticket to calibrate against a fixture.)
- **Shot table**: n, start, end, duration — which gives the **rhythm**: mean shot length, cuts per second, and where the cuts fall against the audio energy.
- **Audio**: `faster-whisper` locally (`docs/integrations/faster-whisper.md`) for a timestamped transcript; `ffmpeg` `silencedetect` and `ebur128` for the energy curve that the cuts are measured against.
- **On-screen text**: read by **the model's own vision** on the sampled frames. Invariant 3 says default to the native capability and load a dependency only when the domain warrants it; an OCR package does not earn its place when the model reads the frame directly.
- **The hook**: the first ~2 seconds treated as its own unit — what is on screen, what is said, what moves, what text appears — because that is the part a trend actually copies.
- **Palette**: `ffmpeg -i in.mp4 -vf palettegen` reduced to a hex list. Deterministic, and it is what makes `style.md` checkable later.

## Outputs, in `reference/<slug>/`

| File | Contents |
|---|---|
| `reference.json` | the machine record: duration, aspect, fps, shot table, palette, energy curve, sha256 of the source |
| `shots.md` | the shot table, readable |
| `style.md` | palette, aspect, camera language, typography treatment, grain and motion character |
| `pattern.md` | the reusable structure: hook → promise → beats → payoff → CTA, with the timing of each |
| `transcript.srt` | timestamped, from faster-whisper |
| `frames/` | the sampled keyframes |
| `clone-prompt.md` | the prompt: what to generate, in what style, on what rhythm |

`pattern.md` is the piece that carries the value. It describes **structure**, not footage: "the hook is a 1.4 s static close-up with three words of text, the first cut lands on the downbeat, beats are 2.1 s each" is reusable; the reference's own frames are not.

## The limit, written into the SKILL.md

This copies **style and structure**. It does not reproduce someone's footage, face, voice, music or trademarks. The face-moderation caveat of `docs/integrations/higgsfield.md` is inherited and restated: a real person's face needs that person's consent, stated by the owner, before it enters any prompt or reference image.

## It's working if

- On a synthetic fixture with known cut points, the shot table matches them within one frame.
- The palette is stable across two runs of the same file (deterministic).
- `clone-prompt.md` names the rhythm in numbers, not adjectives.

---

# 3. `video-forge`

## The routine

1. **Read the brief.** Takes `reference/<slug>/` from `video-read`, or runs it first.

2. **Questionnaire** — one organised round, each question with a one-line "why it matters", per AGENTS.md: subject; what replaces the reference's content; aspect and duration; the language of the on-screen text and of the voice-over; what must not appear; **the ceiling in credits or US$**; and the confirmation mode.

3. **Asset ledger** (`assets.md`). This is the owner's "decisions about the artifacts the video needs and the material that already exists". Every asset the storyboard calls for becomes a row:

   | Asset | Disposition | Source | Est. credits |
   |---|---|---|---|
   | shot 1 still | `have` | `assets/hero.png` | 0 |
   | shot 2 still | `generate` | `nano_banana_2` + anchor | ___ |
   | voice-over | `record` | the owner's own take | 0 |
   | shot 4 b-roll | `substitute` | `capture/demo-03.mp4` | 0 |

   **`have` and `substitute` are always the recommended rows.** Reusing an asset that exists is the cheapest correct answer, and the ledger exists to make that visible before the loop starts. Nothing is generated until the ledger is confirmed.

4. **Storyboard** mapped one-to-one onto `pattern.md`'s beats, so the clone inherits the reference's rhythm carrying the owner's content.

5. **STOP — the plan gate.** Ledger, storyboard, filled cost table, ceiling. An explicit yes. **Nothing is spent before this.**

6. **The production loop**, part by part, with all four consistency mechanisms the owner chose in Q6:

   - **a. Style bible and a fixed anchor.** `style.md` plus one anchor image — generated once or supplied by the owner — passed as `--image` to `nano_banana_2` on every still. Holds the look when the scene changes.
   - **b. Tail-frame chaining.** After clip N: `ffmpeg -sseof -0.1 -i clip-N.mp4 -frames:v 1 tail-N.png` (UNVERIFIED), and `tail-N.png` becomes the `--start-image` of clip N+1. Deterministic, costs no extra credits, holds continuity across the join.
   - **c. `soul-id`** when a recurring person appears: trained once with `higgsfield-soul-id`, used as `higgsfield generate create text2image_soul_v2 --prompt "…" --soul-id <id> --quality 2k --wait` (quoted from the recipe). Only with the owner's explicit statement of consent for a real face; a moderation refusal is final and is reported, never worked around by rewording.
   - **d. A continuity gate after every part**, zero tokens and zero credits: duration, resolution and fps match the storyboard; the tail frame exists and is neither black nor a frozen duplicate of the previous one; the palette distance between the two frames at the join is under a threshold. **A failed gate stops the loop** and reports — rather than spending more credits on a video that has already broken. This is the runnable check the working rules demand, and it is the difference between a loop and a runaway.

   **Budget**, per the owner's answer to Q7, is both mechanisms at once: the ceiling from the questionnaire is always in force, and `--confirm per-clip` (the default on a first video — every estimate is shown and confirmed) or `--confirm per-batch` (after the owner trusts it) chooses how often it asks inside that ceiling. Warning at 80 %, **hard stop at 100 %**, delivering what already exists. The estimate before each call comes from `higgsfield generate cost <jst> [flags]`, which returns a number without submitting.

7. **Assembly** reuses the ffmpeg chain of `recipes/creative-video-higgsfield.md` step 7 — concat, mix the voice-over over ambience, burn the subtitles, including its Windows note about the `subtitles=` filter path. Reused, not rewritten.

8. **Delivery**: `final.mp4`, the storyboard, the ledger, and the credits **actually** spent per call (`higgsfield generate list --json`), plus the measurable criterion — the reference's cut density against the clone's, side by side. A clone that claims the style but not the rhythm did not clone anything.

## It's working if

- With the `higgsfield` CLI shimmed (the precedent is `evals/cases/hitl-triage/`), the whole loop runs in a test and spends nothing.
- A planted broken clip trips the continuity gate and the loop stops at that part.
- A ceiling set below the storyboard's total stops the loop at 100 % and still delivers the finished parts.
- The delivered cut density is within a stated tolerance of the reference's.

---

# Consolidated additions to the gate

New AGENTS.md HITL list entries: `scrcpy`, `adb install`, `adb uninstall`, `adb connect`, `adb root`, `device-lab --route=social`, `video-forge` generation calls (already covered by the `higgsfield` line, restated for the loop).

New `harness/settings.json` `ask` entries: `"Bash(adb install:*)"`, `"Bash(adb uninstall:*)"`, `"Bash(adb connect:*)"`, `"Bash(adb root:*)"`, `"Bash(scrcpy:*)"`.

New `harness/guard_bash.py` hard blocks: `adb shell pm uninstall`, `adb shell rm -r`, `--wipe-data`, and fastboot wipe forms.

These land in tickets D3 and C1, not before — AGENTS.md must not promise a gate for a command that nothing can yet run.

# Deliberately left out

No Appium, no `uiautomator2`, no `browser-use`: the view tree plus `input` covers the job with the standard library. No iOS control: without macOS and Xcode there is no WebDriverAgent, and mirroring without control is not what was asked for — roadmap row, `not shipped`. No second downloader: the URL route is ticket I2's. No OCR package: the model reads the frames. No new video library (Remotion, `video-db`): `ffmpeg` is on the reference machine and does the assembly; those stay catalog rows as `alternative-to` edges. No unattended generation: the plan gate before the loop and the ceiling inside it are not optional in any mode.

# Roadmap rows (for `docs/roadmap.md`, once ticket T3 creates it)

1. **iOS device control** — `not shipped`. Requires macOS and Xcode for WebDriverAgent; on Windows the only free path is mirroring (AirPlay receiver or a capture card) with no programmatic control. UNVERIFIED whether `pymobiledevice3` exposes any usable automation surface on a non-jailbroken device from Windows.
2. **Linux capture parity** — `x11grab` and `wf-recorder` paths for `device-lab record desktop`, alongside the existing Linux-first parity row.
3. **Audio-reactive cut placement** — placing the clone's cuts on the detected beat grid rather than on the reference's absolute timings.
