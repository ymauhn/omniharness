# graphify

## What it is

A CLI plus an agent skill that turns a folder of code or docs into a persistent knowledge graph (`graphify-out/`) with community detection and `query` / `path` / `explain` tools.

## When to reach for it

Try first: the text map in `CONTEXT.md` ("Where do I look") and a plain `Grep` of callers. Reach for graphify only for the AGENTS.md row "what breaks if I touch X": a dependency question that spans more files than one grep answers, or when `graphify-out/` already exists in the repo (then treat the question as a graphify query first, as the skill description says). Do not build a graph for a one-file question; the build itself costs tokens when the corpus has docs, papers or images (the host session does the semantic extraction).

## Cost and keys

Free. No API key: code is extracted structurally (AST, no LLM); docs, papers and images are extracted by the running session itself unless `GEMINI_API_KEY` / `GOOGLE_API_KEY` is set, in which case Gemini is used (that path spends Google credits and is opt-in). The skill body states it never reads `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

## Network and the gate

At use time on a local path: no network calls. `/graphify https://github.com/...` clones a repo, and `/graphify add <url>` fetches a page (network; both are `git clone` / an HTTP fetch, not gated by the ask list, so name the URL and confirm first per the AGENTS.md invariant). The skill's Step 1 installs the package if the import fails; that path hits the gated entry `"Bash(pip install:*)"` in `harness/settings.json` and asks. Otherwise: not gated: local and free.

## Install

Verified from `docs/PHASE0_AUDIT.md` section 4 and the project README:

```
pip install graphifyy
graphify install
```

The PyPI name is `graphifyy` (double y; the README says `graphify` is being reclaimed); the CLI is `graphify`. `graphify install` renders the skill into `~/.claude/skills/graphify/` and, on this machine, also rendered the Codex copy in `~/.agents/skills/graphify/` (the audit calls that copy legitimate, not a triage item). `~/.claude/CLAUDE.md` holds the one-line `/graphify` pointer. Reference machine: 0.9.53 installed under Python 3.12 (`pip show graphifyy`); PyPI had 0.9.57 at audit time. `pipx install graphifyy` or `uv tool install graphifyy` are the README's alternatives (UNVERIFIED on this machine; the skill's detector looks in uv, pipx and the active env, in that order).

## Activate in OmniHarness

Routing row: **Codebase map** → "graphify only for 'what breaks if I touch X'; otherwise the text map in CONTEXT.md". The agent runs `/graphify <path>` once, then answers with `/graphify query "<question>"`; `graphify-out/` is gitignored. Before a first build on a repo the agent says: "This builds a graphify graph of `<path>` (local, no key; the semantic pass for docs runs in this session and costs tokens). Proceed?" A remote URL adds the clone or fetch to that sentence.

## Verify it works

```
graphify --version
```

Expected: `graphify 0.9.53` (or the version installed).

## Uninstall

```
pip uninstall graphifyy
```

Then remove `~/.claude/skills/graphify/`, `~/.agents/skills/graphify/` and the pointer line in `~/.claude/CLAUDE.md` by hand (the README documents no uninstall command); delete any `graphify-out/` in repos. Removal is triage: list, do not delete on the owner's behalf.

## License

Apache-2.0 (`pip show graphifyy` License-Expression).

## Source

https://github.com/Graphify-Labs/graphify · PyPI: https://pypi.org/project/graphifyy/

Verified on 2026-09-10
