# graphify over the skills corpus, 2026-09-10

Experiment for the skills-graph design (docs/adr candidate): 43 SKILL.md files (3 OmniHarness, 25 mattpocock 1.2.3, 6 ponytail 4.9.0, 8 Higgsfield 0.12.0, 1 graphify 0.9.53), 43,271 words, semantic extraction by two general-purpose subagents of the session (no Gemini key), 350,910 subagent tokens, about 9 minutes in parallel. Result: 553 nodes, 960 edges, 24 communities; 44 skill nodes with 81 skill-to-skill edges (15 `calls` extracted from "Call the Skill tool" lines, 62 `references`, 4 `semantically_similar_to`); 146 of 960 edges cross a community boundary. Health check: 10 directed and 17 undirected same-endpoint collapses (parallel relations between the same pair fold into one edge in the simple graph). The communities map almost one-to-one onto skills or plugin families, so community detection rediscovers the file boundaries; the value is in the cross-skill edges and the four similarity edges, which seed `alternative-to` in the curated graph. The interactive graph.html and graph.json (1.2 MB together) stay out of the repo; the report below is the graphify output verbatim.

---

# Graph Report - skills-corpus  (2026-09-10)

## Corpus Check
- Corpus is ~43,271 words - fits in a single context window. You may not need a graph.

## Summary
- 553 nodes · 960 edges · 24 communities
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.83)
- Token cost: 350,910 input · 0 output

## Community Hubs (Navigation)
- Idea-to-ship routing
- Issue tracker and triage setup
- Ponytail YAGNI discipline
- graphify pipeline
- TDD seams and tickets
- Gauntlet hunt and refute
- Wayfinder, prototype, research
- Higgsfield websites and apps
- Codebase design vocabulary
- Teach lessons and missions
- Writing for agents
- Thesis review gates
- OmniHarness activation and gate
- Higgsfield brandkit
- Higgsfield video explainer
- Diagnosing bugs loop
- YouTube thumbnails
- Higgsfield generate models
- Code review axes
- Wizard bash setup
- Product photoshoot and cards
- Marketing Studio ads
- Soul ID characters
- Image model backends

## God Nodes (most connected - your core abstractions)
1. `ask-matt skill (router over skills)` - 35 edges
2. `higgsfield-generate skill` - 32 edges
3. `graphify skill` - 29 edges
4. `higgsfield-websites skill` - 27 edges
5. `setup-matt-pocock-skills skill` - 24 edges
6. `wayfinder skill` - 23 edges
7. `teach skill` - 23 edges
8. `thesis-review skill` - 23 edges
9. `higgsfield-brandkit skill` - 21 edges
10. `triage skill` - 21 edges

## Surprising Connections (you probably didn't know these)
- `No unrequested abstractions` --semantically_similar_to--> `Deletion as triage`  [INFERRED] [semantically similar]
  ponytail/ponytail.md → omniharness/omniharness.md
- `Background research agent` --semantically_similar_to--> `Parallel Agent tool dispatch (general-purpose subagents)`  [INFERRED] [semantically similar]
  mattpocock/research.md → graphify/graphify.md
- `Truthfulness law` --semantically_similar_to--> `Honesty Rules`  [INFERRED] [semantically similar]
  higgsfield/higgsfield-youtube-thumbnail.md → graphify/graphify.md
- `Phase R research (verified facts + Sources list)` --semantically_similar_to--> `research skill`  [INFERRED] [semantically similar]
  higgsfield/higgsfield-video-explainer.md → mattpocock/research.md
- `ponytail-review skill` --semantically_similar_to--> `code-review skill`  [INFERRED] [semantically similar]
  ponytail/ponytail-review.md → mattpocock/code-review.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Higgsfield skills sharing the CLI bootstrap (install + auth login)** — higgsfield_higgsfield_brandkit_higgsfield_brandkit, higgsfield_higgsfield_generate_higgsfield_generate, higgsfield_higgsfield_marketplace_cards_higgsfield_marketplace_cards, higgsfield_higgsfield_product_photoshoot_higgsfield_product_photoshoot, higgsfield_higgsfield_soul_id_higgsfield_soul_id, higgsfield_higgsfield_video_explainer_higgsfield_video_explainer, higgsfield_higgsfield_websites_higgsfield_websites, higgsfield_higgsfield_youtube_thumbnail_higgsfield_youtube_thumbnail, higgsfield_higgsfield_generate_bootstrap, higgsfield_higgsfield_generate_higgsfield_cli [INFERRED 0.95]
- **Idea -> ship main flow** — mattpocock_grill_with_docs_grill_with_docs, mattpocock_grilling_grilling, mattpocock_domain_modeling_domain_modeling, mattpocock_handoff_handoff, mattpocock_prototype_prototype, mattpocock_to_spec_to_spec, mattpocock_to_tickets_to_tickets, mattpocock_implement_implement, mattpocock_tdd_tdd, mattpocock_code_review_code_review [EXTRACTED 1.00]
- **Deep-module vocabulary** — mattpocock_codebase_design_module, mattpocock_codebase_design_interface, mattpocock_codebase_design_implementation, mattpocock_codebase_design_depth, mattpocock_codebase_design_seam, mattpocock_codebase_design_adapter, mattpocock_codebase_design_leverage, mattpocock_codebase_design_locality [EXTRACTED 1.00]
- **Ponytail plugin skill family** — ponytail_ponytail_ponytail, ponytail_ponytail_review_ponytail_review, ponytail_ponytail_audit_ponytail_audit, ponytail_ponytail_debt_ponytail_debt, ponytail_ponytail_gain_ponytail_gain, ponytail_ponytail_help_ponytail_help [EXTRACTED 1.00]
- **Skills configured by setup-matt-pocock-skills that read/write the issue tracker** — mattpocock_setup_matt_pocock_skills_setup_matt_pocock_skills, mattpocock_setup_matt_pocock_skills_issue_tracker, mattpocock_to_spec_to_spec, mattpocock_to_tickets_to_tickets, mattpocock_triage_triage, mattpocock_wayfinder_wayfinder [EXTRACTED 1.00]
- **Gauntlet adversarial hunt-and-refute loop** — omniharness_gauntlet_loop_gauntlet_driver, omniharness_gauntlet_loop_hunter, omniharness_gauntlet_loop_lens, omniharness_gauntlet_loop_refutation, omniharness_gauntlet_loop_round, omniharness_gauntlet_loop_token_ceiling, omniharness_gauntlet_loop_naoverificados [EXTRACTED 1.00]

## Communities (24 total, 0 thin omitted)

### Community 0 - "Idea-to-ship routing"
Cohesion: 0.06
Nodes (59): ask-matt skill (router over skills), Context hygiene (one unbroken window through /to-tickets), Flow (a path through the skills), Main flow: idea -> ship, On-ramps (triage, diagnosing-bugs, wayfinder), Phase boundaries (continue / clear / handoff / subagent / compact), PHASE-BOUNDARIES.md, Smart zone (~150k tokens of sharp reasoning) (+51 more)

### Community 1 - "Issue tracker and triage setup"
Cohesion: 0.05
Nodes (50): ## Agent skills block, AGENTS.md, CLAUDE.md, CONTEXT-MAP.md, CONTEXT.md, docs/agents/domain.md, docs/agents/issue-tracker.md, docs/agents/triage-labels.md (+42 more)

### Community 2 - "Ponytail YAGNI discipline"
Cohesion: 0.07
Nodes (43): Red -> green loop, Hunt targets, net: -<N> lines, -<M> deps possible / Lean already. Ship., ponytail-audit skill, Ranked findings (biggest cut first), Finding tags (delete, stdlib, native, yagni, shrink), Calibration knob for hardware, Caveman (terse-prose skill) (+35 more)

### Community 3 - "graphify pipeline"
Cohesion: 0.09
Nodes (33): Parallel Agent tool dispatch (general-purpose subagents), Community Detection (Louvain / graspologic), Community labelling (2-5 word names), EXTRACTED / INFERRED / AMBIGUOUS audit trail, graphify-out/cost.json token tracker, Semantic extraction cache, references/extraction-spec.md (subagent prompt), Fast path: query an existing graph (+25 more)

### Community 4 - "TDD seams and tickets"
Cohesion: 0.09
Nodes (31): ADRs, CONTEXT.md, Horizontal slicing (anti-pattern), Implementation-coupled test (anti-pattern), mocking.md, Seam, Tautological test (anti-pattern), tdd skill (+23 more)

### Community 5 - "Gauntlet hunt and refute"
Cohesion: 0.12
Nodes (29): agentes_max = areas x maxRodadas + maxAchadosPorRodada x maxRodadas x lentes, Area ({key, prompt}), AskUserQuestion, Single AskUserQuestion checkpoint, CLAUDE.md / README.md / docs, Untracked-files snapshot (gauntlet-antes / gauntlet-depois), decisaoNecessaria (decision needed), Failing test first (Phase 4) (+21 more)

### Community 6 - "Wayfinder, prototype, research"
Cohesion: 0.13
Nodes (25): Decision tickets (wayfinder shared map), LOGIC.md branch (single HTML state-machine demo), Prototype kept as primary source on prototype/<name> branch, prototype skill, Prototype rules (trivial to run, no persistence, skip polish, surface the state), Throwaway prototype (code that answers one design question), UI.md branch (several UI variations behind a URL param), Background research agent (+17 more)

### Community 7 - "Higgsfield websites and apps"
Cohesion: 0.15
Nodes (23): React 19 + TanStack Start SSR in one Cloudflare Worker (D1/R2/KV/DO), Cover + metadata (app/src/app-meta.json), fnf SDK + Sign in with Higgsfield + D1 contract, Game art & audio references (stylization, spritesheets, textures, Meshy, audio), Game: six pure functions in app/src/logic.js + realtime rooms, git + bun local tooling (app/ directory), higgsfield-websites skill, No plumbing language rule (+15 more)

### Community 8 - "Codebase design vocabulary"
Cohesion: 0.17
Nodes (23): Adapter (a concrete thing satisfying an interface at a seam), codebase-design skill (deep-module vocabulary), Deep module (small interface, lots of implementation), DEEPENING.md (dependency categories, seam discipline, replace-don't-layer testing), The deletion test, Depth (leverage at the interface), Design-it-twice (parallel sub-agents design the interface several ways), DESIGN-IT-TWICE.md (+15 more)

### Community 9 - "Teach lessons and missions"
Cohesion: 0.15
Nodes (23): ./assets/*, Community, Component (assets), Desirable difficulty (retrieval, spacing, interleaving), Feedback loop, Fluency strength vs storage strength, Knowledge / Skills / Wisdom triad, Learning record (+15 more)

### Community 10 - "Writing for agents"
Cohesion: 0.12
Nodes (23): Context pointer (Decisions-so-far), AGENTS.md, Branch (distinct case a document handles), CLAUDE.md, Co-location, Completion criterion (clarity, demand), Context pointer, Environment as source of truth (documents as cache) (+15 more)

### Community 11 - "Thesis review gates"
Cohesion: 0.15
Nodes (23): AskUserQuestion, .bib and .blg, Compile gate (docker texlive latexmk), docker (texlive/texlive), Gates (facts, style, integrity), learnedRules, Manuscript wins / never touch manual edits, Modes (parecer, apply, check, bib) (+15 more)

### Community 12 - "OmniHarness activation and gate"
Cohesion: 0.12
Nodes (21): args.exemplo.json, .claude/gauntlet-loop.json, <root>/AGENTS.md, Benchmark regression, ~/.claude/CLAUDE.md, .claude/gauntlet-loop.json, Deletion as triage, docs/install.md (+13 more)

### Community 13 - "Higgsfield brandkit"
Cohesion: 0.15
Nodes (18): Brand Lock (canonical visual constraints), Brandbook (PPTX / PDF via bundled builder), scripts/brandkit.py (state / preview / logo-inspect / logo-export / brandbook-build), Dependency invalidation via required_slots, Design Brain (private art direction), Deterministic local SVG/PPTX/HTML construction, Explicit approval rule, Failure policy (retry once, never a visually different fallback) (+10 more)

### Community 14 - "Higgsfield video explainer"
Cohesion: 0.17
Nodes (17): Gemini Omni Flash (gemini_omni), Seed Audio 1.0 (seed_audio), Audio-first phase barrier, blocks.json ordered video/audio job pairs, CMS explainer presets (preset list / resolve), explainer_video server-side assembler, higgsfield-video-explainer skill, Mascot vs faceless character mode (+9 more)

### Community 15 - "Diagnosing bugs loop"
Cohesion: 0.20
Nodes (17): Bisection harness (git bisect run), Cleanup checklist (loop green, regression passes, logs removed, hypothesis in commit), Correct seam for the regression test, diagnosing-bugs skill, Differential loop (old vs new version diff), 3-5 ranked falsifiable hypotheses, Feedback loop (one command that goes red on this bug), scripts/hitl-loop.template.sh (+9 more)

### Community 16 - "YouTube thumbnails"
Cohesion: 0.18
Nodes (16): Seedream v5 Pro (photoreal mockups / edits), Seedream 4.5, Emotion ladder (shock, hype, rage, awe, ...), higgsfield-youtube-thumbnail skill, IDENTITY LOCK character block, Information-gap concept (one focal subject, reads at ~120px), No --count: one call per concept / emotion / take, Post-render vision gate (+8 more)

### Community 17 - "Higgsfield generate models"
Cohesion: 0.23
Nodes (14): higgsfield-game-generation skill, Virality Predictor (brain_activity), Discovery guardrail (full model list before trusting search), higgsfield-generate skill, Kling 3.0 / Kling 3.0 Turbo, Media flags (--image / --start-image / --end-image / --video / --audio), Multi-Image to 3D (multi_image_to_3d), references/media-inputs.md (+6 more)

### Community 18 - "Code review axes"
Cohesion: 0.22
Nodes (13): .scratch/<feature>/issues/ local tracker, Tracer-bullet tickets with blocking edges, code-review skill, CODING_STANDARDS.md / CONTRIBUTING.md, Fixed point (git diff <ref>...HEAD three-dot), Fowler, Refactoring (ch.3 code smells), git (diff / log / rev-parse / commit), docs/agents/issue-tracker.md (+5 more)

### Community 19 - "Wizard bash setup"
Cohesion: 0.22
Nodes (13): bash -n syntax check, .env / .env.example / .env.*, gh secret / gh variable, .github/workflows/* (secrets.* / vars.* references), Library helpers (stage, say/step, open_url, ask/ask_secret, write_env, set_secret/set_var, pause/confirm), README / docker-compose / framework config, shellcheck, Stage (+5 more)

### Community 20 - "Product photoshoot and cards"
Cohesion: 0.27
Nodes (12): Higgsfield CLI bootstrap (curl install + auth login), higgsfield CLI, --wait one-shot submission rule, A+ style content modules, Asset types (main_image, infographic, multi_angle, lifestyle, aplus_*), higgsfield-marketplace-cards skill, Scope bundles (main / product-images / aplus / full-set), higgsfield-product-photoshoot skill (+4 more)

### Community 21 - "Marketing Studio ads"
Cohesion: 0.20
Nodes (11): Ad reference vs hook/setting exclusivity, Click-to-Ad shortcut (URL-driven), Marketing Studio (marketing_studio_video / _image), Marketing Studio Ad format (dtc-ads), Marketing Studio Ad reference, Marketing Studio Avatar (preset / custom), Marketing Studio Brand kit (brand-kits fetch --url), Marketing Studio Hook (+3 more)

### Community 22 - "Soul ID characters"
Cohesion: 0.28
Nodes (9): Soul Cinema / soul_cinematic, Soul 2.0 (text2image_soul_v2), higgsfield-soul-id skill, Paid plan (Basic+) requirement, Soul reference_id (--soul-id), references/photo-guide.md, Soul Character (personalised face identity model), higgsfield soul-id create / wait / list (+1 more)

### Community 23 - "Image model backends"
Cohesion: 0.29
Nodes (7): GPT Image 2 (gpt_image_2), Nano Banana 2 / Lite / Pro, Backend marketplace enhancer (compliance rules + templates), higgsfield marketplace-cards create command, Backend prompt enhancer (mode-specific photography vocabulary), higgsfield product-photoshoot create command, Optional 3D logo render (gpt_image_2, 1:1 4K)

## Knowledge Gaps
- **99 isolated node(s):** `Knowledge Graph`, `graphify-out/cost.json token tracker`, `Obsidian vault export`, `graphify MCP stdio server`, `references/exports.md` (+94 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 135 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ask-matt skill (router over skills)` connect `Idea-to-ship routing` to `Issue tracker and triage setup`, `TDD seams and tickets`, `Wayfinder, prototype, research`, `Codebase design vocabulary`, `Teach lessons and missions`, `Writing for agents`, `Diagnosing bugs loop`, `Code review axes`, `Wizard bash setup`?**
  _High betweenness centrality (0.597) - this node is a cross-community bridge._
- **Why does `research skill` connect `Wayfinder, prototype, research` to `Idea-to-ship routing`, `Higgsfield video explainer`?**
  _High betweenness centrality (0.425) - this node is a cross-community bridge._
- **Why does `Phase R research (verified facts + Sources list)` connect `Higgsfield video explainer` to `Wayfinder, prototype, research`?**
  _High betweenness centrality (0.344) - this node is a cross-community bridge._
- **What connects `Knowledge Graph`, `graphify-out/cost.json token tracker`, `Obsidian vault export` to the rest of the system?**
  _99 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Idea-to-ship routing` be split into smaller, more focused modules?**
  _Cohesion score 0.06019871420222092 - nodes in this community are weakly interconnected._
- **Should `Issue tracker and triage setup` be split into smaller, more focused modules?**
  _Cohesion score 0.053877551020408164 - nodes in this community are weakly interconnected._
- **Should `Ponytail YAGNI discipline` be split into smaller, more focused modules?**
  _Cohesion score 0.07308970099667775 - nodes in this community are weakly interconnected._