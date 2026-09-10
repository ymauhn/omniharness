# faster-whisper

## What it is
Local speech-to-text: OpenAI Whisper models re-implemented on CTranslate2, several times faster than the reference implementation, CPU or CUDA.

## When to reach for it
Try first: the host's own audio understanding when the file is short, or a transcript that already exists (YouTube captions via WebFetch or Agent-Reach). Reach for faster-whisper for long recordings, batch work, or when the audio must not leave the machine. Routing row: "Transcribe".

## Cost and keys
Free, no key. One-time download of the model weights from the Hugging Face Hub (tiny to large-v3, tens of MB to a few GB). GPU optional: the reference machine has an RTX 5060 Laptop GPU; CUDA 12 plus cuDNN 9 are needed for `device="cuda"`, otherwise `device="cpu"` works.

## Network and the gate
Not gated: local and free. Network only at first model load (the download) and at `pip install`, which asks through `"Bash(pip install:*)"`. State the model size before the first download.

## Install
```
pip install faster-whisper
```
Audio prep: ffmpeg 9.0 is already on the reference machine (`ffmpeg -i in.m4a -ac 1 -ar 16000 out.wav` to normalise before transcribing; faster-whisper also decodes most formats directly).
AGPL alternative with word-level timestamps: `pip install whisper-timestamped` (CLI `whisper_timestamped audio.mp3 --model tiny --output_dir .`; needs ffmpeg). Pick it only when word timestamps matter and AGPL is acceptable for the deliverable.

## Activate in OmniHarness
Routing row "Transcribe": faster-whisper, installed on demand. Default `small` or `medium` on CPU, `large-v3` with `compute_type="float16"` on the GPU. Write the transcript next to the audio as `.txt` (and `.srt` when timestamps are wanted); never paste minutes of raw transcript into chat.
Say first: "This installs faster-whisper and downloads the `<model>` weights (~N MB) once; free, local. Proceed?"

## Verify it works
```
python -c "from faster_whisper import WhisperModel; m=WhisperModel('tiny',device='cpu',compute_type='int8'); s,i=m.transcribe('sample.wav'); print(i.language, [x.text for x in s])"
```
Expected: the detected language code and a list of transcribed segments.

## Uninstall
`pip uninstall faster-whisper ctranslate2`; the model cache under `~/.cache/huggingface/hub/` goes on the triage list.

## License
faster-whisper: MIT. whisper-timestamped: AGPL-3.0.

## Source
https://github.com/SYSTRAN/faster-whisper · https://github.com/linto-ai/whisper-timestamped

Verified on 2026-09-10.
