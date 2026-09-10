# ScrapeGraphAI

## What it is
A scraper with an LLM inside: you give it a URL and a natural-language question, it renders the page with Playwright and asks a model to extract the answer.

## When to reach for it
Usually never in this harness: the host session already is the LLM, so WebFetch (which takes a prompt) or Scrapling plus the host model does the same job without a second model bill. Reach for it only for unattended batch extraction where a local Ollama model is acceptable. Audit verdict: skip; documented as opt-in.

## Cost and keys
Two paths. Local: an Ollama model (`ollama` is not installed on the reference machine), free, slower, weaker. Cloud: a provider key (`OPENAI_API_KEY` or similar) billed per token, or the ScrapeGraphAI managed API on pay-as-you-go credits.

## Network and the gate
Every run reaches the target site and, on the cloud path, the model provider. There is no `scrapegraphai` Bash entry in `harness/settings.json` (it runs inside Python), so the AGENTS.md HITL line "ScrapeGraphAI" is the gate; the install step is gated by `"Bash(pip install:*)"`.

## Install
```
pip install scrapegraphai
playwright install
```
Local path additionally needs Ollama running with a pulled model, config `"llm": {"model": "ollama/llama3.2", "model_tokens": 8192, "format": "json"}`. Cloud path: `"llm": {"api_key": "...", "model": "openai/gpt-4o-mini"}`.

## Activate in OmniHarness
No routing row names it. Before proposing it, show the owner the WebFetch-or-Scrapling equivalent and explain why it is not enough (batch size, unattended run). Redundancy rule: if the host model can read the page, ScrapeGraphAI adds cost without adding capability.
Say first: "This runs ScrapeGraphAI on <url>: the local Ollama path is free but needs Ollama installed; the cloud path bills your <provider> key per page. Proceed?"

## Verify it works
```
python -c "import scrapegraphai; print('ok')"
```
Expected: `ok` (no network). A real run needs Ollama or a key and is gated.

## Uninstall
`pip uninstall scrapegraphai`; Playwright browsers stay (shared with the installed Playwright 1.62).

## License
MIT (library). The managed cloud API is a paid service.

## Source
https://github.com/ScrapeGraphAI/Scrapegraph-ai

Verified on 2026-09-10.
