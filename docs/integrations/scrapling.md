# Scrapling

## What it is
Adaptive Python scraper with three fetchers (plain HTTP with TLS fingerprinting, stealth, full browser) and an MCP server that strips prompt-injection content from pages before the model sees them.

## When to reach for it
WebFetch first, always. Reach for Scrapling only on the first Cloudflare or anti-bot block, or when a page needs JavaScript to render. Routing row: "Fetch a page".

## Cost and keys
Free, no key, no account. Bandwidth only.

## Network and the gate
Every fetch reaches the target site. Gated by `"Bash(scrapling:*)"` in `harness/settings.json`; the install step by `"Bash(pip install:*)"`. Fetches issued from a Python script match no Bash pattern: state the URL and wait for a yes before running the script.

## Install
```
pip install "scrapling[ai]"
scrapling install
```
`[ai]` includes the fetchers and the MCP server; `scrapling install` downloads the browser used by `DynamicFetcher` and `StealthyFetcher`. Fetchers only: `pip install "scrapling[fetchers]"`.

## Activate in OmniHarness
Routing row "Fetch a page": WebFetch first; Scrapling only on a Cloudflare block. Escalation order: `Fetcher` (HTTP) then `StealthyFetcher` then `DynamicFetcher` (browser). MCP server: `scrapling mcp` (audit); the docs page names the console script `scrapling-mcp` (added in 0.4.13 as a shortcut for `scrapling mcp`; both work on current versions) and registers it with `claude mcp add ScraplingServer "<path>/scrapling-mcp"`. A registered MCP server bypasses the Bash gate, so register it only after the owner agrees and keep the per-fetch confirmation.
Say first: "This fetches `<url>` with Scrapling's `<Fetcher>`; no cost, but it contacts that site. Proceed?"

## Verify it works
```
python -c "import scrapling; print(scrapling.__version__)"
```
Expected: the installed version string, no network.

## Uninstall
`pip uninstall scrapling`; the downloaded browser lives in Scrapling's cache under the user profile (path UNVERIFIED), leave it on the owner's triage list.

## License
BSD-3-Clause.

## Source
https://github.com/D4Vinci/Scrapling · MCP docs: https://scrapling.readthedocs.io/en/latest/ai/mcp-server/

Verified on 2026-09-10.
