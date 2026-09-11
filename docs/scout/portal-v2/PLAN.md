# PLAN: portal v2 (community portal, launch version)

Written by `scout` on 2026-09-11 from the dossier (`dossier.md`), the grilling round (`grilling.md`) and one detour. The owner's brief: a login/members area, a navigable library of prompts and guides, an interactive scroll-driven diagram of the flow and the skills graph, and the process that built this page recorded as the living case study with real metrics.

## Goal

Turn `site/index.html` into the launch version of the community portal: the public entry point of the OmniHarness community and the members' door, with the library, the interactive diagram and the living case study, at portfolio quality, with every number measured.

## Success criterion

1. Loads with no console errors at 1440 and 390 px wide; one source file, no build step; libraries only from cdnjs, pinned.
2. The scroll-driven diagram highlights one subgraph per step, from the same `graph.json` the repository generates; `node tests/test_site.js` proves every node a step cites exists in the JSON.
3. The library filters by Diátaxis label and by host, with a visible text search.
4. The members area has no credential form; the public edition omits member-only bodies at derivation time; the artifact edition unlocks them through claude.ai.
5. Every benchmark row carries x/n, cost, date, commit, the reproduce command and the caveat; the page's own weight is one row.
6. The showcase tab shows the six steps of this very plan with their measured numbers.
7. `ponytail-review` on the file ends at `net: 0` after the cuts; `python -m unittest discover tests` and the node tests stay green.

## Where we are

Step 6 (build) in progress; steps 1 to 5 done, step 5 partially (impeccable install denied by the classifier, Magic MCP waits on a key).

## Routine

1. **Research** — skill `scout` (driver `scout-driver`). Artifact: `dossier.md`. STOP: confirm before the fan-out (given by the owner for this run). Done: 6 agents, 443,262 subagent tokens, 206 s.
2. **Tools for the task** — skill `skills-graph` (`route`). Artifact: `site/showcase/02-route.txt`. Zero tokens. Done.
3. **Alignment** — skill `grilling` (owner-absent mode) and one `detour` on the members area. Artifacts: `grilling.md`, the block below. Done.
4. **Spec** — skill `to-spec`, written to `spec.md` because no issue tracker is configured for this repository (`/setup-matt-pocock-skills` never ran). Done.
5. **Environment** — skill `skill-installer`: `plan impeccable`, `plan magic-mcp`, `env`. `apply impeccable --yes` was denied by the Claude Code auto-mode classifier; the two commands are the owner's. `magic-mcp` waits on `API_KEY_21ST`. Fallback per the plan: impeccable's references applied by hand (`craft-floor`, `new-work`, `typeset`, `colorize`, `layout`, `polish`), local catalog guided by `site/DESIGN.md`. Partial.
6. **Design and build** — impeccable's direction contract in `site/surface-brief.md` (v2), implementation under the ponytail ruleset, `ponytail-review` on the file, one batched inspection round (desktop and mobile), `impeccable critique`/`audit`/`polish` checklists by hand. Artifacts: `site/index.html`, `site/DESIGN.md`, `scripts/site_build.py`, `tests/test_site.js`. In progress.
7. **Measure** — `tests/` (zero tokens), page weight, `evals/run.py run detour-bounded` both arms (STOP: confirm; paid), the scout run recorded as B4. Artifacts: `docs/benchmarks.md` B4 and B5, `site/showcase/06-metrics.json`.
8. **Publish** — artifact edition republished at the same URL, `site/` in the repository, showcase tab filled from `site/showcase/`. STOP: confirm before `git commit`.

## Gaps

- Scroll-driven page grammar: no installed skill. Candidate found by scout: `nateherkai/scroll-craft` (remote ring, proposal 1). This build hand-rolls the ~40 lines instead.
- Design language: `impeccable` (catalog, proposal 2), install denied this session; fallback applied.
- Component supply: `magic-mcp` (catalog, proposal 3), waits on a key; fallback: local catalog.

## Detours considered

2026-09-11, decision Q1 (members area on a static site with zero backend). Main path: the artifact edition as the members' door. Bar: real identity, restricted manuals unreadable without it, zero backend.

- **Detour 1, the library card (physical world).** Reframe: membership is a token you carry, a share link whose key lives in the URL fragment (staticrypt `--share`). Changes: adds an encrypt step to `site_build.py` and a members page on GitHub Pages. Viability test: encrypt one page, open the share link in a private window, then the bare URL; the bare URL must show only the prompt. Cost: zero backend; identity is possession, not a person; brute force is possible because the file is public; one more dependency at build time.
- **Detour 2, the reading room (screen tradition).** Reframe: the members' material lives only where the platform already knows who is reading, the claude.ai artifact, and the public site is the catalogue pointing at the room. Changes: none to the routine; `site_build.py` strips member bodies from the public edition. Viability test: publish privately, share with one account, confirm an unshared account cannot open it. Cost: zero backend; members must have a claude.ai account; the owner shares by hand (no self-serve signup).
- **Detour 3, the GitHub handshake (ritual).** Reframe: a member is anyone the owner invites to a private GitHub repository or Discussions category; the portal links there. Changes: content leaves the page; the portal's members tab becomes a link. Viability test: create a private repository, invite one account, confirm the second account cannot read. Cost: zero backend; identity is GitHub's; the restricted manuals are no longer part of the portal.

Verdict: Detour 2 stands as the main path (fit: real identity and unreadable-without-it hold; cost: lowest). Detour 1 is competitive for a future public-site members page. Detour 3 is declined for the members area and kept as the community door (Discussions).

## Sources

`dossier.md` (26 references from github, hn, reddit (degraded: blocked), x (degraded by design), producthunt (degraded by design); 6 patterns, 8 gaps, 10 recommendations).
