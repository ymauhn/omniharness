# Surface brief: community portal (`site/index.html`)

Scope: one public page, the entry point of the OmniHarness community and its library (manuals, tutorials, prompt guides, case studies). Visitor mode: **Persuade** for the first viewport (a developer decides to install and read), **Read** for the library below it. Audience: developers who run Claude Code, Codex or Hermes and pay for tokens; scene: a terminal open next to the browser, most sessions in the evening. Success: within seconds the visitor knows what the harness is, that nothing spends or reaches the network without a yes, and where the manuals are. Must stay untouched: every number and claim comes from `README.md`, `docs/benchmarks.md`, `recipes/README.md`, `docs/catalog/` and `docs/experiments/`; no invented users, quotes, prices or capabilities. What would make a polished result wrong: a generic dark "AI dev tool" landing page with neon edges, or a cream editorial page with a serif; both are the category's ruts.

## Pipeline record (design stack, one-shot test of 2026-09-10)

- `impeccable`: not installed on the reference machine (the launcher downloads a binary on first run, which is gated). Its SKILL.md and the references craft-floor, new-work, typeset, colorize, layout and polish were read from the repository and applied by hand. No `concept-seed` roll ran, so the direction below was chosen unattended and is stated here as the assumption new-work.md prescribes for that case.
- `magic-mcp` (21st): not configured (`~/.claude.json` has no `mcpServers`; the key is a credential the owner creates). Components were composed by hand against the design language below, which is the input magic-mcp would have been `guided-by`.
- ponytail: implementation under the ponytail ruleset; `ponytail-review` run on the finished file, findings applied.

## Direction contract

THESIS: the page is a Quick Reference Handbook card. The harness is a set of gates and checklists (invariant 2, the `STOP: confirm` lines in every recipe, the five-line `/omniharness` report), so the first viewport shows the session-start checklist itself, challenge on the left, response on the right, ticked as the page loads. It refuses the hero-plus-three-feature-cards arrangement and the terminal-screenshot hero.

OWN-WORLD: cool paper (`#F2F4F6`) or night panel (`#0F161D`), deep blue-black ink, one committed colour, signal amber, that owns the tab rail and every `STOP` line; green and red appear only as real states (a passed check, a failed control arm). Archivo at width 75 to 80 for the checklist and display voice, uppercase with a touch of tracking; Public Sans for reading; Red Hat Mono only for commands, paths and measurements. Leader dots between challenge and response. Rules of 1px, no cards inside cards, no eyebrows, no gradient text, icons as authored SVG in one stroke.

STORY: the visitor sees the checklist, understands that a session begins with rules, a verified install and a gate; tries the gate in the simulation and sees a recursive delete become a triage line; then reads the library and installs.

FIRST VIEWPORT: wordmark and two links top left; the offer in two sentences at display size on the left half with the primary action "Install in five commands" and the secondary "Browse the manuals"; the checklist card on the right half, five rows, the fifth row amber. Below the fold: the gate simulation, then the library index in four sections reached from the tab rail.

FORM: QRH checklist card; first on the ordered list of seven (QRH card, interlocking signal panel, belay partner check, bench protocol, breaker panel, review form, safety pictogram card). Seed key: none, no roll ran.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. (No rasters ship: the page has no images.)
