# Community skills

Skill packs, single skills and indexes that fit an OmniHarness layer. Surveyed on 2026-09-10 from travisvn/awesome-claude-skills, VoltAgent/awesome-agent-skills, ComposioHQ/awesome-claude-skills, BehiSecc/awesome-claude-skills, O0000-code/awesome-academic-skills, anthropics/skills, skills.sh and agentskills.io; every URL below returned a page that day. Collections whose URL returned 404 or a redirect (sanity-io/agent-skills, crawlbase/agent-skills, serpapi/agent-skills, openai/openai-plugins, K-Dense-AI/scientific-skills) are not listed; openai/skills is marked deprecated upstream and is not listed either.

Nothing here is installed on the reference machine except what audit section 4 names (mattpocock/skills 1.2.3, ponytail 4.9.0, graphify 0.9.53, higgsfield CLI 1.1.23 with its skills, Playwright 1.62). Installing any row is gated (`Bash(npx skills add:*)`, `Bash(pip install:*)`; a plugin marketplace add is a network fetch and falls under the AGENTS.md HITL list), and every row goes through the intake procedure in [README.md](README.md) before it is linked.

**Install method** keys: *copy* = clone into `_intake/<name>`, read, then copy the skill folder into `.agents/skills/` (preferred: no installer, no telemetry, matches invariant 1); *npx* = `npx skills add <owner/repo>` via vercel-labs/skills (npm network, anonymous telemetry unless `DISABLE_TELEMETRY=1`); *plugin* = `/plugin marketplace add <owner/repo>` then `/plugin install`. Some packs assume local tools the Phase 0 audit did not find (LaTeX, yt-dlp, trafilatura, ffuf, Semgrep, CodeQL, Pandoc); the notes say so, and the audit must confirm before use.

## How to pick

Installed or native first (AGENTS.md invariant 3: "Default to the model's native capability; load a skill only when the domain warrants it"). The routing table already covers plan (`/grilling`, `/domain-modeling`, mattpocock skills), build (`/tdd`, ponytail), review (`/code-review`, `/security-review`, `/simplify`), bug hunting (Gauntlet) and the thesis (`thesis-review`). Add a row from this list only when a task falls outside those, and pick the offline, keyless, permissively licensed one first.

## Steering and memory

| Skill or collection | Layer | License | Install | Keys / credits | URL | Notes |
|---|---|---|---|---|---|---|
| obra/superpowers | steering | MIT | plugin (`superpowers@claude-plugins-official`) or npx | none | https://github.com/obra/superpowers | brainstorming, writing-plans, executing-plans, TDD, systematic-debugging, verification-before-completion, code-review request/receive; overlaps mattpocock and ponytail, take only the gaps |
| mattpocock/skills | steering | MIT | installed (1.2.3, audit section 4) | none | https://github.com/mattpocock/skills | grilling, to-spec, to-tickets, wayfinder, tdd, code-review, domain-modeling, research; already routed in AGENTS.md |
| imbue-ai/blueprint | steering | MIT | npx or copy | none | https://github.com/imbue-ai/blueprint | asks clarifying questions, emits an executable markdown plan; the README's curl-piped-to-bash path must not be used, intake by copy |
| anthropics/skills skill-creator | steering | Apache-2.0 | plugin (`example-skills@anthropic-agent-skills`) | eval runs spend model tokens (gate) | https://github.com/anthropics/skills/tree/main/skills/skill-creator | template, eval viewer and scripts for writing and benchmarking SKILL.md files |
| ykdojo/claude-code-tips dx | steering | open-source (license not stated in survey) | plugin (`dx@ykdojo`) | none; reddit-fetch and hn-summarize reach the network | https://github.com/ykdojo/claude-code-tips | handoff, half-clone/quarter-clone context trimming, gha CI-failure triage |
| tt-a1i/archify | steering | MIT | `npx skills add tt-a1i/archify -g` (gated); Node.js | none stated | https://github.com/tt-a1i/archify | architecture, workflow, sequence, data-flow and lifecycle diagrams as self-contained HTML+SVG with PNG/WebM export; evidence nodes pin git-verified file and line ranges to a commit; validation before delivery; candidate for `docs/adr` diagrams and the portal; read 2026-09-14 |

## Execution

| Skill or collection | Layer | License | Install | Keys / credits | URL | Notes |
|---|---|---|---|---|---|---|
| anthropics/skills webapp-testing | execution | Apache-2.0 | plugin | none | https://github.com/anthropics/skills/tree/main/skills/webapp-testing | Playwright-driven verification of local web apps; Playwright 1.62 is installed per audit |
| testdino-hq/playwright-skill | execution | MIT | npx or copy | none | https://github.com/testdino-hq/playwright-skill | 70 markdown guides (locators, fixtures, network mocking, visual/a11y/security tests); no code |
| LambdaTest/agent-skills (TestMu) | execution | MIT (skills) | `npx agentskillsforall add <git url> --skill pytest-skill` or copy | cloud grid needs LT_USERNAME/LT_ACCESS_KEY; no free-tier numbers stated | https://github.com/LambdaTest/agent-skills | pytest, jest, playwright, cypress, selenium, puppeteer generators; local generation works without an account |
| trailofbits/skills differential-review, variant-analysis | execution | CC-BY-SA-4.0 (share-alike) | plugin or copy | none | https://github.com/trailofbits/skills | diff review with git history, variant analysis, property-based and mutation testing; SECURITY-RELEVANT (runs local tools) |
| getsentry/skills | execution | Apache-2.0 | plugin (`sentry-skills@sentry-skills`) or npx | Sentry account only when reading Sentry data | https://github.com/getsentry/skills | sentry-code-review, sentry-pr-code-review, sentry-create-alert |
| anthropics/skills mcp-builder | execution | Apache-2.0 | plugin | none | https://github.com/anthropics/skills/tree/main/skills/mcp-builder | reference and scripts for building an MCP server the harness can adapt |
| stablyai/orca | execution | MIT | desktop app (DMG/EXE/AppImage) or CLI; not for install here | the agents' own subscriptions | https://github.com/stablyai/orca | reference for multi-agent execution: one git worktree per agent, SSH worktrees for remote runtimes, compare-and-merge, per-account usage tracking; a reading for an ADR against our Workflow drivers; read 2026-09-14 |
| ruvnet/ruflo (formerly Claude Flow) | execution | MIT | `npx ruflo@latest init wizard` or the README's install script piped into a shell (both gated; the guard blocks the piped form); MCP `claude mcp add claude-flow -- npx ruflo@latest mcp start`; `init --codex` writes AGENTS.md and .agents/skills/ | none to install; its 12 background workers and swarms spend model tokens on their own (no gate found); Node 20+, 45 MB minimal to 340 MB full, ~35 s cold start | https://github.com/ruvnet/ruflo | meta-harness: ~210 MCP tools, 27 hooks, swarms in 6 topologies with a queen and a claims board, Thompson-sampling model router, GOAP on the product page only; verdict 2026-09-14: not installed, patterns mined for T13 (`docs/experiments/ruflo-comparison-2026-09-14.md`) |

## Design stack (frontend)

Two entries that work as one pipeline, added 2026-09-10 at the owner's request. `impeccable` is the design language: art direction, typography, spacing, colour and quality bars written down as `PRODUCT.md` and `DESIGN.md`, plus 23 commands that shape, critique, audit and polish a UI. The 21st Magic MCP (in [mcp-servers.md](mcp-servers.md)) is the component supply: search and retrieval over 10,000+ React/Tailwind components from the editor. Order of operations: `impeccable init` and `shape` first, so the guardrails exist; then components are picked or generated against `DESIGN.md`; then the ponytail ruleset implements and `ponytail-review` reviews; then `impeccable critique`, `audit`, `polish`. In the skills graph this is `impeccable precedes magic-mcp`, `magic-mcp guided-by impeccable`, `magic-mcp feeds ponytail-review`, and the official `frontend-design` plugin is `alternative-to impeccable` (`docs/skills-graph/`).

| Skill or collection | Layer | License | Install | Keys / credits | URL | Notes |
|---|---|---|---|---|---|---|
| pbakaus/impeccable | execution | Apache-2.0 | plugin (`/plugin marketplace add pbakaus/impeccable`) or copy (`dist/claude-code/.claude` into the project) | none; deterministic, no network at use time; `npx impeccable detect` needs a local Chrome, Chromium or Edge | https://github.com/pbakaus/impeccable | 23 commands (craft, init, document, extract, shape, critique, audit, polish, bolder, quieter, distill, harden, onboard, animate, colorize, typeset, layout, delight, overdrive, clarify, adapt, optimize, live); ships `.impeccable/config.json`, `design.json`, `surfaces/*.md`; supports Claude Code, Codex CLI, Hermes Agent, Cursor and 13 others; not installed on the reference machine |
| abi/screenshot-to-code | design | MIT | FastAPI backend (poetry) + React frontend (pnpm) or Docker Compose (gated); hosted paid version exists | at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY; Replicate recommended (credits) | https://github.com/abi/screenshot-to-code | screenshot or screen recording to HTML+Tailwind, React, Vue, Bootstrap, Ionic; catalog row only: the model's native vision plus DESIGN.md covers the job in this harness; read 2026-09-14 |
| cathrynlavery/diagram-design | design | MIT; third-party icon attribution | candidate for per-skill intake, not installed | no provider key required for local HTML/SVG; optional site-style fetch uses public network | https://github.com/cathrynlavery/diagram-design | diagram-design skill with scripts for HTML/SVG architecture diagrams; compare one fixed diagram with archify before intake; read 2026-09-25 |

## Academic

| Skill or collection | Layer | License | Install | Keys / credits | URL | Notes |
|---|---|---|---|---|---|---|
| ykdojo/paper-search | academic | open-source (license not stated in survey) | plugin (`paper-search@paper-search`) | none; OpenAlex, no API key, rate limits not stated | https://github.com/ykdojo/paper-search | keyword/DOI search over OpenAlex via shell scripts, sort by citations or date |
| O0000-code/paper-search-pro | academic | Apache-2.0 | copy + `pip install -r requirements` (gated) | four free keys (OpenAlex, PubMed, Semantic Scholar, CrossRef); arXiv keyless | https://github.com/O0000-code/paper-search-pro | multi-source search with relevance classification and BibTeX/RIS/CSV export |
| njzjz/wenxian | academic | LGPL-3.0 | `uvx wenxian` or as a skill | none; queries CrossRef/PubMed/arXiv | https://github.com/njzjz/wenxian | BibTeX from DOI/PMID/arXiv ID/title: the anti-hallucination citation path `thesis-review` needs |
| appautomaton/latex-arxiv-SKILL | academic | MIT | copy (`arxiv-paper-writer` folder) | none; each `\cite` is web-checked | https://github.com/appautomaton/latex-arxiv-SKILL | human approval gates, issue-driven writing loop, latexmk compile; needs a LaTeX install (not in audit) |
| yunshenwuchuxun/latex-paper-skills | academic | MIT | copy | assumes an OpenAI GPT-5.x runtime; optional Gemini/Claude keys | https://github.com/yunshenwuchuxun/latex-paper-skills | results-backfill and latex-rhythm-refiner map onto `thesis-review`; port the prompts, not the runtime |
| alexwortega/ai-peer-review-skill | academic | MIT | copy (git clone + symlink) | spends model tokens: up to 8 subagents per run (gate) | https://github.com/alexwortega/ai-peer-review-skill | N structured reviews plus meta-review and concerns CSV from PDF/DOCX/MD; complements gauntlet-review |
| Imbad0202/academic-research-skills | academic | CC-BY-NC 4.0 (non-commercial only) | plugin | ANTHROPIC_API_KEY; heavy token spend (gate) | https://github.com/imbad0202/academic-research-skills | PRISMA deep research (Semantic Scholar verification), 12-agent writer, 7-agent reviewer; contradicts invariant 5 if it invents numbers, use for review only |
| K-Dense-AI/claude-scientific-writer | academic | MIT | plugin | ANTHROPIC_API_KEY + PARALLEL_API_KEY (paid lookup); optional OPENROUTER_API_KEY; no free numbers stated | https://github.com/K-Dense-AI/claude-scientific-writer | papers, posters, grants, literature reviews with verified citations; needs LaTeX and Python 3.10 |
| K-Dense-AI/scientific-agent-skills | academic | repo MIT; individual skill licenses vary | candidate for selective copy after per-skill intake, not installed | sampled experimental-design/statistical-power skills use Python/scientific packages; no external model call required by their instructions | https://github.com/K-Dense-AI/scientific-agent-skills | experiment design and power-analysis candidates for Thesis Factory/E2; inspect exact licenses, scripts and dependencies, and do not load the full collection into every session; read 2026-09-25 |
| O0000-code/awesome-academic-skills | academic | CC0 (index) | not installable | none | https://github.com/O0000-code/awesome-academic-skills | 222 entries, each noting license and network; reference list for future intake |

## Ingestion

| Skill or collection | Layer | License | Install | Keys / credits | URL | Notes |
|---|---|---|---|---|---|---|
| anthropics/skills pdf | ingestion | source-available, NOT open source (Anthropic Consumer/Commercial Terms) | already mounted as the `anthropic-skills:pdf` plugin | none | https://github.com/anthropics/skills/tree/main/skills/pdf | text/table extraction, merge/split, forms; license blocks redistribution into `.agents/skills` |
| michalparkola/tapestry-skills (article-extractor, youtube-transcript) | ingestion | MIT | copy or `./install.sh` | none; needs reader-cli or trafilatura, and yt-dlp (external installs, gated) | https://github.com/michalparkola/tapestry-skills-for-claude-code | readable article text and YouTube transcripts; overlaps the Agent-Reach routing row |
| firecrawl/skills | ingestion | ISC | npx or copy | FIRECRAWL_API_KEY; free plan 1,000 credits/month, 2 concurrent, scrape 10/min, crawl 2/min, no card (firecrawl.dev/pricing 2026-09-10) | https://github.com/firecrawl/skills | scrape/crawl/interact/deep-research/SEO-audit; gated by name in AGENTS.md and `Bash(firecrawl:*)`; WebFetch first |
| yusufkaraaslan/Skill_Seekers | ingestion | MIT | `pip install skill-seekers` (gated) | core free; optional LLM enhancement needs Anthropic/Gemini/OpenAI keys | https://github.com/yusufkaraaslan/Skill_Seekers | docs sites, repos, PDFs, videos into SKILL.md packages; large dependency surface, intake carefully |
| Xquik-dev/x-twitter-scraper | ingestion | MIT (skill) | copy | Xquik key, $0.00015 per tweet, no free tier stated | https://github.com/Xquik-dev/x-twitter-scraper | public X reads without an X account; README warns never to hand cookies or passwords to an agent; overlaps Agent-Reach |
| unclecode/crawl4ai | ingestion | Apache-2.0 | `pip install -U crawl4ai` + `crawl4ai-setup` (gated), or the Docker server (gated) | none for the open-source library; Playwright Chromium runs locally; keeps browser sessions and proxies, so a logged-in read is the owner's decision behind the gate | https://github.com/unclecode/crawl4ai | pages to LLM-ready markdown and structured JSON; REST + MCP from the Docker image; fetch layer of `ingest --route=session` and a scout source adapter; read 2026-09-14 |

## Multimodal

| Skill or collection | Layer | License | Install | Keys / credits | URL | Notes |
|---|---|---|---|---|---|---|
| fal-ai-community/skills | multimodal | MIT (skills) | copy or npx | fal.ai key; no free credits (pay-per-use, GPU from $1.89/hr, fal.ai/pricing 2026-09-10) | https://github.com/fal-ai-community/skills | genmedia CLI, model routing, image/video/audio/3D/lip-sync; alternative provider to the `higgsfield` CLI, every call gated |
| genmedia-labs/skills (RunComfy) | multimodal | MIT (skills) | `npx skills add agentspace-so/runcomfy-agent-skills --skill <name>` | RunComfy key; no free credits stated | https://github.com/genmedia-labs/skills | 40+ media model skills (video-edit, ai-music, face-swap, lipsync, relight); paid, gated |
| video-db/skills | multimodal | MIT (skills) | npx or plugin | VIDEO_DB_API_KEY; $20 free credits, no card (README 2026-09-10) | https://github.com/video-db/skills | server-side video capture, search, edit, stream |
| remotion-dev/skills | multimodal | not stated on README (Remotion itself has a company license) | npx or copy | none; local rendering | https://github.com/remotion-dev/skills | programmatic React video: create, markup, render, captions, maps; needs Node and npm packages (install gated) |
| anthropics/skills canvas-design, algorithmic-art, slack-gif-creator | multimodal | Apache-2.0 | plugin | none | https://github.com/anthropics/skills/tree/main/skills | PNG/PDF design, p5.js seeded art, Slack-sized GIFs with no paid provider |
| bradautomates/claude-video | multimodal | MIT | plugin marketplace `bradautomates/claude-video` or `npx skills add` (gated); needs yt-dlp and ffmpeg | captions free via yt-dlp; Whisper fallback needs a Groq or OpenAI key (credits) | https://github.com/bradautomates/claude-video | /watch: frames by keyframe, scene or uniform mode with a budget by duration; alternative to the local yt-dlp + ffmpeg + faster-whisper recipe, which keeps transcription keyless; read 2026-09-14 |
| calesthio/openmontage | multimodal | AGPL-3.0 (network-use clause: relevant to anything served to members) | `git clone` + `make setup` (gated); intake a subset of `skills/pipelines/` (Animated Explainer, Screen Demo) with the scanner, never the 700 files | offline path: Piper TTS, Archive.org, Pexels/Unsplash/Pixabay free keys; 60+ paid providers optional; $1-5 per video quoted by the README | https://github.com/calesthio/openmontage | curated subset only: markdown or script to narrated explainer and screen demo; the owner's D3: subset, not the collection; the brief's `lesthio/` path is a 404, `calesthio/` is the project; read 2026-09-14 |

## Security and growth

| Skill or collection | Layer | License | Install | Keys / credits | URL | Notes |
|---|---|---|---|---|---|---|
| trailofbits/skills (security suite) | security | CC-BY-SA-4.0 (share-alike) | plugin or copy | none; external tools CodeQL, Semgrep, Burp, gh not in audit | https://github.com/trailofbits/skills | static-analysis, semgrep-rule-creator, insecure-defaults, constant-time-analysis, supply-chain-risk-auditor, yara-authoring; nothing in it scans skills or MCP descriptions (audit section 4); SECURITY-RELEVANT |
| agamm/claude-code-owasp | security | MIT | copy (or `npx degit`) | none | https://github.com/agamm/claude-code-owasp | OWASP Top 10:2025 and ASVS 5.0 checklists incl. agentic AI, 20+ languages; reference only |
| mukul975/Anthropic-Cybersecurity-Skills | security | Apache-2.0 | reference; defensive subset needs per-skill intake, not installed | varies; some executable skills require packages or network | https://github.com/mukul975/Anthropic-Cybersecurity-Skills | large independent collection of defensive and offensive skills; use narrowly for E1/T13 permission and injection fixtures, never as blanket host authority; read 2026-09-25 |
| jthack/ffuf_claude_skill | security | MIT | copy | none; needs the ffuf binary (not in audit) | https://github.com/jthack/ffuf_claude_skill | directory/subdomain/API fuzzing; OFFENSIVE, target authorization required, gate per run |
| jonathimer/devmarketing-skills | growth | MIT | `npx add-skill` or copy | none | https://github.com/jonathimer/devmarketing-skills | 33 markdown-only skills: HN launch, developer SEO, docs-as-marketing, community |
| rampstackco/claude-skills | growth | MIT | copy | SEO audit orchestrator expects the Ahrefs MCP (paid) | https://github.com/rampstackco/claude-skills | 103 website-lifecycle skills; foundation SEO/content/growth work offline |
| coreyhaines31/marketingskills | growth | MIT | npx (never `-g`) | some skills reach the network | https://github.com/coreyhaines31/marketingskills | 50+ growth/CRO skills; audit section 4 verdict: install on demand into `.agents/skills` |
| BehiSecc/awesome-claude-skills | security | index (license not stated in survey) | not installable | none | https://github.com/BehiSecc/awesome-claude-skills | general index (600+ skills, 15+ domains) with a security section; source of VibeSec-Skill, owasp-security, x-twitter-scraper, paper-search rows |

## Infrastructure (skill tooling)

| Skill or collection | Layer | License | Install | Keys / credits | URL | Notes |
|---|---|---|---|---|---|---|
| vercel-labs/skills (skills CLI, find-skills) | infra | MIT | `npx skills` (gated) | none; optional GITHUB_TOKEN for private repos; telemetry unless `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` | https://github.com/vercel-labs/skills | add/find/list/update for 75+ agents; the harness prefers plain copy |
| agentskills/agentskills (spec, skills-ref) | infra | Apache-2.0 code, CC-BY-4.0 docs | read only | none | https://github.com/agentskills/agentskills | the six-field SKILL.md spec invariant 1 targets; `skills-ref` is the reference implementation to check `.agents/skills` against |
| anthropics/skills (repo) | infra | Apache-2.0 except docx/pdf/pptx/xlsx (source-available only) | plugin | none | https://github.com/anthropics/skills | canonical `template/` and `spec/`, frontend-design, theme-factory and the rows above |
| cloudflare/skills | infra | Apache-2.0 | npx (`https://github.com/cloudflare/skills`) or copy | bundled MCP needs Cloudflare API credentials for live calls | https://github.com/cloudflare/skills | 18 skills: wrangler, workers-best-practices, durable-objects, sandbox, web-perf |

## Flags to carry into intake

- Licensing: anthropics document skills are Anthropic proprietary terms, not redistributable; Imbad0202 is CC-BY-NC 4.0; trailofbits is CC-BY-SA-4.0 (derivatives must share alike).
- Paid at use: firecrawl past 1,000 credits, video-db past $20, fal.ai and RunComfy (no free credits), Xquik per tweet, LambdaTest grid, Ahrefs MCP, K-Dense (Parallel API), Imbad0202 and ai-peer-review (token spend).
- Security-relevant: trailofbits (runs tools), ffuf (offensive), Skill_Seekers (dependency surface), x-twitter-scraper (never pass cookies), claude-code-owasp (reference only, safe).

Verified on 2026-09-10; design stack rows added the same day.
