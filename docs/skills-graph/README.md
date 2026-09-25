# skills-graph

A graph of every skill the hosts can reach, in three rings, with typed edges. The skill is `.agents/skills/skills-graph/`; the generated files in this directory (`graph.json`, `graph.md`) are the reference machine's snapshot, rebuilt with one command and dated in their first line.

The source-bound [skill catalog checkpoint](SKILL-CATALOG.md) adds canonical variants, hash-pinned curated metadata and PT/EN retrieval for the future Copilot. It keeps relevance, discovered availability and execution authority separate. The historical graph snapshot remains distinct from a current machine scan.

## What it does

`skills_graph.py build` scans every SKILL.md the hosts read (the checkout's `.agents/skills`, `~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.hermes/skills`, and the plugins listed in `~/.claude/plugins/installed_plugins.json`), takes `name` and `description` from the frontmatter, and parses `calls` edges from the bodies: a skill name quoted after the words "Skill tool", or a `/name` mention, that resolves to another scanned skill. That is the **installed** ring. The **catalog** ring is read from files already on disk: the official marketplace manifest (`~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`, 291 plugins on the reference machine) and the tables in `docs/catalog/`. The **remote** ring is `remote.json`, a dated snapshot of the awesome lists named in `skills-graph.toml`, written only after the owner approved the fetch.

On top of the scan, `skills-graph.toml` adds curated nodes (skills that are not installed but matter, such as the design stack) and curated edges. Edge types:

| Type | Meaning | Source |
|---|---|---|
| `calls` | A's body tells the agent to invoke B | parsed, never hand-written |
| `precedes` | A runs before B in a routine | curated |
| `feeds` | A's artifact is B's input | curated |
| `alternative-to` | same job, different cost or host | curated (graphify similarity seeds) |
| `guided-by` | B's output must conform to A's rules | curated |
| `candidate-for` | a catalog or remote node that could fill a step no installed skill covers | proposed by scout |

An edge whose endpoint is not reachable on this machine puts that endpoint in a fourth ring, **missing**, so the gap is visible instead of silently dropped.

Learned edges are never written to the TOML by an agent. `propose` appends a line to `proposals.jsonl` (edge, evidence, date, status `proposed`); the owner runs `approve N`, which appends the edge to the TOML with the date and the proposal number, or `reject N`. The lesson behind this is in `docs/experiments/2026-09-10-graphify-skills-corpus.md` and in the Phase 0 audit's AutoSkill note: an artifact that edits itself drifts.

## When to reach for it

- "Which skill do I use for X?": `route "<your words>"` ranks by keyword overlap, then comparable measured cost, then installed status/id. Zero model calls.
- Before `scout` writes a routine: the routine's steps map to installed nodes; a step with no installed node becomes a `candidate-for` proposal.
- Auditing overlap: `neighbors <id>` shows what calls a skill and what it is an alternative to.
- After adding a skill or plugin: `build`, commit the regenerated `graph.md` if the snapshot is meant to be public.

Not for: the target project's code map (that is graphify or CONTEXT.md), natural-language questions about the graph (that is the agent reading `graph.json`).

## Common questions

**Why TOML and not YAML?** `tomllib` is in the Python standard library from 3.11; a YAML parser would be a `pip install`, which is gated. The design page said YAML; the data is the same.

**Why is the catalog ring not drawn in full?** 396 nodes make an unreadable diagram. The mermaid shows every installed node and only the catalog or remote nodes an edge touches; the counts are in the subgraph title and in `graph.json`.

**Why does `route` rank a catalog plugin above an installed skill?** Keyword score and comparable measured cost precede the ring. A catalog row is still a candidate, not an installed tool; intake remains required.

**How does graphify relate?** graphify over the skills corpus (350,910 subagent tokens for 43 files) rediscovered the file boundaries and found the same `calls` edges the regex finds for free, plus four similarity edges that are now the `alternative-to` seeds in the TOML. It stays an optional discovery pass whose output becomes proposals.

## It's working if

- `python .agents/skills/skills-graph/scripts/skills_graph.py check` exits 0 and prints the node and edge counts.
- `python -m unittest tests.test_skills_graph` passes (synthetic home and root, then the real checkout).
- `route "grill me before the spec"` lists `grilling` and `to-spec` from the installed ring on a machine with the mattpocock plugin.
- `graph.md` renders on GitHub as a mermaid diagram with one subgraph per ring.

## T13: requirements, measured costs and plan status

A curated node can carry `needs = {files = ["config.json"], env = ["API_KEY"], skills = ["tdd"], binaries = ["node"]}`. Files are resolved inside `--root`; environment checks reveal presence only. A node can carry `cost = {usd = 0.03, benchmark = "record-id", date = "2026-09-21"}` or measured `tokens`, or both. This is a schema example, not a measurement. Missing units, invalid numbers, missing provenance and future dates are unknown. Route orders keyword score first, then known comparable cost in `--unit usd|tokens`, then installed status/id. It never converts tokens to USD.

`alternatives <node> --unit usd` lists installed neighbours linked by approved/curated `alternative-to` edges, with satisfied needs, cheapest known cost first. Proposed edges cannot authorize a fallback. All commands are read-only recommendations; graph metadata is not an authorization or usage certificate.

New Scout plans include exactly one machine-readable block beside the human routine:

```omniharness-plan
{"steps":[{"id":"1","skill":"skills-graph","status":"done","needs":{}},{"id":"2","skill":"scout","status":"failed","needs":{"files":["CONTEXT.md"]},"attempted":[]},{"id":"3","skill":"tdd","status":"pending","needs":{},"stop":"owner review"}]}
```

`skills_graph.py --root <project> plan-status PLAN.md --mode balanced --unit usd --remaining 2` reports the first unfinished step. Required inputs block; `stop` asks; failed steps propose one untried eligible alternative. Balanced requires measured USD=0, tokens=0 and explicit `network=false`. Strict always asks. Swarm requires known cost in the selected unit within the supplied remainder. The envelope must separately validate all budgets, scope and network before execution. The CLI never edits or executes a plan; a recommendation is not a permission. No automatic retry loop or A* search is introduced.
