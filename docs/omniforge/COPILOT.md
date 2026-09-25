# Prompt Copilot in the local Lab

The workspace composer now mounts the two-skin companion. Its default is Discreet: after a 1.7-second pause, a focused, visible draft queries installed-skill metadata. Active uses a 0.7-second pause; Off cancels pending suggestions. These are local catalog queries, not LLM calls. Preferences are per project in browser storage; prompt text is not stored there.

Select text in the **orchestrator composer**, then choose Clareza, Contexto, Pesquisa or Skills. A template displays a replacement preview; Apply changes only the captured span. Undo requires the resulting draft and revision still to match. Changing project, editing and restoring the same text, starting another request or switching Off invalidates older suggestions. Nothing is sent to a terminal or executed by accepting a suggestion.

Context templates cite up to three current-project/global notes within a 1,000-character excerpt. Session-private and other-project notes are excluded. Templates leave explicit fields for the user to complete; they are not represented as semantic rewriting. Dismissing preserves the draft and offers a small follow-up choice, at most once per revision, with a 12-second cooldown.

The modern and pixel robots are authored SVG with one finite CSS greeting. There is no continuous render loop. Hidden views stop scheduling; reduced-motion and the explicit animation-off setting suppress motion. Visual acceptance, accessibility in a real browser and measured rendering resources remain V-01 in [the final validation register](VALIDATION-PENDING.md).

## Catalog connection

The Skills tab reads the full local catalog, with paginated metadata, PT/EN aliases, examples, provenance, curation gaps and coverage errors. Explicit **Atualizar índice** rebuilds the snapshot before reloading the page. Concurrent query/project changes discard stale results. A failed build does not report successful refresh. The fallback contains only the repository's small legacy inventory and is labeled incomplete.

The token-authenticated Lab service invokes a fixed Python module with bounded stdin/stdout, timeout and at most four concurrent children. It exposes metadata, not skill bodies or absolute source paths. Listing/search/recommendation grants no execution authority. Host context informs ranking; unknown compatibility stays unknown.

## Classifier boundary

The [typed Laya/JEV adapters](CLASSIFIER-ADAPTERS.md) preserve strict candidate identity and abstention. The composer defaults to lexical retrieval; its settings now offer **Carregar Laya**, local classification and **Descarregar Laya**. Explicit activation starts a separate pinned CPU worker, with one active request and at most two waiting, a 60-second warm-up deadline and a 5-second inference deadline. Two idle minutes unload it. Unload applies to the whole local app; other windows fall back to metadata until explicitly re-enabled. Changing projects/preferences during loading cannot silently opt a different draft into Laya. Templates remain deterministic.

The worker uses the separately installed `.omniharness/runtime/laya-venv` and pinned multilingual model. It does not download or install on activation. Model requests carry bounded prompt excerpts and metadata through stdin, not command-line arguments; protocol replies cannot execute tools. Status/errors do not contain prompt text or raw provider diagnostics. Shutdown waits for the worker's actual close; failed cleanup is unavailable rather than claimed stopped. This single inference-process lifecycle is not certification of arbitrary agent descendant containment.

[Actual Laya measurements](LAYA-LOCAL-OBSERVATION.md) include an abstained positive case and significant resident memory; no calibrated improvement is claimed. The [final authenticated HTTP smoke](../experiments/laya-http-smoke-2026-09-25.json) loaded the real worker in 6.627 s, handled three requests in 0.631–0.947 s including catalog lookup, and unloaded successfully. Both positive prompts abstained below threshold against the real catalog; the unrelated prompt selected none. Lexical ordering therefore remains the default and fallback. The initial pre-repair smoke is retained separately. Warm-up token counters are not aggregated, so this is not complete worker accounting. Current ranking uses Codex host context; Claude-specific shortlist selection remains to be connected. JEV has offline contract tests but no live account/credit validation or connected composer key UI yet.

Checks: `npm --prefix omniforge-lab test` and `python -m unittest tests.test_skill_catalog tests.test_catalog_api tests.test_prompt_classifier tests.test_classifier_worker`. Source/DOM-seam checks do not replace the deferred browser round. The complete runner and review record are in [T13 validation](../t13/VALIDATION.md).
