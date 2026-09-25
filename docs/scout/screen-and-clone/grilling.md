# Grilling round: screen capture, device control and video cloning (2026-09-15), the plan gate

Run as a hard human-in-the-loop gate (AGENTS.md, "Working with the owner"): the agent asked, stopped, and the owner answered every question and gave an explicit yes to the plan of action.

**No `scout` fan-out was run.** The demand arrived in a session with no approved network budget, so the gate of step 2 of the scout routine was never opened and there is no `dossier.md` next to this file. Every fact below came from the repository itself — `docs/PHASE0_AUDIT.md`, `docs/integrations/`, `docs/catalog/community-skills.md`, `docs/commercial/TICKETS.md`, `recipes/creative-video-higgsfield.md`. Anything about a tool that is not in those files is marked UNVERIFIED in `spec.md` and is a ticket's job to verify, never a claim made here.

Facts the agent gathered on disk before asking:

- Repository state: branch `claude/omniharness-screen-control-skill-5es5ni`, identical to `master` at `f9d9b2a`, tree clean. Six installed skills. R1/R2 (T1–T12), Phase B (P1–P4, I1–I6, O1, A1) and T13 are specified and not started.
- Reference machine (`docs/PHASE0_AUDIT.md`, 2026-09-10): Windows 11, Python 3.12.10, Node 24.19, ffmpeg 9.0, RTX 5060 Laptop GPU, `higgsfield` CLI 1.1.23 with eight skills symlinked, Playwright 1.62. Linux-first parity is a roadmap item, not a shipped one.
- Already specified and not to be duplicated: ticket **I2** (`ingest media`: reel URL to keyframes and a local transcript, `yt-dlp` gated, faster-whisper local).
- Already written and to be reused: `recipes/creative-video-higgsfield.md` (every `higgsfield` command shape and the ffmpeg assembly chain), `docs/integrations/higgsfield.md` (the gate line, the face-moderation caveat), `docs/integrations/faster-whisper.md`.
- Catalog rows in the same territory (`docs/catalog/community-skills.md`, read 2026-09-14): `bradautomates/claude-video`, `video-db/skills`, `remotion-dev/skills`, `fal-ai-community/skills`, `calesthio/openmontage` (Screen Demo pipeline), `abi/screenshot-to-code`.
- The gap: **nothing in the installed ring or the catalog controls a phone.** That is the one genuinely new capability in this demand.
- T13's owner answer 1 of 2026-09-14 already amended invariant 2: an envelope the operator signs at the start counts as the explicit prior yes for every operation inside its scope and budget, with the hard stops outside any envelope. The gate design in Q3 rests on that amendment.

---

❓ **Q1 — Which phone must the skill control?** Why it matters: Android and iOS are not the same job. Android has a free, complete path (`adb` plus `scrcpy`) that exposes a queryable view hierarchy; iOS has no programmatic UI control without macOS and Xcode, so an iOS promise would be a promise the harness cannot keep.

➡️ Recommended: Android. **Owner: Android now, iPhone on the roadmap.** The iOS line is written as `not shipped`, never as a capability.

---

❓ **Q2 — What exactly has to be filmed?** Why it matters: the phone screen, the desktop and a single window are three different capture backends, and building the ones that are not wanted is waste.

➡️ Recommended: all three if the workflow spans device and desktop. **Owner: all three — the phone screen, the computer screen, and a window or region.**

---

❓ **Q3 — What is the phone control for?** Why it matters: it decides the gate. Driving your own app under test carries no risk; driving a social app violates that platform's terms of service and can cost the account, so it cannot share a route with the harmless case.

➡️ Recommended: name the routes separately and gate them differently. **Owner: testing and demonstrating apps (including my own), collecting content from my own accounts, and general tasks on the device.** All three are in scope; the social route carries its warning on every run.

---

❓ **Q4 — Does the clone skill stop at the prompt or also generate the video?** Why it matters: everything up to the prompt is free and local; generation spends credits and needs a ceiling.

➡️ Recommended: stop at the prompt and hand off to `recipes/creative-video-higgsfield.md`. **Owner, going further than the recommendation:** the skill should be more complex and trigger a set of skills that, after the prompt, start a questionnaire for the user, generate prompts also about decisions on the artifacts the video will need and the material that already exists, and, once confirmed, start a production loop that builds the video in parts by keyframes, keeping the flow consistent with the cloned reference's prompt. The owner asked to be questioned further where anything was still open, which produced Q5 to Q8.

---

❓ **Q5 — Where does this sit against R1 and T13?** Why it matters: R1 (portal and members) and T13 (session envelope) are the queue; jumping it costs the tokens those tickets were budgeted.

➡️ Recommended: plan only now. **Owner: plan only now — spec and tickets.** No code in this round, nothing ahead of R1 or T13 in the queue.

---

❓ **Q6 — How is visual consistency held across the parts of the production loop?** Why it matters: a video generated clip by clip drifts; each mechanism costs differently and they are not mutually exclusive.

➡️ Recommended: chaining the tail frame as the next start image, as the deterministic base. **Owner: all four** — the style bible with a fixed reference image, tail-frame chaining, `soul-id` for a recurring character, and a continuity gate between parts.

---

❓ **Q7 — What is the credit ceiling per video, and what stops the loop?** Why it matters: a loop that spends without a ceiling is the exact thing invariant 2 exists to prevent, and one confirmation per clip across eight clips is unusable.

➡️ Recommended: a ceiling set in the questionnaire, warning at 80 %, hard stop at 100 %. **Owner: both — a ceiling in the opening questionnaire, plus a per-clip estimate-and-confirm mode.** So the ceiling is always on, and `--confirm per-clip` or `per-batch` chooses how loud the loop is inside it.

---

❓ **Q8 — Where does the reference video come from?** Why it matters: the URL route is ticket I2's job, and building it twice is the duplication invariant 3 forbids.

➡️ Recommended: local file for the tests, `device-lab` recording for the real use, and I2 for URLs. **Owner: all three, offered and decided automatically from the prompt.** The router picks; it asks only when the prompt is genuinely ambiguous.

---

## The owner's yes

Given to the plan of action of 2026-09-15: three skills (`device-lab`, `video-read`, `video-forge`), specified and ticketed in this round, with no implementation. The spec is `spec.md`, the routine `PLAN.md`, the tickets the Phase C block of `../../commercial/TICKETS.md`.

## What the agent flagged without being asked

1. **Social automation is against those platforms' terms of service and can cost the account.** It is in scope by the owner's answer to Q3, it is not hidden, and it lives on its own route that prints the warning every single time. The harness does not pretend this risk away.
2. **No `adb`, `scrcpy` or `ffmpeg` flag in `spec.md` is verified.** This session had no network approval and no Android device. Every command shape is marked UNVERIFIED and ticket D4 exists to verify them against the official documentation or against the owner's own machine before any of them becomes an integration page.
3. **`docs/roadmap.md` does not exist yet** — it is ticket T3's deliverable. The iOS row is recorded in `spec.md` and moves to `docs/roadmap.md` when T3 creates the file.
