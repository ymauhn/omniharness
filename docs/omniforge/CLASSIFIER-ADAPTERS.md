# Bounded prompt classifier adapters

`harness/prompt_classifier.py` implements a selection boundary for Laya and JEV. It does not load skills, execute tools, change catalog availability, or grant authority. Every result has `runnable=False`; the caller must independently resolve the exact source identity, current host availability, and task authority. No UI or automatic typing-trigger integration is enabled by this module.

The separate [Lab resident worker and composer controls](COPILOT.md) now call this module after explicit local activation. The parent provides bounded queue/deadlines and unload, while this adapter retains the selection contract. JEV remains disconnected from the composer; only the task router below can reach it.

The input is an already-redacted prompt excerpt of at most 2,048 UTF-8 bytes and one to eight `Candidate(source_id, description)` values. Descriptions are at most 256 UTF-8 bytes. Session objects and full skill bodies are not accepted input fields. This boundary does not detect every secret in free text: redaction and permission to send that excerpt remain caller responsibilities.

```python
from harness.prompt_classifier import Candidate, LayaClassifier, select_jev

shortlist = [Candidate("source:review", "Review code for correctness")]
local = LayaClassifier(absolute_checkpoint_directory, reviewed_artifact_sha256)
selection = local.select("Revise este código", shortlist)

# Only after explicit per-provider opt-in; the caller supplies the key in memory.
remote = select_jev("Revise este código", shortlist,
                    enabled=True, api_key=caller_supplied_key)
```

Both providers use a closed choice containing the exact candidate IDs and `none`. By default, the same request also asks for one independent fit judgment per candidate. Acceptance checks the **selected candidate's** fit; a high score for an unrelated candidate cannot validate the chosen one. `SelectionConfig(require_fit=False)` explicitly omits that extra check.

Responses must contain the exact question and option sets, finite probabilities in [0, 1], a distribution summing to 1 within 0.0005 (allowing the local model's four-decimal rounding), and a known selected option with the highest probability. Duplicate JSON keys, malformed JSON, unexpected model identity, unknown choices, and invalid distributions abstain. Extra provider fields such as suggested actions are discarded. Invalid input, unavailable providers, failures, and low scores also abstain without returning raw exceptions or provider bodies.

`SelectionConfig` defaults are **uncalibrated policy settings**: minimum selected probability 0.65, runner-up margin 0.15, and selected fit 0.65. They are not a quality claim. The [Laya multilingual model card](https://huggingface.co/convaiinnovations/laya-multilingual) explicitly reports uncalibrated, overconfident scores and weak zero-shot typed decisions. Portuguese/English held-out evaluation and human acceptance remain separate work; this test suite contains protocol fixtures only.

Every valid answer also carries `probability`: the top option's score (including on `none`, `below_threshold` and `selected_fit_failed`), for display only. It is uncalibrated and never overrides the thresholds; invalid or failed answers carry `None`.

## Lab task router (SWARM-PLAN W6)

`omniforge-lab/router.mjs` (`POST /api/tasks/:id/route`) suggests, for one task, a host (`claude|codex`), an installed skill and an effort tier (`baixo|médio|alto`) by asking this contract three closed questions: two host candidates, three effort candidates and the lexical catalog's top three installed skills. The host and effort descriptions are uncalibrated routing policy text in `router.mjs`. Laya answers only after the owner loaded it, one question at a time through the resident worker. JEV is asked only when a `jev` key is stored in the Windows vault and the request itself sets `jev: true` (a per-request checkbox on the task card); the router reads the key from the vault and passes it on stdin to `python -I harness/prompt_classifier.py` (`main()`), which runs one `select_jev` per question, so one suggestion can make up to three remote requests. Any field that is not a valid `selected` answer falls back to the lexical catalog match: the skill only, host and effort stay unsuggested. Each field returns its value, source (`laya|jev|lexical`), probability and reason, with the total wall time. The suggestion is never runnable: it only marks the suggested host's run button, and the owner still clicks it.

## Local Laya

The native loader targets the inspected PyPI Laya **0.3.20 wheel**, whose API differs from current GitHub main. It lazily imports the package and calls `load(absolute_local_path, device="cpu")`; it never selects a Hub ID or uses the Router. The caller supplies the reviewed checkpoint and hashes. Required weights, agent config, local encoder config, and tokenizer files are verified before and after loading. The entire checkpoint tree must match the manifest, with only the known encoder/tokenizer directories permitted. The preserved `tokenizer/tokenizer_config.json.pre-omniharness` backup is accepted only with its own manifest hash. Extra files, empty directories, changed files, or incomplete checkpoints cause abstention. Normalize any necessary tokenizer compatibility change in a separately reviewed owned copy before pinning it; the adapter does not repair artifacts.

Run the local adapter in a dedicated worker configured with `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `HF_HUB_DISABLE_IMPLICIT_TOKEN=1`, and `USE_TF=0` before ML imports. The loader sets these flags before its own import and refuses an already-imported online Hugging Face hub. It caches one loaded model, serializes inference, and preserves the loaded artifact version. The bounded request uses `max_len=8192` and `head_max_len=4096` to avoid the shipped 1,024-token truncation default. This is local CPU inference, not an LLM/API call. Local load/inference has no hard cancellation guarantee; host latency and memory measurements are separate evidence.

The root runtime installation and artifact provenance are maintained separately. The adapter does not install packages, download weights, access credentials, or scan a vault.

## Remote JEV

The [official API](https://docs.typesafe.ai/api) receives exactly `{state, questions, model}`. The transport pins HTTPS to `api.typesafe.ai/v1/systemone` and the [versioned model](https://docs.typesafe.ai/models) `jev-1.13.0`. It sends one request only, with an eight-second default socket/deadline budget (configurable up to 30), a 16 KiB request bound and a 64 KiB response bound. Redirects, compressed responses, non-200 responses, automatic retries, environment-proxy discovery, and SDK retry defaults are not used. OS DNS resolution is outside Python's socket timeout. No live JEV request is part of the offline suite.

`enabled=True` and a key supplied by the caller are both required. The adapter never discovers a key from environment variables. The key appears only in the Authorization header and is not retained in the result. Callers should avoid automatic retry loops or calling during active typing without separate consent and a request budget.

`Usage` records valid observed `input_tokens` and `output_tokens` independently. Missing or invalid counters are `None`, including timeout/failure cases; they are never synthesized as zero. A reported local output count of zero is preserved as an observation. Selection contains no monetary calculation or billing guarantee. Failures may already have consumed remote usage even when no receipt arrived.

## Offline checks

Run `python -m unittest tests.test_prompt_classifier -v`. The injectable transport and model loader test success, none, selected-fit disagreement, invalid/duplicate/nonfinite response data, bounds, missing usage, secret-safe failures, no-opt-in/no-key behavior, redirects, deadline interruption, and local artifact drift. They establish adapter behavior, not provider accuracy or a live billing result. The router's offline checks (`node --test omniforge-lab/test/router.test.mjs`) fake both providers: choice, abstention, timeout and invalid answers falling back to lexical, and JEV never called without both a vault key and the request's opt-in.
