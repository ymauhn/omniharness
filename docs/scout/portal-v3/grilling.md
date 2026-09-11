# Grilling round: portal v3 (2026-09-11), the plan gate

The first round run as a hard human-in-the-loop gate (AGENTS.md, "Working with the owner"): the agent asked, stopped, and the owner answered every question and gave an explicit yes to the plan of action. Dossier: the v2 one (`../portal-v2/dossier.md`), reused at the owner's request to save tokens. Facts the agent gathered before asking: impeccable 4.3.1 installed at user scope, launcher binary not yet downloaded; force-graph 1.51.4 on jsDelivr (not on cdnjs); Playwright 1.62 with Chromium; artifact cap 16 MB; eight captures at 6.4 MB; impeccable's `init` asks for users, mechanism and constraints.

❓ **Q0 - Launcher binary**: who runs the first `impeccable context`, which downloads the signed 15.6 MB binary?

➡️ Recommended: the agent, with the owner's yes. **Owner: (a) yes, authorized from this session.**

---

❓ **Q1 - Tier-1 as checkable criteria, and calibration products**

➡️ Recommended: finish-reviewer `ship`; `tests/test_visual.py` green at 1440 and 390, light and dark; `ponytail-review` at `net: 0`; public edition under 350 KB excluding force-graph; calibration: Linear, Vercel changelog, Raycast. **Owner: approved as stated, calibration kept.**

---

❓ **Q2 - Refine the QRH world or replace it**

➡️ Recommended: refinement. **Owner: redesign. Run the design decision round (shape, directions), record the choices in the flow, then the pipeline context → init → document → typeset → layout → colorize → animate → polish → critique, audit, finish-reviewer.**

---

❓ **Q3 - force-graph scope**

➡️ Recommended: physics cooling after ~3 s (drag re-warms), three rings by radial force, zoom and pan, rich tooltip, detail drawer (side on desktop, bottom sheet on mobile), zoomToFit per scroll step, pinned 1.51.4 from jsDelivr. **Owner: approved in full.**

---

❓ **Q4 - Scrollytelling engine** (a detour in miniature: IntersectionObserver by hand; scrollama; the scroll-craft skill)

➡️ Recommended: IntersectionObserver by hand with the graph panel as the pinned stage; scrollama only if the WebKit run shows jumps; scroll-craft stays a candidate. **Owner: option (1); fallback to scrollama only if the Playwright WebKit test fails.**

---

❓ **Q5 - Evolution showcase v1 → v2 → v3 and raster policy**

➡️ Recommended: comparison strip of the three 1440-light captures at 720 px, a before/after slider on the hero (v2 vs v3), a metrics table per version, narrative frames; full-size captures in the repository, downscaled ones in the page, data URIs only in the members edition (≤ 1.5 MB), provenance in `report.json`. **Owner: approved; a detour is allowed on a punctual aesthetic dilemma.**

---

❓ **Q6 - Visual TDD assertions**

➡️ Recommended: 1440 and 390 × light and dark full pages, plus three state captures (graph node hover with tooltip, active library filter, pressed copy button); no overflow, body contrast ≥ 4.5, canvas inked and node count equal to graph.json, tooltip within 300 ms, zero console errors; red rounds recorded in the showcase. **Owner: approved.**

---

❓ **Q7 - Product truth for impeccable's init (PRODUCT.md)**

➡️ Recommended: developers on Claude Code, Codex or Hermes who pay for tokens; the gate-and-plan mechanism; the no-invented-claims constraints. **Owner, consolidated:**

- **Users and situation**: developers, solopreneurs, technical leads, content creators and researchers who want to build or operate modular, multimodal autonomous agents in Claude Code, Codex and Hermes, and demand absolute cost control (tokens), predictability and audited code with no black boxes.
- **Value proposition and mechanism (Context and Graph Spec-Driven Development)**: a complete agent-engineering ecosystem that orchestrates the whole lifecycle: capability mapping as a knowledge graph (skills-graph) with on-demand activation and installation, active research of technical and market references (scout), controlled divergent thinking (detour), mandatory human alignment (grill-me, the plan gate), formal specification (to-spec), top-tier design (impeccable) and audited implementation with visual TDD (ponytail). A living, comprehensive curation: not only tools and MCPs but a permanently updated catalog of complete workflows, autonomous pipelines, hooks, operating routines and specialised agents ready to run in different experimental scenarios. Open-core business model: a free core (open source, MIT: the base harness, the essential scripts and the open skill specifications), a premium members layer (the vault of practical assets: rigorously tested prompts, ready workflows, audit batteries with Gauntlet loops, specialised designs for proven real cases, end-to-end tutorials, with an integrated consulting agent on the roadmap), and specialised consulting and enterprise services (architecture, custom setup, implementation for companies and solopreneurs).
- **Constraints and invariants**: no paid call or network access without an explicit gate; parity between hosts; deterministic zero-token tests wherever possible; radical transparency (no fake forms, no invented metrics).

---

❓ **Q8 - Ceiling and stop rule**

➡️ Recommended: 1.5M subagent tokens, at most two finish-reviewer rounds, no paid evals, `explain-usage` at the end. **Owner: approved.**

---

❓ **Q9 - What stays untouched**

➡️ Recommended: content, members mechanism, proof format, invariants footer, library taxonomy. **Owner: dynamic scope aligned with Q2 and Q7: copy, section hierarchy and the way the community portal presents itself change to reflect the new identity and the open-core model (what is open vs the value of the members area and tutorials). Strictly untouched: the technical invariants: zero simulated backend, benchmark integrity, transparent measurements.**

Frontier approved. **Owner's yes to the plan of action, verbatim: "Tem meu SIM para gerar a spec, a direção de arte e iniciar a implementação da v3!"**
