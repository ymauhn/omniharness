# Spec: portal v2

Synthesised by `to-spec` from the dossier, the grilling round and PLAN.md. No issue tracker is configured for this repository, so the spec lives here instead of as a ticket; the triage label would be `ready-for-agent`.

## Problem statement

A visitor who finds OmniHarness has one static page that explains the harness and links to the repository. They cannot tell what is for members, cannot filter the library by what they need or by their host, cannot see how the framework's skills connect, and have no evidence of what the harness costs and produces beyond a table.

## Solution

One page, two editions from one source. The first viewport leads with the install command and `/omniharness`. A members tab explains that the members' door is the claude.ai edition and shows member-only material only there. The library is one list with Diátaxis and host filters and a visible search. A scroll-driven diagram tells the flow step by step while a canvas graph of the real skills graph highlights each step's subgraph. The proof section is a reproducible leaderboard with caveats. The showcase tab is the record of the demand that built the page, with its numbers.

## User stories

1. As a developer landing on the page, I want the install command and the activation command in the first viewport, so that I can start without reading.
2. As a developer, I want to see in seconds that nothing spends or reaches the network without my yes, so that I trust the harness with my account.
3. As a reader, I want to filter the library by tutorial, how-to, explanation or reference, so that I find the kind of page I need.
4. As a Codex or Hermes user, I want to filter by host, so that I only see what applies to me.
5. As a reader, I want a text search over the library rows, so that I can find a skill by name.
6. As a member, I want the full prompt guides and templates, so that I can run the routines without opening the repository.
7. As a maintainer, I want the member-only bodies absent from the public edition, so that GitHub Pages never serves them.
8. As a maintainer, I want no credential form anywhere, so that the page never collects passwords.
9. As a visitor, I want a diagram that shows the flow (activate, graph, scout, interview, plan, build, review, gauntlet) step by step, so that I understand the routine before installing.
10. As a visitor, I want the skills graph drawn from the repository's own data, so that the diagram cannot lie.
11. As a visitor, I want each flow step to highlight the skills it uses, so that the graph is navigable and not decorative.
12. As a contributor, I want benchmark rows with x/n, cost, date, commit and the reproduce command, so that I can rerun and compare.
13. As a contributor, I want the caveat sentence next to the numbers, so that a sample is not read as a verdict.
14. As a visitor, I want the page's own weight published, so that the portal proves its own claim of lightness.
15. As a community member, I want one door to discussions and issues, so that I do not hunt for a feed.
16. As a prospective user, I want to read how this page was built (scout, graph, interview, installer, design, review) with real numbers, so that I see the ecosystem working.
17. As a visitor on a phone, I want the diagram and the library to work at 390 px, so that the portal is usable on mobile.
18. As a visitor who prefers reduced motion, I want the page to render without animation, so that it is accessible.
19. As a viewer in dark mode, I want a composed dark theme, so that the page sits beside my terminal.
20. As a maintainer, I want one test that fails when a diagram step cites a node the graph does not have, so that the diagram and the repository cannot drift.

## Implementation decisions

- One source (`site/index.html`), one derivation script (`scripts/site_build.py`) that writes the artifact fragment and the public edition; member-only blocks are `<template data-members>` elements the public build removes.
- Membership is the artifact's share list; the page detects the claude.ai runtime through `window.claude.use` and shows the member blocks only there. No `user` capability is available on this account, so the page never names the viewer.
- The skills graph is rendered by force-graph (UMD, cdnjs, pinned) from `docs/skills-graph/graph.json` embedded at build time; edges coloured by type; the installed ring plus the linked catalog nodes only.
- Scrollytelling by IntersectionObserver with a sticky panel; steps are plain sections; no `vh` heights; no dependence on progress callbacks.
- Library rows carry `data-kind` (tutorial, how-to, explanation, reference) and `data-host`; filters are buttons; search is an input filtering by text; all client-side.
- Proof rows are generated from `docs/benchmarks.md` numbers by hand for now, with the JSONL records in `evals/results/` as the source of truth on the reference machine.
- Showcase frames are authored HTML from `site/showcase/*` files.
- Visual world: the QRH card stays (`site/DESIGN.md`); v2 extends it, it does not replace it.

## Seams

One seam, the derivation script: `python scripts/site_build.py` reads `site/index.html`, `docs/skills-graph/graph.json` and `site/showcase/`, writes `site/public/index.html` (no member bodies) and the artifact fragment in the scratchpad. `tests/test_site.js` reads the source and the graph and checks the diagram steps. No other seam.

## Out of scope

Self-serve signup, comments, search across the repository's markdown, a docs site generator, analytics, a real backend.
