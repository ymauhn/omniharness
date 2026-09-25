# Local Laya observation — September 25, 2026

The required Laya path is installed in a separate project runtime, `.omniharness/runtime/laya-venv`, using Python 3.12.14. [Dependency versions](../experiments/laya-python-lock-2026-09-25.txt) are recorded; the main repository test Python was not replaced. Model: `convaiinnovations/laya-multilingual`, Apache-2.0, pinned revision `e4e9ddf21a7b1903b7acffd8814ad4307bf63a67`. The [artifact manifest](../experiments/laya-artifacts-2026-09-25.json) records downloaded and runtime hashes, including the preserved original tokenizer configuration. The only normalization converts its extra-special-token list into the mapping expected by this Transformers version, matching Laya's compatibility shim. No custom Hub Python was downloaded or enabled.

An initial three-case [direct-model smoke](../experiments/laya-local-smoke-2026-09-25.json) selected code review in Portuguese, tests in English, and none for weather. Cold import/load took 10.703 s; individual requests took 69–144 ms. These were simple questions without the adapter's full selection/fit contract.

The [actual adapter observation](../experiments/laya-adapter-smoke-2026-09-25.json) used that contract with unchanged default thresholds, two candidates, CPU and four thread settings. It repeats three public prompts four times, **not 12 independent quality cases**. Code review and the unrelated request behaved as expected; the regression-test request abstained below threshold on every repetition. Thus 8/12 observations matched the simple expected choice, representing 2/3 unique cases. No thresholds were tuned to turn this into a pass.

| Observed resource | Result |
|---|---:|
| Cold hash verification, loading and first inference | 21.384 s |
| Warm calls | 11 |
| Warm median / maximum | 205.422 / 253.025 ms |
| Final working set | 1,721,114,624 bytes (~1.60 GiB) |
| Peak working set during load/inference | 2,358,521,856 bytes (~2.20 GiB) |
| Private committed bytes after inference | 1,907,884,032 |

This is not a calibrated holdout benchmark, p95 claim or proof of savings. Local input tokens are provider observations; reported output tokens are zero because the model classifies instead of generating text. Remote JEV was not called. Electricity/hardware cost is unmeasured, not a dollar-zero receipt.

The subsequent [resident worker/composer integration](COPILOT.md) now exposes explicit warm-up, a bounded queue, inference deadline, idle unload and manual unload. It preserves deterministic retrieval without loading ML. The [final real HTTP observation](../experiments/laya-http-smoke-2026-09-25.json), after the pipe-error repair, passed the activation/refusal/unload lifecycle: warm-up 6.627 s, three requests 0.631–0.947 s including catalog subprocess work. Both positive prompts abstained below threshold against the real catalog, while weather selected none. The [initial observation](../experiments/laya-http-smoke-2026-09-25-initial.json) remains retained. Filesystem/library caches differ from the original standalone cold load, so the shorter warm-up is not a measured optimization gain.

Local selection input/output counters are recorded, but the synthetic warm-up selection's counters are not emitted or aggregated; whole-worker usage remains incomplete. This loopback API observation is not a browser interaction or a calibrated task benchmark. Human-labeled PT/EN comparison, broader latency/resource acceptance and the optional remote provider remain in the final validation round. Do not lower thresholds against these smoke examples just to obtain selected answers.

Primary references: [Laya source](https://github.com/NandhaKishorM/laya), [multilingual model card and limitations](https://huggingface.co/convaiinnovations/laya-multilingual), [JEV HTTP contract](https://docs.typesafe.ai/api). The model card itself reports overconfidence and warns that calibration must be measured on the target data.
