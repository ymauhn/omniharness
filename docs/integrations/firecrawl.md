# Firecrawl

## What it is
Hosted crawler that turns sites into markdown/JSON; an AGPL core you can self-host with Docker.

## When to reach for it
Try first: WebFetch for one page, Scrapling for a blocked page (`scrapling.md`). Reach for Firecrawl only for a whole-site crawl (hundreds of pages, sitemap-driven). Audit verdict: skip by default; documented here as opt-in.

## Cost and keys
Cloud: `FIRECRAWL_API_KEY` and credits per page (plans and per-page prices are set by firecrawl.dev). Free path: self-host with Docker, no key, the owner's machine does the work.

## Network and the gate
Every scrape reaches the target site, and the cloud path also sends the URLs to firecrawl.dev. Gated by `"Bash(firecrawl:*)"` in `harness/settings.json`; the self-host path by `"Bash(docker pull:*)"`, `"Bash(docker run:*)"` and `"Bash(curl:*)"`. Note: `docker compose up` and `npx -y firecrawl-mcp` match no ask entry, so the AGENTS.md HITL line "Firecrawl" is the gate for them.

## Install
Cloud SDK / CLI / MCP (all need the key):
```
pip install firecrawl-py
npx -y firecrawl-cli@latest init --all --browser
npx -y firecrawl-mcp        # MCP server, env FIRECRAWL_API_KEY=fc-...
```
Self-host (free path; Docker 29.6 is on the reference machine):
```
git clone https://github.com/firecrawl/firecrawl.git
cd firecrawl
# .env: USE_DB_AUTHENTICATION=false plus POSTGRES_USER/PASSWORD/DB (see SELF_HOST.md)
docker compose up --build -d
export FIRECRAWL_API_URL=http://localhost:3002
```
The self-host baseline disables authentication; keep it on localhost.

## Activate in OmniHarness
No routing row names Firecrawl; it sits under "Fetch a page" as the last step after WebFetch and Scrapling, and in the HITL list. Prefer the self-hosted endpoint; use the cloud only when the owner supplies a key.
Say first: "This runs a Firecrawl crawl of <site> (~N pages): the cloud path bills about N credits on your key; the self-host path is free but runs Docker locally. Proceed?"

## Verify it works
Self-host:
```
curl -X POST http://localhost:3002/v2/scrape -H "Content-Type: application/json" -d "{\"url\":\"https://example.com\",\"formats\":[\"markdown\"]}"
```
Expected: JSON with `"success": true` and a `markdown` field containing "Example Domain".

## Uninstall
`docker compose down -v` in the clone, then delete the clone (recursive delete: asks); `pip uninstall firecrawl-py`; unset `FIRECRAWL_API_KEY`.

## License
Core: AGPL-3.0. SDKs and some UI components: MIT.

## Source
https://github.com/firecrawl/firecrawl · self-host: https://docs.firecrawl.dev/contributing/self-host

Verified on 2026-09-10.
