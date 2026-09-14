# RuFlo (ruvnet/ruflo) against OmniHarness: reading and verdict (2026-09-14)

Read on 2026-09-14 with WebFetch (no cost): the README, `docs/ruflo-explained.md`, `docs/USERGUIDE.md` (raw), `docs/metaharness-user-guide.md`, the `docs/` listing. Facts below are quoted or paraphrased from those pages; anything not found there is marked as such. This file is the evidence behind ticket T13 (`docs/commercial/TICKETS.md`).

## Facts read

| Aspect | RuFlo (formerly Claude Flow) |
|---|---|
| Identity | MIT, TypeScript, 72.4k stars; v3.8.0 on the README, v3.7 in the user guide |
| Install | `npx ruflo@latest init wizard` or `curl ... install.sh \| bash`; `claude mcp add claude-flow -- npx ruflo@latest mcp start`; `init --codex` writes `AGENTS.md` and `.agents/skills/` |
| Surface | about 210 MCP tools (`memory_store`, `swarm_init`, `agent_spawn`, `federation_send`, ...) |
| Hooks | 27 named: session-start/end, pre/post-task, task-error, pre/post-edit, pre/post-command, hooks_route/explain, hooks_model-outcome/model-route, teammate-idle, task-completed, worker triggers (ultralearn, optimize, audit, consolidate) |
| Background workers | 12 auto-triggered (audit, optimize, testgaps, consolidate, map, deepdive, document, refactor, benchmark, ...); the user guide states they dispatch automatically, e.g. audit "runs without user confirmation" |
| Routing | Thompson-sampling model router with Beta priors per tier (Haiku, Sonnet, Opus); "89% accuracy" after about 50 outcomes; method: hooks track outcomes; no external benchmark cited |
| Swarms | 6 topologies (hierarchical default, mesh, ring, star, hybrid, adaptive); agents through Claude Code's Task tool in background or local processes; AgentDB + SQLite + HNSW memory; queen coordinator with Raft, Byzantine or Gossip consensus |
| Collision avoidance | a claims board: one owner per resource, the first valid claim wins, only the owner releases or hands off (from `ruflo-explained.md`) |
| GOAP | described on the product page goal.ruv.io only: state-space search over actions with preconditions and effects, A* re-run from the current state when an action fails, action trees with rollbacks; not in the repository docs read |
| Permissions | `--dangerously-skip-permissions` in the setup path; input validation, path-traversal blocklist, command allowlisting; `ruflo-explained.md` recommends human checkpoints but no approval mechanism was found |
| Footprint | Node 20+; about 45 MB minimal, 340 MB full (ML, embeddings, ONNX); cold start about 35 s full, 1.5 s with `cli-core`; WASM "Agent Booster" |
| Cost claims | "75% lower costs", "extend the subscription by 250%", "30–50% token reduction"; no method in the pages read. The one number with a method and a file: vector search 1.9x–4.7x faster than brute force (`docs/reviews/intelligence-system-audit-2026-05-29.md`, `scripts/benchmark-intelligence.mjs`) |
| Hosts | Claude Code, Codex (`@claude-flow/codex`), others through the MCP server |

## Comparison on the four questions

1. **Swarms against our drivers.** RuFlo shares state through a vector memory and avoids collisions with claims. Our `gauntlet-driver` and `scout-driver` share nothing: every agent receives `args` only and returns structured output; the deterministic script integrates (dedupe by URL, refuter lenses, token ceiling, `parouPor`). There is no shared state to collide. Worth absorbing: a cross-run "seen" store for the scout (the Gauntlet's seeded rerun, B2b, already measures the pattern at a quarter of the cost), and worktree isolation when implementers run in parallel (the Workflow tool has it), instead of a claims database.
2. **GOAP against scout → grilling → to-spec.** GOAP needs a world model with declared effects and replans alone; the harness keeps the plan gate human by the owner's rule. Three heuristics fit without an A* engine: `needs:` on every routine step so `scout status` names the first blocked step at zero tokens (the installer already computes done/todo/key/owner-only); `cost:` per skill in the graph from the benchmarks so `route` ranks by measured cost and not only by keyword overlap; `detour` as the bounded replan with the owner, in place of automatic A*. Explicit `alternative-to` edges are the graph's replanning material.
3. **Hooks and automatic routing.** Workers that spend tokens without asking contradict invariant 2. The deterministic hook is the pattern to keep: the impeccable detector already runs as `PostToolUse`. A settings fragment can add `SessionStart` (install check, regress) and `PostToolUse` on `.agents/skills/**` (layout test, graph check), all local and free; any hook that would call the model goes through the ask list. A model-tier router would first need the tier recorded on every eval result.
4. **Verdict.** Not installed as an MCP server: 210 tools on every turn are permanent context cost; 12 workers spend without a gate; `--dangerously-skip-permissions` in setup; 45–340 MB with native modules and a 35 s cold start; cost claims without method. Catalogued (Execution row, `remote.json` entry) and mined for patterns: claims → scope map for parallel editors; ReasoningBank → cross-run seen store; hooks_explain → `envelope explain`; preconditions and costs → `needs:` and `cost:`. Proposals queued: `ruvnet/ruflo -alternative-to-> gauntlet-loop` and `-alternative-to-> scout`.

## What the owner took from it (2026-09-14)

The pain RuFlo answers is real: a model working alone is slow and a developer approving every micro-step tires. The answer in this harness is not a permanent brake but a session envelope the operator signs once (mode, budget, scope, allowed hosts), inside which the agent runs continuously, with hard stops kept for deletion, credentials, pushes and anything outside the envelope. That is ticket T13.
