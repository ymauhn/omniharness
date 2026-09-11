# PLAN: portal v3 (launch version, redesigned)

Written after the plan gate of 2026-09-11 (`grilling.md`, every answer the owner's). Dossier: `../portal-v2/dossier.md`, reused. The owner's yes: "Tem meu SIM para gerar a spec, a direção de arte e iniciar a implementação da v3!"

## Goal

Turn the community portal into a launch-quality product page with a new visual identity (redesign through impeccable's direction round), an interactive force-graph of the skills graph, scroll-driven storytelling over it, an open-core presentation (what is open, what members get), and the evolution v1 → v2 → v3 shown as empirical proof, all driven by visual TDD with Playwright.

## Success criterion (the owner's bar, Q1)

1. `impeccable-finish-reviewer` returns `ship`.
2. `tests/test_visual.py` green at 1440 and 390, light and dark, plus the three state captures (graph hover with tooltip, active filter, pressed copy).
3. `ponytail-review` ends at `net: 0`.
4. Public edition under 350 KB excluding force-graph; one external library.
5. Calibration: Linear, Vercel changelog, Raycast.
6. Ceiling: 1.5M subagent tokens; at most two finish-reviewer rounds; no paid evals; `explain-usage` at the end.

## Where we are

Step 7 done: two finish-reviewer rounds, 6 of 7 material fixes resolved, the self-hosted-fonts item left to the owner (weight bar vs the floor); DESIGN.md v3 and .impeccable/design.json written by the documenter; subagents 663,789 tokens of the 1.5M ceiling. Publish and the owner's word on the fonts and the commit remain.

## Routine

1. **Plan gate** — `grilling` after the reused `scout` dossier; owner answered Q0–Q9. Done.
2. **Spec** — `to-spec` → `spec.md`. Done.
3. **Design pipeline (impeccable, for real)** — `context` (done) → `init` (PRODUCT.md from Q7) → `document` (the v2 DESIGN.md stands as the incumbent record; the documenter rewrites it at finish) → `shape`/new-work direction round (`concept-seed`, code-led: no image generation on this machine) → direction contract in `site/surface-brief.md` → build → `typeset`, `layout`, `colorize`, `animate`, `polish` passes with `detect --json` → `critique`, `audit` → `impeccable-finish-reviewer` (≤ 2 rounds) → `impeccable-documenter` → DESIGN.md. STOP: confirm is already given for the subagents (SUBAGENT_AUTHORIZATION directive).
4. **Build** — under the ponytail ruleset: force-graph 1.51.4 (jsDelivr, pinned) with radial forces per ring, cooling physics, tooltip, drawer (side/bottom sheet), zoomToFit per scroll step; IntersectionObserver stage (scrollama only if the WebKit run jumps); open-core sections; evolution strip, before/after slider, metrics table; `scripts/site_build.py` grows the downscaled-raster embedding for the members edition.
5. **Visual TDD** — `tests/visual/shoot.py` gains the state captures and the WebKit check; red rounds recorded in `site/showcase/v3/`; loop until green.
6. **Review** — `ponytail-review` on the file; `detect --json`; the finish reviewer's disposition; fixes in at most two batches.
7. **Measure and publish** — page weight, tests, tokens (explain-usage), wall clock; showcase v3 record; public edition rebuilt; artifact republished. STOP: confirm before `git commit`.

## Gaps

None new: force-graph is a library, not a skill; scroll-craft stays a candidate (proposal 1).

## Detours considered

None yet; allowed on a punctual aesthetic dilemma (Q5).

## Sources

`../portal-v2/dossier.md`; the owner's answers in `grilling.md`.
