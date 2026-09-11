# Surface brief: community portal (`site/index.html`)

Scope: one public page, the entry point of the OmniHarness community and the members' door, with the library (manuals, tutorials, prompt guides, case studies), the interactive flow diagram over the skills graph, the proof section and the living showcase. Visitor mode: **Persuade** for the first viewport, **Read** for the library and the showcase, **Operate** for the filters and the diagram. Audience: developers who run Claude Code, Codex or Hermes and pay for tokens; scene: a terminal open next to the browser, most sessions in the evening. Success criterion: `docs/scout/portal-v2/PLAN.md`. Must stay untouched: every number and claim comes from the repository (`docs/benchmarks.md`, `site/showcase/`, `docs/scout/portal-v2/`); no invented users, quotes, prices or capabilities; no credential form anywhere. What would make a polished result wrong: a generic dark "AI dev tool" page with neon edges; a cream editorial page with a serif; a diagram that decorates instead of navigating; a login form that pretends.

## Pipeline record

- v1 (2026-09-10): one-shot test of the design stack; impeccable's references read from GitHub and applied by hand; Magic MCP unavailable without a key; ponytail-review applied.
- v2 (2026-09-11): the demand went through `scout` (dossier, 26 references), `skills-graph route`, `grilling` in owner-absent mode, one `detour` on the members area, `to-spec`, `skill-installer` (impeccable install denied by the auto-mode classifier; Magic MCP waits on `API_KEY_21ST`), then this build under the ponytail ruleset with `ponytail-review`, and the measurements in `site/showcase/`.

## Direction contract (v2: extend the established world, no redesign)

THESIS: the Quick Reference Handbook card stays and grows tabs. The page refuses the docs-site template (sidebar tree plus search box plus hero) and the feed; it is one card with an index rail, and the first viewport now leads with code: the install command and `/omniharness` are checklist rows one and two.

OWN-WORLD: unchanged from v1 (`DESIGN.md`): cool paper or night panel, deep blue-black ink, signal amber owning the rail, the STOP rows, the active filter chips and the highlighted subgraph; green and red only for real states. Archivo condensed for checklist and display, Public Sans for reading, Red Hat Mono for commands, measurements and transcript frames. New elements inherit: filter chips are 1px ink rules that fill amber when active; the diagram panel is a card; showcase frames are transcript boxes with a timestamp rule.

STORY: the visitor copies the install command, reads the checklist, scrolls the flow and watches the graph light up step by step, filters the library to their host and need, learns that the members' door is the claude.ai edition, reads the proof with its caveats, and reads how this very page was built with its numbers.

FIRST VIEWPORT: wordmark and three links top left; the offer in two sentences at display size on the left half; the checklist card on the right half, seven rows, rows one and two with copy buttons, the last row amber. Below the fold: the flow (steps on the left, sticky graph on the right), the library with its filter bar, members, proof, showcase, contribute.

FORM: QRH checklist card with an index rail; first on the ordered list of seven from v1. Signature interaction: the scroll step that lights the subgraph. Motion grammar: one authored moment on load (the checklist ticks), exponential ease-out on highlight changes, nothing else.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. (No rasters ship.)
