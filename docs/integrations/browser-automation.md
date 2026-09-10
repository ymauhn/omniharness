# Browser automation

## What it is
Driving a real browser: reading pages that need JavaScript or a login, filling forms, taking screenshots, checking a UI change.

## When to reach for it
In this order:
1. Claude Browser (the browser pane in the desktop app) and Claude in Chrome (the extension driving the owner's own Chrome, with their logins). Both are provided by the host: zero install, zero key, and the owner watches every click.
2. The installed Playwright 1.62 (Python, `python -m playwright`) for scripted, repeatable checks in tests and `/run`.
3. browser-use: opt-in only, see below. Routing row "Browser": Claude Browser or the installed Playwright; browser-use never by default.

## Cost and keys
Claude Browser and Claude in Chrome: none. Playwright: none. browser-use: MIT library, but every step calls an LLM through your key (`OPENAI_API_KEY` or another provider) and its optional cloud (`BROWSER_USE_API_KEY`) bills usage; that is a second model bill on top of the host session, for a job the host already does with Claude Browser.

## Network and the gate
Claude Browser and Playwright: not gated as tools (they reach the sites you point them at; the safety rules on forms, credentials and purchases still apply). browser-use: no Bash pattern in `harness/settings.json` (it runs inside Python); the AGENTS.md HITL line "browser-use" is the gate, and `"Bash(pip install:*)"` gates the install.

## Install
Claude Browser and Claude in Chrome: nothing; they are on the reference machine. Playwright: already installed (`Version 1.62.0`); browsers via `python -m playwright install chromium` if missing (downloads; confirm first).
browser-use (opt-in):
```
uv add browser-use      # or: pip install browser-use
browser-use skill install
```
plus an LLM key in the environment.

## Activate in OmniHarness
Routing row "Browser". Agent order: Claude Browser for anything interactive or one-off; Playwright when the check must be re-runnable; browser-use only when the owner explicitly wants an autonomous browsing agent and accepts its key cost.
Say first (browser-use only): "This runs browser-use with your <provider> key; every step is one model call billed to that key. Claude Browser can do this without a second key. Proceed anyway?"

## Verify it works
```
python -m playwright --version
```
Expected: `Version 1.62.0`.

## Uninstall
browser-use: `pip uninstall browser-use` (or `uv remove browser-use`). Playwright and the host browsers stay.

## License
Playwright: Apache-2.0. browser-use: MIT (library); model and cloud usage billed separately.

## Source
https://playwright.dev · https://github.com/browser-use/browser-use

Verified on 2026-09-10.
