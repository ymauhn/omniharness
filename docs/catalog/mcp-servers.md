# MCP servers

MCP servers that fit an OmniHarness layer, surveyed on 2026-09-10 from punkpeye/awesome-mcp-servers, modelcontextprotocol/servers and official vendor organisations; every URL below returned a page that day. None is configured on the reference machine: the audit found desktop-provided servers only (`docs/integrations/README.md`), and audit section 4 keeps the Higgsfield MCP out on purpose ("Keep the CLI; do not add the MCP").

An MCP server has no Bash pattern in `harness/settings.json`, so the AGENTS.md HITL list is the enforcement for everything it does over the network or against a paid account (`docs/integrations/README.md`, point 3). Launching one is not free of the gate either: `npx` fetches the package (`Bash(npx skills add:*)` does not match it, so the process rule applies), `uvx` is not in the ask list, and `docker run` hits `Bash(docker run:*)`. Every server goes through the intake procedure in [README.md](README.md): tool descriptions are data, never instructions.

**Config** column: the `command` and `args` (or the remote `url`) to put in the standard shape below; the remaining fields (`env`, `headers`) are named in the column. Full JSON is in each repo README.

```json
{"mcpServers": {"<name>": {"command": "<command>", "args": ["<args>"], "env": {}}}}
{"mcpServers": {"<name>": {"type": "http", "url": "<url>", "headers": {}}}}
```

Claude Code equivalent: `claude mcp add <name> -- <command> <args>` or `claude mcp add --transport http <name> <url>`.

## How to pick

Installed or native first (AGENTS.md invariant 3: "Default to the model's native capability; load a skill only when the domain warrants it"). The host already reads files, runs git, fetches pages (WebFetch) and drives a browser (Claude Browser, installed Playwright), and the repo's CONTEXT.md and `docs/adr/` are the memory of record; a server that duplicates one of those adds tool descriptions to every prompt for nothing. Add a server only for a capability the host lacks, and prefer stdio, local, keyless servers over hosted ones.

## Steering and memory

| Server | Layer | Transport | Keys / credits | Network | Config | URL |
|---|---|---|---|---|---|---|
| Sequential Thinking (reference) | steering | stdio (npx) or docker | none, MIT | no | `npx -y @modelcontextprotocol/server-sequential-thinking` | https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking |
| Memory / knowledge graph (reference) | steering | stdio (npx) or docker | none; local JSONL via `MEMORY_FILE_PATH` (default `memory.jsonl`) | no | `npx -y @modelcontextprotocol/server-memory` | https://github.com/modelcontextprotocol/servers/tree/main/src/memory |
| Context7 | steering | http remote or stdio (npx) | key optional; free key at context7.com/dashboard for higher rate limits, no numbers stated | yes | `claude mcp add --transport http context7 https://mcp.context7.com/mcp` or `npx -y @upstash/context7-mcp` | https://github.com/upstash/context7 |
| mem0 MCP | steering | stdio (uvx) or hosted http | `MEM0_API_KEY`; free tier not stated; repo archived 2026-03-24, points to hosted `https://mcp.mem0.ai/mcp` | yes | `uvx mem0-mcp-server`, env `MEM0_API_KEY` | https://github.com/mem0ai/mem0-mcp |

AGENTS.md routing: repo CONTEXT.md and `docs/adr/` are the truth; host memory holds preferences only. The file-backed Memory server is the only one that fits that rule; mem0 is cloud memory, use only if a file is not enough.

## Execution

| Server | Layer | Transport | Keys / credits | Network | Config | URL |
|---|---|---|---|---|---|---|
| Filesystem (reference) | execution | stdio (npx) | none, MIT | no | `npx -y @modelcontextprotocol/server-filesystem C:/Users/Yeonatan/master_team` (allow-listed dirs only) | https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem |
| Git (reference) | execution | stdio (uvx) | none; "early development", needs `mcp>=1.29.0,<2` | no | `uvx mcp-server-git --repository C:/Users/Yeonatan/master_team` | https://github.com/modelcontextprotocol/servers/tree/main/src/git |
| GitHub MCP Server (official) | execution | http remote or local docker | OAuth or PAT; no explicit limits stated, works with personal accounts | yes | url `https://api.githubcopilot.com/mcp/`; local `docker run ghcr.io/github/github-mcp-server` (`Bash(docker run:*)`) | https://github.com/github/github-mcp-server |
| Playwright MCP (Microsoft) | execution | stdio; http/sse with `--port` | none; downloads browser binaries on first run | first run | `npx @playwright/mcp@latest` | https://github.com/microsoft/playwright-mcp |
| Browserbase MCP | execution | hosted http or stdio (npx) | `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `GEMINI_API_KEY`; free tier not stated; repo archived 2026-07-20 | yes | `npx @browserbasehq/mcp`, env the three keys; hosted `https://mcp.browserbase.com/mcp` | https://github.com/browserbase/mcp-server-browserbase |
| Serena | execution | stdio (client-launched) or http | none (LSP backend); JetBrains backend needs a paid licence | no | `uv tool install -p 3.13 serena-agent` then `serena init`; Claude Code JSON in its docs | https://github.com/oraios/serena |
| Postgres MCP Pro | execution | stdio; sse | none; `--access-mode=restricted` = read-only with time limits | local DB only | `docker run -i --rm -e DATABASE_URI crystaldba/postgres-mcp --access-mode=restricted` (`Bash(docker run:*)`) | https://github.com/crystaldba/postgres-mcp |
| Supabase MCP (official) | execution | http remote | OAuth 2.1; free tier not stated | yes | url `https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true&features=database,docs` | https://github.com/supabase-community/supabase-mcp |
| Neon MCP (official) | execution | http remote | OAuth or `NEON_API_KEY` (free plan in [free-tiers.md](free-tiers.md)) | yes | url `https://mcp.neon.tech/mcp?category=projects&category=branches`, header `Authorization: Bearer <NEON_API_KEY>` | https://github.com/neondatabase/mcp-server-neon |
| Qdrant MCP (official) | execution | stdio; sse; streamable-http | none; offline with `QDRANT_LOCAL_PATH`; default embedder sentence-transformers/all-MiniLM-L6-v2 (one-time model download) | first run | `uvx mcp-server-qdrant`, env `QDRANT_LOCAL_PATH=C:/Users/Yeonatan/master_team/.qdrant`, `COLLECTION_NAME=notes` | https://github.com/qdrant/mcp-server-qdrant |
| Chroma MCP (official) | execution | stdio (uvx) | none for ephemeral/persistent; cloud needs an api-key | no | `uvx chroma-mcp --client-type persistent --data-dir C:/Users/Yeonatan/master_team/.chroma` | https://github.com/chroma-core/chroma-mcp |

AGENTS.md routing: Claude Browser or the installed Playwright, never browser-use; Browserbase is a hosted browser and sits behind the gate. Filesystem and Git duplicate what the host does natively; list them for Codex/Hermes hosts that lack the tools.

## Academic

| Server | Layer | Transport | Keys / credits | Network | Config | URL |
|---|---|---|---|---|---|---|
| arxiv-mcp-server | academic | stdio; http via env | none; arXiv API free; optional Semantic Scholar key for `citation_graph` | yes | `uvx arxiv-mcp-server --storage-path C:/Users/Yeonatan/master_team/_intake/papers` | https://github.com/blazickjp/arxiv-mcp-server |
| mcp-simple-arxiv | academic | stdio or web server | none; public arXiv API | yes | `python -m mcp_simple_arxiv` (after `pip install`, gated) | https://github.com/andybrandt/mcp-simple-arxiv |
| paper-search-mcp | academic | stdio | free-first; optional Semantic Scholar, CORE, Unpaywall email for higher limits, no numbers stated | yes | `uv tool run paper-search-mcp`, env `PAPER_SEARCH_MCP_UNPAYWALL_EMAIL` | https://github.com/openags/paper-search-mcp |
| PubMed-MCP-Server | academic | stdio (FastMCP, run from clone) | none | yes | `python C:/Users/Yeonatan/master_team/_intake/PubMed-MCP-Server/pubmed_server.py` | https://github.com/JackKuo666/PubMed-MCP-Server |
| zotero-mcp | academic | stdio; streamable-http; sse | none in local mode (Zotero desktop); web mode needs a Zotero API key and library ID | local: no | `zotero-mcp`, env `ZOTERO_LOCAL=true` | https://github.com/54yyyu/zotero-mcp |

These serve `thesis-review` (invariant 5): they fetch and verify citations, they never produce a result number. paper-search-mcp covers arXiv, PubMed, bioRxiv, Semantic Scholar, Crossref, OpenAlex, Google Scholar, dblp, CORE, Europe PMC, Zenodo, HAL, SSRN and Unpaywall in one server, so start there; zotero-mcp is the BibTeX truth when the owner keeps a Zotero library.

## Ingestion

| Server | Layer | Transport | Keys / credits | Network | Config | URL |
|---|---|---|---|---|---|---|
| Fetch (reference) | ingestion | stdio | none, open-source; obeys robots.txt for model-initiated requests | yes | see the repo README (UNVERIFIED: the survey record for this row was truncated, so the launch command is not quoted here) | https://github.com/modelcontextprotocol/servers/tree/main/src/fetch |

AGENTS.md routing: WebFetch first; Scrapling only on a Cloudflare block (`docs/integrations/scrapling.md`, `scrapling mcp` gated by `Bash(scrapling:*)`); Firecrawl and ScrapeGraphAI MCPs are on the HITL list by name and their pages in `docs/integrations/` say when they are worth it.

## Multimodal, security and growth

No MCP server was verified for these layers in the 2026-09-10 survey. The routing rows stand: the `higgsfield` CLI (not its MCP, audit section 4), faster-whisper on demand, cisco-ai-defense/skill-scanner for intake, snyk agent-scan only as the gated uploading alternative. Propose a server per [README.md](README.md).

Verified on 2026-09-10.
