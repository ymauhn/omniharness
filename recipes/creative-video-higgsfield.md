# Recipe: a short creative video with Higgsfield

Brief, storyboard, stills, image-to-video, subtitles from a local transcription, assembly with ffmpeg. Every generation spends credits and is confirmed one at a time with its estimated cost.

Owner of the command shapes: `~/.claude/skills/higgsfield/higgsfield-generate/SKILL.md` and its `references/` (read-only; the eight `higgsfield-*` skills wrap the `higgsfield` CLI 1.1.23 installed on the reference machine). Every command below is quoted from there. Facts: `docs/PHASE0_AUDIT.md` section 4.

Integration pages: [higgsfield.md](../docs/integrations/higgsfield.md), [faster-whisper.md](../docs/integrations/faster-whisper.md). ffmpeg 9.0 is present on the reference machine (integrations index).

Gate: `Bash(higgsfield:*)` in `harness/settings.json` asks on every call. The higgsfield skill's own UX rule says not to pre-estimate cost unless asked; inside this harness AGENTS.md invariant 2 wins: name the call and its estimated credits, wait for the yes, never inside a loop. The Higgsfield MCP is not used (same credits, no gate pattern).

## Prerequisites

- `higgsfield account status` succeeds. If it says `Session expired` or `Not authenticated`, run `higgsfield auth login` yourself (interactive; the agent never enters credentials).
- `ffmpeg -version` prints 9.x.
- faster-whisper is not installed by default; step 6 installs it on demand behind the gate. An NVIDIA GPU (RTX 5060 on the reference machine) makes it fast; CPU works.
- A working directory: `mkdir -p video/{brief,stills,clips,audio,out}`.

## Cost table

Higgsfield bills in credits per generation; the amount depends on model, resolution, duration and your plan. The CLI returns the estimate without submitting:

```bash
higgsfield generate cost <jst> [same flags you will pass to create]
higgsfield generate cost workflow <workflow_name> [flags]
```

Fill this table once from your plan page and from `generate cost` runs, then reuse it in every confirmation sentence:

| Step | Model (`job_set_type`) | Typical flags | Credits per call (fill in) | Calls planned | Subtotal |
|---|---|---|---|---|---|
| Still, text-to-image | `gpt_image_2` | `--aspect_ratio 16:9 --resolution 2k` | ____ | ____ | ____ |
| Still, reference-driven | `nano_banana_2` | `--image ./ref.png` | ____ | ____ | ____ |
| Image-to-video, quality | `seedance_2_0` | `--start-image … --duration 12 --resolution 4k` | ____ | ____ | ____ |
| Image-to-video, cheaper | `kling3_0_turbo` | `--start-image …` | ____ | ____ | ____ |
| Ambience / SFX | `seed_audio` | `--prompt "…"` | ____ | ____ | ____ |
| Transcription | faster-whisper, local | one-time model download | 0 credits | | 0 |
| Assembly | ffmpeg, local | | 0 credits | | 0 |
| **Total** | | | | | ____ |

Your plan's credit balance: ____. Stop the recipe if the total exceeds it.

## Steps

1. **Brief.** Write `video/brief/brief.md`: goal, audience, length (aim for 30 to 45 s on a first run), aspect ratio (`16:9` or `9:16`), tone, what must not appear, voice-over text if any. Every later prompt is derived from this file, not improvised.

2. **Storyboard.** Write `video/brief/storyboard.md` as a table: shot number, duration, still prompt, motion prompt, on-screen text. Six shots of 5 to 8 s is a full first video. Two rules that save credits: one still per shot, one video clip per still; motion prompts describe camera and subject movement only ("camera dollies in", "she turns toward the window"), because the still already fixes the look.

   STOP: confirm. Show the storyboard and the filled cost table. Nothing has been spent yet; this is where the owner trims shots.

3. **Stills.** One call per shot. Default text-to-image model is GPT Image 2; use Nano Banana 2 when a shot must match a reference image (character or product consistency).

   For each shot, first the estimate:

   ```bash
   higgsfield generate cost gpt_image_2 --prompt "<still prompt for shot 1>" --aspect_ratio 16:9 --resolution 2k
   ```

   STOP: confirm. Say the sentence, filled in from the estimate, and wait:

   > Generate still for shot 1 with `gpt_image_2`, 16:9, 2k. Estimated cost: ___ credits (balance ___). Proceed?

   Then the call, quoted from the skill:

   ```bash
   higgsfield generate create gpt_image_2 --prompt "neon city at dusk" --aspect_ratio 16:9 --resolution 2k --wait
   ```

   Reference-driven variant:

   ```bash
   higgsfield generate create nano_banana_2 --prompt "anime character concept, expressive pose" --image ./ref.png --wait
   ```

   `--wait` blocks until the job finishes and prints the result URL; add `--json` for the job object. Save each result as `video/stills/shot-01.png` (download the URL with the browser or the owner's own tool; `curl` and `wget` are on the ask list, so a download is one more confirmation). One shot, one confirmation. Six shots is six confirmations. Do not script the loop.

   Rerolls cost the same again. Before rerolling, check `higgsfield model get gpt_image_2 --json` for a parameter that would fix the issue (aspect, resolution) rather than rerolling blind.

4. **Image-to-video.** Default quality model is Seedance 2.0; Kling 3.0 Turbo is the cheaper option for a single-plane scene without strong dynamics; Grok Video 1.5 requires a start image and is limited to 2 to 15 s at 480p or 720p. Estimate first:

   ```bash
   higgsfield generate cost seedance_2_0 --prompt "<motion prompt for shot 1>" --start-image ./video/stills/shot-01.png --duration 6 --resolution <value from model get>
   ```

   STOP: confirm.

   > Animate shot 1 with `seedance_2_0`, 6 s, <resolution>, from `shot-01.png`. Estimated cost: ___ credits (balance ___). Proceed?

   Calls, quoted from the skill:

   ```bash
   higgsfield generate create seedance_2_0 --prompt "camera dollies in" --start-image ./first.png --duration 12 --resolution 4k --wait
   higgsfield generate create grok_video_v15 --prompt "cinematic handheld shot, neon rainy street" --start-image ./image.png --duration 5 --resolution 720p --wait
   ```

   Use the storyboard's duration, not 12 s, and the lowest resolution the deliverable allows (the accepted values come from `higgsfield model get seedance_2_0 --json`; the skill's example uses `4k`): both flags scale credits. `--wait-timeout 20m` if a clip takes longer than the default 10 m. Save as `video/clips/shot-01.mp4`. `seedance_2_0` does not take `--generate-audio true` (only `marketing_studio_video` does), so audio comes from step 5 or your own voice track.

5. **Ambience or sound effects (optional).** Seed Audio 1.0 is the default audio model and needs only `--prompt`:

   STOP: confirm.

   > Generate ambience with `seed_audio`: "<prompt>". Estimated cost: ___ credits. Proceed?

   ```bash
   higgsfield generate create seed_audio --prompt "cinematic rain ambience with distant thunder" --wait
   ```

   Save as `video/audio/ambience.wav` (or whatever the result URL serves). Voice-over: record it yourself as `video/audio/vo.wav`; the higgsfield-generate skill is explicitly not for TTS.

6. **Subtitles from the voice-over with faster-whisper.** Local, MIT, zero credits. It is not installed on the reference machine; the install is a `pip install` (asks) and the first run downloads a model once (network).

   STOP: confirm.

   > Install faster-whisper (`pip install faster-whisper`, MIT) and download the `large-v3` model on first use (a one-time download of a few GB for `large-v3`, far less for `small`; exact sizes UNVERIFIED here, see the integration page). No credits. Proceed?

   Exact install and verify commands: [faster-whisper.md](../docs/integrations/faster-whisper.md). Transcribe with the library's own example (from the upstream README; the integration page carries the verified form):

   ```python
   from faster_whisper import WhisperModel
   model = WhisperModel("large-v3", device="cuda", compute_type="float16")  # device="cpu", compute_type="int8" without a GPU
   segments, info = model.transcribe("video/audio/vo.wav", beam_size=5)
   ```

   Write the segments to `video/out/vo.srt`, one block per segment (`index`, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, text). The transcript is your own voice; still read it before burning it in.

7. **Assemble with ffmpeg.** Zero credits, local. Concatenate the clips in storyboard order, lay the voice-over and ambience under them, burn the subtitles:

   ```bash
   # 1. list clips in order
   printf "file 'clips/shot-%02d.mp4'\n" 1 2 3 4 5 6 > video/list.txt

   # 2. concatenate (re-encode so mixed clips join cleanly)
   ffmpeg -f concat -safe 0 -i video/list.txt -c:v libx264 -pix_fmt yuv420p -r 30 video/out/cut.mp4

   # 3. mix voice-over over ambience (ambience at -12 dB), add to the cut
   ffmpeg -i video/out/cut.mp4 -i video/audio/vo.wav -i video/audio/ambience.wav \
     -filter_complex "[2:a]volume=-12dB[amb];[1:a][amb]amix=inputs=2:duration=first[a]" \
     -map 0:v -map "[a]" -c:v copy -c:a aac -shortest video/out/mixed.mp4

   # 4. burn subtitles
   ffmpeg -i video/out/mixed.mp4 -vf "subtitles=video/out/vo.srt" -c:a copy video/out/final.mp4
   ```

   Check `ffprobe video/out/final.mp4` for duration and streams. On Windows the `subtitles=` filter needs forward slashes and, for absolute paths, an escaped drive colon (`C\:/…`).

8. **Deliver.** `video/out/final.mp4`, the storyboard, and the cost table with the actual credits spent per call (`higgsfield generate list --json` shows the jobs; `higgsfield generate get <id> --json` shows one). Report any reroll and why.

## Face moderation caveat

Generations that depict a recognisable real person may be refused or altered by the provider's moderation, and a refusal is still a submitted job. Before any prompt or reference image that contains a real face, say so in the confirmation sentence and get the owner's explicit yes that they have the person's consent. For a consenting identity that must stay consistent across shots, the supported path is a Soul Character trained once with the `higgsfield-soul-id` skill and used through `--soul-id <id>` on `text2image_soul_v2` (quoted: `higgsfield generate create text2image_soul_v2 --prompt "..." --soul-id <soul_ref_id> --quality 2k --wait`). Do not work around a moderation refusal by rewording the prompt; report it. The exact moderation rules are not documented in the local skill files: UNVERIFIED, check your plan's terms.

## What can fail

- **`Session expired` / `Not authenticated`.** Run `higgsfield auth login` yourself; the agent waits.
- **`Missing required params: prompt`.** Every image, video and `seed_audio` call needs `--prompt`.
- **`Invalid values: aspect_ratio=…` or `Unknown params: …`.** The model's schema rejects the flag. `higgsfield model get <jst> --json` lists what it accepts; pass only that.
- **`Failed to decode response. Body: <html>...captcha-delivery...`.** The provider's anti-bot fired. Wait 30 s and retry once; the agent never solves the captcha.
- **A job times out under `--wait`.** Raise `--wait-timeout 20m`, or rejoin it later with `higgsfield generate wait <id>`; the credits were spent at submission, so do not resubmit.
- **The gate did not prompt.** Either `higgsfield` ran through a path other than Bash, or the settings merge did not land. `python scripts/install.py --check`, and until it is fixed the confirmation sentence is the gate.
- **Credits ran out mid-video.** The cost table said so in advance if it was filled. Stop, deliver what exists, and never start the next shot "to finish".
- **faster-whisper on GPU fails with a CUDA/cuDNN error.** Fall back to `device="cpu", compute_type="int8"`; slower, same output.
- **ffmpeg concat produces a broken file.** Clips differ in resolution or frame rate; the re-encoding step 7.2 handles most cases, otherwise scale each clip first (`-vf scale=1920:1080`).
- **Subtitles do not appear.** The `subtitles=` filter path is wrong on Windows (see step 7) or ffmpeg was built without libass; `ffmpeg -filters | grep subtitles`.
