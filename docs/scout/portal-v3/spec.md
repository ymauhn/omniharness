# Spec: portal v3

Synthesised by `to-spec` from the plan gate answers (`grilling.md`) and PLAN.md. No issue tracker is configured; the spec lives here (label would be `ready-for-agent`).

## Problem statement

The v2 portal proves the mechanism and the measurements but reads as an internal tool: the visual identity is a checklist card, the graph is a static drawing, the members area is a paragraph, and nothing says what is open and what the members' vault holds. A visitor who compares it with Linear, Vercel or Raycast does not see a product.

## Solution

A redesigned single page, one source in two editions, whose identity comes from impeccable's direction round, whose skills graph is alive (physics, zoom, drag, drawer) and drives the story as the visitor scrolls, whose sections present the open core and the members' vault honestly, and whose showcase shows v1 → v2 → v3 with captures and numbers as proof.

## User stories

1. As a visitor from Linear's or Raycast's world, I want the first viewport to look like a product I would pay for, so that I keep reading.
2. As a developer, I want the install command and the activation command within reach in the first viewport, so that I can start.
3. As a visitor, I want to see the skills graph move, settle into its rings and respond to my mouse, so that I believe it is real data.
4. As a visitor, I want to click a node and read what the skill does, which hosts run it and what it connects to, so that the graph is navigable.
5. As a visitor on a phone, I want the same drawer as a bottom sheet and pinch-zoom on the graph, so that mobile is not a downgrade.
6. As a visitor, I want the scroll steps to move the camera to the skills of each step, so that the story and the graph are one thing.
7. As a prospective member, I want to see what is open (MIT) and what the vault holds (tested prompts, workflows, Gauntlet audit batteries, specialised designs, end-to-end tutorials, a consulting agent on the roadmap), so that I understand the open-core model.
8. As a company, I want to see that consulting and enterprise setup exist, so that I know whom to ask.
9. As a reader, I want the library with its filters and search preserved, so that nothing I used in v2 is lost.
10. As a sceptic, I want the proof table with x/n, cost, commit and reproduce commands preserved, so that the redesign did not soften the numbers.
11. As a visitor, I want to see v1, v2 and v3 side by side with their measurements, so that the ecosystem's self-improvement is evidence, not a claim.
12. As a visitor, I want a before/after slider on the hero (v2 vs v3), so that the change is visible in one gesture.
13. As a maintainer, I want the page to stay one source with two editions, member bodies stripped from the public one, so that nothing changes in governance.
14. As a maintainer, I want the visual test to fail on overflow, contrast, missing graph pixels, a slow tooltip or a console error, so that regressions are caught at zero tokens.
15. As a maintainer, I want the design system documented by impeccable's documenter from the shipped page, so that DESIGN.md describes reality.
16. As a viewer with reduced motion, I want physics and reveals to settle instantly, so that the page is accessible.
17. As a viewer in dark mode, I want a composed dark theme, so that the page sits beside my terminal.
18. As a maintainer, I want the public edition under 350 KB without force-graph, so that the portal proves its own lightness.
19. As the owner, I want every subagent the pipeline spawns counted against the 1.5M ceiling, so that the redesign cannot run away.
20. As the owner, I want the finish reviewer's disposition reported at its real scope, so that "ship" means ship.

## Implementation decisions

- Identity: chosen in impeccable's direction round (code-led; no image generation on this machine), recorded as the direction contract in `site/surface-brief.md`; the v2 QRH world is evidence and anti-reference.
- Graph: force-graph 1.51.4 UMD from jsDelivr, `graphData` from the embedded `graph.json` payload; `d3Force('radial')` per ring; `cooldownTime` ≈ 3000 ms, `d3ReheatSimulation` on drag; `nodeCanvasObject` for ring-coloured nodes and zoom-dependent labels; `onNodeHover` tooltip, `onNodeClick` drawer; `zoomToFit` on the step's node set with a padding; `enableZoomInteraction` and pan on.
- Stage: IntersectionObserver over `.step[data-nodes]`, the graph panel sticky; progress as a CSS custom property for the reveal; fallback to scrollama only on a failed WebKit capture.
- Open-core sections: Open core (what is MIT), Members' vault (what it holds, with the honest access door), Services (consulting and enterprise), each with the product's own words from PRODUCT.md; no prices unless the owner supplies them.
- Evolution: `site/showcase/v3/shots` full-size captures in the repository; `scripts/site_build.py` downscales to 720 px wide (ffmpeg or Playwright), embeds data URIs only in the members edition; the strip, the slider and the metrics table read `site/showcase/v3/*-report.json`.
- Visual TDD: `tests/visual/shoot.py` adds the three state captures and a WebKit run; `tests/test_visual.py` asserts the Q6 set.
- Everything else (members mechanism, proof format, library taxonomy, tests, benchmarks) unchanged.

## Seams

Two: `scripts/site_build.py` (editions, rasters, metrics) and `tests/visual/shoot.py` (captures and measurements). The page itself is one file.

## Out of scope

Prices, self-serve signup, a consulting agent, analytics, a backend, GitHub Pages activation (an owner setting).
