# scout

Demand in, plan out. The skill is `.agents/skills/scout/` (portable); the parallel research is `scout/scout.workflow.js`, a Claude-only Workflow driver installed as `~/.claude/workflows/scout-driver.js` by `scripts/install.py`. Codex and Hermes run the same sources one after the other.

## What it does

1. **Frame** at zero tokens: restate the demand, run `skills_graph.py route "<demand>"` to know which steps already have an installed skill.
2. **Gate**: print the fan-out (sources, agents, cap per source, token ceiling, the measured cost below) and wait for the owner's yes. Never twice on the same demand without a new yes.
3. **Research**: one agent per source (GitHub, Hacker News, Reddit, X, Product Hunt; never LinkedIn), WebSearch and WebFetch only, at most `porFonte` references each, every reference with a URL the search returned or the agent opened. Code dedupes by normalised URL, caps per source, counts failed and degraded sources, and stops before synthesis when the ceiling is near (`parouPor: teto`, references returned raw).
4. **Synthesis**: one agent groups the references into 3 to 7 patterns, lists the gaps and writes recommendations; URLs outside the received list are dropped in code.
5. **Dossier** written to `<repo>/docs/scout/<slug>/dossier.md` as the driver rendered it.
6. **The plan gate**: the interview through `grilling` (or five fixed questions when it is not installed), with `detour` once when the dossier shows more than one viable route; then the agent stops. This is a hard human-in-the-loop gate: the owner answers and says yes to the plan of action, or the work ends at the questions. No answer is ever assumed on the owner's behalf; the v2 round of 2026-09-11 (`docs/scout/portal-v2/grilling.md`) proceeded on recommendations with the owner absent, and that is the breach this rule closes.
7. **PLAN.md**, only after the yes: goal, success criterion, where we are, the routine (each step names its installed skill and its artifact; gated steps carry `STOP: confirm`), gaps as `candidate-for` proposals to the skills graph, detours considered, sources.
8. **Way-finding**: `/scout status` prints the next step; a routine that reached its criterion proposes the `precedes` edges that made it work.

## When to reach for it

- A demand that is bigger than one prompt and smaller than a multi-session effort (that is `wayfinder`).
- Before building anything whose category has a well-known default you do not want to fall into.
- When you need a written plan another session can pick up (`Where we are`).

Not for: a decision with a known answer (just decide), research without a demand (`research`), a spec from a conversation that already happened (`to-spec`).

## It costs

Measured on the reference machine; the numbers are the ones the gate quotes. See `docs/benchmarks.md`, B4, for the record.

| Run | Sources | Agents | Wall clock | Output tokens | References | Patterns | Notes |
|---|---|---|---|---|---|---|---|
| portal-v2 (2026-09-11) | github, hn, reddit, x, producthunt | 6 (5 + synthesis), 0 errors | 205.7 s | 80,767 output delta; 443,262 subagent total; 107 tool uses | 26 unique (4 duplicates removed): github 6, hn 2, reddit 6, x 6, producthunt 6 | 6, plus 8 gaps and 10 recommendations | reddit blocked (WebSearch refused the domain, WebFetch failed), X and Product Hunt degraded by design; `parouPor: sintetizado` |

Zero-token part: `node tests/test_scout_driver.js` runs the driver body against a scripted agent through five scenarios (dedupe and cap, a dead source, the ceiling before synthesis, no references, argument validation) in under a second.

## Common questions

**Why a named workflow and not an inline script?** The owner's decision: the driver is inspectable on its own, the skill stays small, and `resumeFromRunId` works. The inline fallback exists for a registry that has not seen the file yet (`Read` the driver and pass it as `script`).

**Why do X and Product Hunt always come back degraded?** Neither has a public search without a key or a login, and the harness holds neither. Their agents use WebSearch with `site:` and say so in `motivo`; the dossier carries the flag so the references are weighed accordingly. Product Hunt with a key is a one-line change in `references/sources.md`.

**Where does the plan go?** `<repo>/docs/scout/<slug>/PLAN.md`, next to the dossier, in the project the demand is about. Nothing is written into the OmniHarness checkout unless that is the project.

**How does it learn?** It does not edit anything by itself. Gaps and the edges that worked become proposals in `skills-graph`'s queue; the owner approves them.

## It's working if

- `node tests/test_scout_driver.js` prints five PASS lines.
- `python scripts/install.py --check` shows `OK driver ~/.claude/workflows/scout-driver.js`.
- `/scout <demand>` stops at the gate with the sources and the cost, and does nothing until the yes.
- After a run, `docs/scout/<slug>/dossier.md` and `PLAN.md` exist and `skills_graph.py check` lists the new proposals.
