# Free tiers

Hosted services with a stated free quota, one table per layer. Numbers are quoted from ripienaar/free-for-dev (GitHub master last modified 2026-09-08) as read on 2026-09-10, except where a row cites the vendor's own pricing page (Deno Deploy), which wins when the two disagree; each URL returned a page that day. Free tiers change without notice: re-check the vendor page before relying on a number. Entries whose URL did not fetch (Hook0, News API, Geekflare API, PhantomJsCloud, Socket, MongoDB Atlas) were dropped. Every service below reaches the network at use time; none is installed on the reference machine (audit section 4 lists what is).

**Gate entry** is the `harness/settings.json` ask pattern that fires when the service is called from Bash. A hosted API called through Python, an SDK or an MCP server has no Bash pattern; there the AGENTS.md HITL list is the enforcement (`docs/integrations/README.md`, point 3), so the row says "HITL list". A call made with `curl` always hits `Bash(curl:*)`.

## How to pick

Installed or native first (AGENTS.md invariant 3): the model's own capability, then what audit section 4 says is installed, then stdlib, then an installed dependency. Reach for a hosted free tier only when none of those covers it, and prefer the keyless entry (microlink) over a keyed one, and a keyed one over a metered one. Name the call and its cost, wait for an explicit yes, never inside a loop.

## Steering and memory

| Service | What for | Free tier | Key | Gate entry | URL |
|---|---|---|---|---|---|
| Google AI Studio (Gemini API) | fallback LLM for planning and cheap judge calls | Gemini 3.5 Flash: 5 req/min, 20 req/day, 250k input tokens/min; Gemma 4: 30 req/min, 14.4k req/day, 16k input tokens/min | yes | HITL list | https://aistudio.google.com/ |
| OpenRouter free models | one OpenAI-compatible endpoint over free open models (DeepSeek, Llama, Moonshot) | free models, rate-limited, no numbers stated | yes | HITL list | https://openrouter.ai/models?q=free |
| Keywords AI | LLM gateway with request logging | 10,000 requests/month, $0 platform features | yes | HITL list | https://keywordsai.co |
| Langfuse | trace agent runs, prompts, tool steps | 50k observations/month, all features; open-source self-host | yes | HITL list | https://langfuse.com/ |
| telemetry.dev | OTLP sink for model calls (tokens, cost, latency) | 10,000 ingestion units/month (one per span, log record or metric point), 7-day retention, 1 project, 2 seats, no card | yes | HITL list | https://telemetry.dev |
| Future AGI | agent simulation, BYOK LLM-as-judge evals | 50 GB storage, 2K eval credits, 100K gateway requests/month, 1M tokens text simulation, 60 min voice simulation | yes | HITL list | https://futureagi.com |

## Execution

| Service | What for | Free tier | Key | Gate entry | URL |
|---|---|---|---|---|---|
| Trigger.dev | long agent tasks with durable retries | $5 compute credits/month, 20 concurrent runs, 10 schedules, 1-day logs | yes | HITL list | https://trigger.dev |
| Inngest | event-driven step functions (TS/Python/Go) | Hobby: 50k executions/month, 5 concurrent steps, 500k events, no card | yes | HITL list | https://www.inngest.com |
| Val Town | zero-infra HTTP endpoints and scheduled triggers | unlimited public vals, 15-min cron, 1-min wall clock/run, 3-day logs | yes | HITL list | https://www.val.town |
| Cloudflare Workers | lightweight tool endpoints and webhooks | 100k requests/day | yes | HITL list | https://developers.cloudflare.com/workers/ |
| Deno Deploy | TypeScript tool servers at the edge | 1M requests/month, 20 GiB transfer/month (deno.com/deploy/pricing 2026-09-10; free-for-dev said 100k/day, 100 GiB) | yes | HITL list | https://deno.com/deploy/pricing |
| Modal | burst CPU/GPU for heavy subtasks | $30 credits/month (may be $5 on some accounts) | yes | HITL list | https://modal.com |
| Koyeb | always-on container for a small worker | Hobby: 550 compute hours/month (512 MB), 1 Postgres, custom-domain SSL | yes | HITL list | https://www.koyeb.com/ |
| cron-job.org | kick off scheduled runs over HTTP | unlimited jobs | yes | HITL list | https://cron-job.org |
| Svix | outbound webhook delivery | 50,000 messages/month | yes | HITL list | https://www.svix.com/ |

## Academic

| Service | What for | Free tier | Key | Gate entry | URL |
|---|---|---|---|---|---|
| Tavily | LLM-oriented search and research aggregation | 1,000 requests/month, no card | yes | HITL list | https://tavily.com/ |
| Brave Search API | independent web/news index for RAG | $5 credits/month (card required for verification) | yes | HITL list | https://brave.com/search/api/ |
| SerpApi | structured Google/Scholar-style SERPs | 100 successful calls/month | yes | HITL list | https://serpapi.com/ |
| Algolia | full-text index over harness docs; DocSearch for published docs | Build plan: 1M documents, 10K searches/month; DocSearch free | yes | HITL list | https://www.algolia.com/ |

For literature search proper (arXiv, OpenAlex, PubMed, Crossref, Semantic Scholar) see the keyless MCP servers in [mcp-servers.md](mcp-servers.md) and the skills in [community-skills.md](community-skills.md); those APIs are free without a hosted plan.

## Ingestion

| Service | What for | Free tier | Key | Gate entry | URL |
|---|---|---|---|---|---|
| Firecrawl | URL or site to LLM-ready markdown | 1,000 credits/month, no card | yes | `Bash(firecrawl:*)`; see `docs/integrations/firecrawl.md` | https://www.firecrawl.dev/ |
| ScrapingAnt | JS-rendered fetch with rotating proxies | 10,000 API credits | yes | HITL list | https://scrapingant.com/ |
| WebScraping.AI | Chrome rendering, proxies, built-in parsing | 2,000 calls/month | yes | HITL list | https://webscraping.ai |
| Apify | ready-made scraper actors with proxies | $5 platform credits/month | yes | HITL list | https://www.apify.com/ |
| microlink.io | link previews, metatags, screenshots | 50 requests/day, no key | no | HITL list (network) | https://microlink.io/ |
| Reducto | PDF/XLSX/PPTX/image to structured JSON | 15k credits, then pay-as-you-go | yes | HITL list | https://reducto.ai |
| Parseur | PDF and email extraction | 20 pages/month, full API | yes | HITL list | https://parseur.com |

Routing reminder (AGENTS.md): WebFetch first; Scrapling only on a Cloudflare block; Firecrawl and ScrapeGraphAI are on the HITL list by name.

## Multimodal

| Service | What for | Free tier | Key | Gate entry | URL |
|---|---|---|---|---|---|
| OCR.Space | text from images and scanned PDFs | 25,000 requests/month, 1 MB file limit | yes | HITL list | https://ocr.space/ |
| Hugging Face Inference | hosted embeddings, translation, classification | 30k input characters/month | yes | HITL list | https://huggingface.co |
| Transcript LOL | audio/video to text with summaries | 2 transcriptions/day | yes | HITL list | https://transcript.lol/ |
| Doppio | HTML to PDF or screenshot | 400 PDFs and screenshots/month | yes | HITL list | https://doppio.sh/ |
| PDFBolt | HTML to PDF export | 500 conversions/month | yes | HITL list | https://pdfbolt.com |

Routing reminder: transcription is faster-whisper, installed on demand (`docs/integrations/faster-whisper.md`); generation is the `higgsfield` CLI (credits, `Bash(higgsfield:*)`). The rows above are for cases neither covers.

## Security and growth

| Service | What for | Free tier | Key | Gate entry | URL |
|---|---|---|---|---|---|
| Semgrep | SAST and SCA on agent-written code | 10 contributors, 10 private repos, unlimited public | yes | HITL list (CLI install: `Bash(pip install:*)`) | https://semgrep.dev |
| GitGuardian | catch leaked keys in commits | free for individuals and teams up to 25 developers | yes | HITL list | https://www.gitguardian.com |
| Gridlastic | hosted Selenium grid for E2E checks | 4 nodes, 10 grid starts, 4,000 test minutes/month | yes | HITL list | https://www.gridlastic.com/ |
| healthchecks.io | dead-man switch for scheduled runs | 20 checks | yes | HITL list | https://healthchecks.io |
| UptimeRobot | watch endpoints and published docs | 50 monitors, 5-minute intervals | yes | HITL list | https://uptimerobot.com/ |

Skill scanning stays with cisco-ai-defense/skill-scanner (offline) per `docs/integrations/skill-scanner.md`; snyk agent-scan uploads and is gated by name.

## Infrastructure (serves every layer)

| Service | What for | Free tier | Key | Gate entry | URL |
|---|---|---|---|---|---|
| Qdrant Cloud | managed vector store for memory/RAG | 1 node: 0.5 vCPU, 1 GB RAM, 4 GB disk | yes | HITL list | https://qdrant.tech/ |
| Neon | branchable Postgres with pgvector | 0.5 GB/project, 100 projects, 10 branches/project, 20 h/month non-primary compute | yes | HITL list | https://neon.tech/ |
| Nile | always-on Postgres with built-in embeddings | unlimited databases, 1 GB total, 50M query tokens | yes | HITL list | https://www.thenile.dev/ |
| Turso | per-agent SQLite (libSQL) | 9 GB, 500 databases, 3 locations, 1B row reads/month | yes | HITL list | https://turso.tech/ |
| Upstash | serverless Redis for queues and rate limits | 500K commands/month, 256 MB, 20 connections | yes | HITL list | https://upstash.com/ |
| Neo4j Aura | hosted knowledge graph (e.g. graphify output) | 200k nodes, 400k relationships | yes | HITL list | https://neo4j.com/cloud/aura/ |
| Cloudflare R2 | artifact storage, zero egress | 10 GB/month, 1M Class A ops, 10M Class B ops | yes | HITL list | https://developers.cloudflare.com/r2/ |
| Cloudflare D1 | SQLite at the edge for Worker state | 5M rows read/day, 100k rows written/day, 1 GB | yes | HITL list | https://developers.cloudflare.com/d1/ |
| Backblaze B2 | backup target for run archives | 10 GB, unlimited time | yes | HITL list | https://www.backblaze.com/b2/ |
| GitHub (Actions + Pages) | CI runner and docs host | unlimited public/private repos and collaborators; minute quotas not stated in source | yes | `Bash(git push:*)` | https://github.com/ |
| CircleCI | larger CI budget for gauntlet runs | 6,000 minutes/month, 30 parallel jobs; up to 80,000 minutes open source | yes | HITL list | https://circleci.com/ |
| Cloudflare Pages | docs with preview deploys per branch | 500 builds/month, 100 custom domains, unlimited previews | yes | HITL list | https://developers.cloudflare.com/pages/ |
| Read the Docs | versioned Sphinx/MkDocs hosting | free hosting with versioning and PDF; no numeric limits stated | yes | HITL list | https://readthedocs.org/ |
| Netlify | alternative static host with deploy previews | 300 credits/month (30 GB bandwidth) | yes | HITL list | https://www.netlify.com/ |

## Gaps in the source

free-for-dev lists no dedicated speech-to-text, translation, embeddings-only or free-tier Groq/Cerebras entry; Azure Cognitive Services is listed without numbers and was omitted. Propose entries per [README.md](README.md).

Verified on 2026-09-10.
