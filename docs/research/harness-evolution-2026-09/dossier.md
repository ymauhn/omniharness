# Research dossier: harness improvement and developer conversion

Research date: 2026-09-22, America/Sao_Paulo. Repository baseline: `8e6c20e`. See [PLAN.md](PLAN.md) for proposed integration and [evidence.json](evidence.json) for local observations.

## Method and limits

Three native subagents independently inspected external harness patterns, local readiness and landing conversion. Root cross-checked contracts, source links, research leads and the installed CLI schema. Collection used public web search, targeted page/repository reads, local Git/source inspection and a bounded Playwright audit. No external repository code was executed, plugin installed, paid API configured or private project data uploaded.

This is targeted public collection, not an exhaustive GitHub or X crawl or a declaration of the latest/best system. X searches returned useful March/April posts; direct opening of the selected posts failed. Date-filtered searches did not establish comprehensive August/September X coverage. Indexed text is a discovery lead, not proof of a product capability. Primary papers/docs were used for the technical recommendations below.

All recommendations are proposed applications to OmniHarness, not measured improvements here. Star counts and other projects' reported benchmark gains do not establish usefulness for our cases. Per-agent tokens and billing for this research were not exposed as attributable receipts and remain unknown; native delegation used the owner's existing-authority classification.

## Primary references and reuse decisions

| ID | Opened primary source | Relevant observation | Proposed reuse / limitation |
|---|---|---|---|
| R1 | [Codex App Server](https://learn.chatgpt.com/docs/app-server) | Documents thread usage updates and execution/lifecycle events; version-specific schemas can be generated. | Investigate the native receipt adapter first. Local schema generation succeeded, but neither descendants nor desktop event access is certified. |
| R2 | [Inspect sandboxing](https://inspect.aisi.org.uk/sandboxing.html) and [agent bridge](https://inspect.aisi.org.uk/agent-bridge.html) | Sandbox provisioning alone does not contain all agent/tool/scorer code; the bridge routes through its configured provider. | Borrow boundary tests; optional benchmark bridge. Do not assume compatibility with native Astra allowance or containment of provider-hosted tools. |
| R3 | [Harbor ATIF RFC](https://github.com/harbor-framework/harbor/blob/main/rfcs/0001-trajectory-format.md) | Separates logical session identity from subagent trajectory documents; cached tokens are included in prompt tokens. | Optional version-pinned export from canonical receipts. A portable trajectory is not proof that the original measurements are trustworthy. |
| R4 | [LangGraph checkpoints](https://docs.langchain.com/oss/python/langgraph/checkpointers) | Durable state supports recovery, but replay may repeat model/API activity. | Apply explicit state/checkpoint and idempotency patterns to existing SQLite before adding a framework. |
| R5 | [OpenTelemetry GenAI agent conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md) and [repository status](https://github.com/open-telemetry/semantic-conventions-genai) | Provides workflow/agent/tool event vocabulary; conventions remain in Development. | Correlate local events first, optional exporter later. Pin convention version and omit private content by default. |
| R6 | [GEPA implementation](https://github.com/gepa-ai/gepa) | Offers reflective search with evaluation feedback and Pareto selection. | Candidate experiment adapter after E2. Reflection and discarded candidates consume resources; no gain is assumed for our harness. |
| R7 | [Meta-Harness paper](https://arxiv.org/abs/2603.28052), [author project](https://yoonholee.com/meta-harness/) and [coding artifact](https://github.com/stanford-iris-lab/meta-harness-tbench2-artifact) | Searches harness code using prior code, scores and traces. The inspected coding experiment uses the same benchmark for search and final evaluation. | Reuse a queryable candidate/evidence archive. Do not interpret that coding result as held-out-task generalization, or expand our approved mutation scope to arbitrary source rewriting. |
| R8 | [BenchJack paper](https://arxiv.org/abs/2605.12673) and [authors' walkthrough](https://moogician.github.io/blog/2026/trustworthy-benchmarks-cont/) | Reports failures in benchmark isolation and graders that allow apparent success without task completion. | Extend offline tests to evaluator/result tampering and answer leakage. We did not run their exploit code or reproduce their reported results. |
| R9 | [WHALE paper](https://arxiv.org/abs/2609.00196) and [official implementation](https://github.com/krafton-ai/WHALE) | Submitted August 31, 2026; jointly adapts model weights and harness. | Research watchlist only. Weight training and broad harness search are outside our initial restricted genome and current implementation objective. |

License observations at research time: Inspect core MIT; Harbor Apache-2.0; LangGraph core MIT; OTel conventions Apache-2.0; GEPA MIT. Recheck the exact selected artifact/version and transitive dependencies before intake. Meta-Harness artifact licensing was not established: GitHub metadata returned null and its complete six-entry tree had no LICENSE/COPYING/NOTICE. Public readability is not a reuse license; do not copy that artifact without clarification.

Public GitHub API snapshot, September 23 at approximately 00:09 UTC / September 22 at 21:09 Sao Paulo, unauthenticated:

| Repository | Observed `main` commit | Commit time UTC | License verified at that SHA |
|---|---|---|---|
| [openai/codex](https://github.com/openai/codex) | [24462234b2aeeb27373e17bbe226baf9c0e97d3b](https://github.com/openai/codex/commit/24462234b2aeeb27373e17bbe226baf9c0e97d3b) | 2026-09-23 00:07:56 | [Apache-2.0](https://github.com/openai/codex/blob/24462234b2aeeb27373e17bbe226baf9c0e97d3b/LICENSE) |
| [harbor-framework/harbor](https://github.com/harbor-framework/harbor) | [5f082d637d14ec266c8f9014002c1ecab6adb3b9](https://github.com/harbor-framework/harbor/commit/5f082d637d14ec266c8f9014002c1ecab6adb3b9) | 2026-09-23 00:09:13 | [Apache-2.0](https://github.com/harbor-framework/harbor/blob/5f082d637d14ec266c8f9014002c1ecab6adb3b9/LICENSE) |
| [gepa-ai/gepa](https://github.com/gepa-ai/gepa) | [d771eb21b5dd3228bc3f567293d2ccfc423fc900](https://github.com/gepa-ai/gepa/commit/d771eb21b5dd3228bc3f567293d2ccfc423fc900) | 2026-09-21 21:35:11 | [MIT](https://github.com/gepa-ai/gepa/blob/d771eb21b5dd3228bc3f567293d2ccfc423fc900/LICENSE) |
| [Meta-Harness coding artifact](https://github.com/stanford-iris-lab/meta-harness-tbench2-artifact) | [57fefdb2ff84af3fd81b69d67814acbe69bd0743](https://github.com/stanford-iris-lab/meta-harness-tbench2-artifact/commit/57fefdb2ff84af3fd81b69d67814acbe69bd0743) | 2026-03-26 18:26:46 | Not established |

These are observed repository identities, not installed dependency pins. Newly changed GitHub pages returned web-cache misses while the public API supplied commit/license data. Do not assume indexed documentation corresponds exactly to a newly observed HEAD; resolve the selected document at its pinned commit before implementation. The installed Codex build version above is also distinct from upstream `main`.

## X discovery register

| Indexed public post | Date shown by search | Access and disposition |
|---|---|---|
| [Yoonho Lee: Meta-Harness](https://x.com/yoonholeee/status/2038640635482456118/photo/1) | March 30, 2026 | Indexed post read; direct page failed. Followed to R7 paper, author page and GitHub artifact. Use R7 for technical conclusions. |
| [Hanchen Li: benchmark reward hacking](https://x.com/lihanc02/status/2042302344906621289/photo/1) | April 9, 2026 | Indexed post read; direct page failed. Followed the research lead to R8. The provocative score is an attack demonstration, not a model-quality result. |
| [systematicls: long-running workflows](https://x.com/systematicls/status/2038241033755168959) | March 29, 2026 | Indexed article read; direct page failed. Useful hypotheses about context/spec drift and independent checks. Its historical claim about missing Codex hooks was not adopted as current fact. |

No X API, login, cookies or private account was used. Full-thread completeness, replies, later corrections and September representativeness are unverified. A future repeat should refresh dated primary sources; broad scraping volume is not evidence quality.

## Local readiness and integration gaps

The missing piece is connection and evidence, not the absence of a large skill catalog:

- `harness/swarm_accounting.py`: whole-tree Claude receipt and durable admission/settlement exist; there is no proven native Codex adapter. The experimental USD ledger must not become a permission barrier for already-authorised allowance agents.
- `evals/records.py:telemetry()` still reads main-loop `usage` and tags available cost as measured. This conflicts with the newer complete-receipt/estimated-money distinction. Repair with a versioned migration, preserving original historical evidence.
- `harness/sandbox_probe.py` proves a fixed process profile. It is not a reusable, integrated agent executor. Worktrees do not supply OS containment.
- `swarm/swarm.workflow.js` verifies implementer scope; integrator and reviewer need equally strong captured evidence. No invented host API should be presented as delivered functionality.
- `evals/run.py` refuses live controls; isolated harness/control measurements and B8/B9 remain open.
- E2 needs a frozen reference task DAG, separate retries, weights with floor/capped centrality and calibrated human/refuter labels. GA does not yet have a reliable fitness target.
- Remote Phase C (`90534e4`) and screen-control D4 (`28d2096`) are plans/source audits on existing fetched refs, not installed functionality. They were inspected without merging.

The local CLI check found `codex-cli 0.155.0-alpha.9.2`. `codex app-server generate-json-schema --out <temporary-directory>` exited 0 and produced `v2/ThreadTokenUsageUpdatedNotification.json`, with thread/turn IDs and last/total breakdowns. It emitted a PATH-alias/home warning; no alias was installed and no model session was started. Fields alone do not establish inclusion semantics or observation. The schema's cache-write default must not be interpreted as measured zero when evidence omitted it.

## Landing audit

`scripts/site_build.py` produces public and member editions from `site/index.html`. `site/public/index.html` is the generated GitHub Pages edition. There are not two independently maintained source pages. Current member access is described as manual; there is no implemented auth/payment flow in this site.

| Finding at baseline | Evidence | Proposed action |
|---|---|---|
| Historical B5 control called valid; PASS and broad benchmark claims remain public | `site/index.html:503–539`, `site/showcase/06-metrics.json`; conflicts with `docs/benchmarks.md:5` | P0 qualification of claims and build-time evidence checks; preserve historic results with their limitations |
| Clipboard reports COPIED after rejected write | `site/index.html:670–672`; `tests/test_visual.py:46` tests label only; forced rejection reproduced at both viewports | Exercise actual success and failure semantics |
| Hero emphasizes metaphor/inventory before action | `site/index.html:356–368`; mobile CTA locations in evidence file | Test a developer outcome and visible community CTA, preserving the visual language |
| Community/services point into Discussions; no form or automatic membership | `site/index.html:481–495`, zero forms in audited DOM | Define the offer and a real, explicit entry transaction |
| Author placeholders and stale scope/governance claims | `site/index.html:575–590`, `:610`; `PRODUCT.md:11–19` | Use owner facts and delivered/experimental/planned labels |
| SEO/social and funnel measurement incomplete | Only charset, viewport and description meta tags observed; no funnel instrument found | Canonical/OG metadata and minimal completion events after defining the journey |
| Drawer closure does not restore original focus; graph has one button per node | `site/index.html:747–751` | Keyboard audit, focus return and efficient navigation; no whole-site WCAG certification claimed |

The published page was fetched publicly without credentials: HTTP 200, 162,450 bytes, SHA256 `df9d3adbfbfc0797dcc128cd36a86be4db4619937ee6babe0c8454eabe5fb0db`. It contains the old validity/approval/manual-access statements. The web reader failed for this URL; a direct public HTTP read supplied the evidence.

Review correction: the build docstring names `site/showcase/06-metrics.json`, but executable `main()` at lines 143–145 reads **`site/showcase/v3/metrics.json`**. The plan follows the executed path; the older file remains historical evidence. P0 should fix the stale docstring too. Initial audit notes relying on the docstring were corrected before handoff.

Local Chromium/Playwright checks, light theme and reduced motion:

| Viewport | Full-page height | Copy button top | Install-guide top | Horizontal overflow / JS errors |
|---|---:|---:|---:|---|
| 390×844 | 19,979 px | 888 px | 967 px | 0 / 0 |
| 1440×1000 | 13,010 px | Not recorded in summary | 871 px | 0 / 0 |

Both viewports showed COPIED after an injected clipboard rejection. These are targeted research observations, not a full suite rerun or production conversion measurement. There is no measured conversion baseline, Core Web Vitals field result or uplift estimate. Existing PT/EN, themes, reduced motion, text graph alternative and visual tests are useful foundations.

The probe printed JSON to tool output; it did not persist a raw JSON or script. `evidence.json` is a sanitized transcription of those observations, not a signed/raw event stream. A temporary mobile screenshot was taken after clicking the copy button, so it was not used as first-fold evidence. A minimal reproduction of the clipboard finding with the already-installed Python/Playwright runtime is:

```python
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(1440, 1000), (390, 844)]:
        context = browser.new_context(viewport={"width": width, "height": height},
                                      color_scheme="light", reduced_motion="reduce")
        page = context.new_page()
        page.goto(Path("site/public/index.html").resolve().as_uri(),
                  wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.evaluate("""() => Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {writeText: () => Promise.reject(new Error('simulated rejection'))}
        })""")
        button = page.locator("#event .copy").first
        button.click()
        print(width, button.inner_text())  # baseline incorrectly prints COPIED
        context.close()
    browser.close()
```

This snippet reproduces one behavioral defect; it is not the whole visual suite or a conversion experiment. Public page contents and layout may change after the recorded date.

## Primary references for the conversion work

- [GOV.UK: simple services](https://www.gov.uk/service-manual/service-standard/point-4-make-the-service-simple-to-use): test the complete user task with relevant users/devices. Apply to joining and completing a first practical task, not just clicking a button.
- [GOV.UK: completion rate](https://www.gov.uk/service-manual/measuring-success/measuring-completion-rate): define started/completed transactions and exclude internal/test traffic. Do not substitute clicks for membership or activation.
- [Google: Web Vitals](https://web.dev/articles/vitals): measure LCP, INP and CLS; field and laboratory results are different. Suggested good p75 targets: 2.5 s, 200 ms and 0.1 respectively; none was measured here.
- [W3C: target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): 24×24 CSS px or applicable spacing exceptions. Larger touch controls may help usability, but the measured 28/34 px language/theme controls are not automatically a failure.

## Decision

Recommend narrow adapters and a coherent evidence chain, not a framework replacement. Prioritize P0/P1/P2; develop E2 offline fixtures alongside them; use accepted engineering evidence to support the selected community offer. Only then compare optimization strategies. This is the proposed conclusion for owner review, not authorization to install all referenced projects or publish commercial claims.
