# ai-memory

## What it is

akitaonrails/ai-memory: a local Rust server that captures work through agent lifecycle hooks and exposes it over MCP, so a task started in Claude Code can continue in Codex (or another agent) without re-explaining the architecture.

## When to reach for it

Try first: the repo's `CONTEXT.md` and `docs/adr/` (AGENTS.md "Memory" row: they are the truth) plus the host's own memory for preferences; for a session handoff the mattpocock `handoff` skill already exists. ai-memory adds what those do not: silent capture via hooks, consolidation into wiki pages, and the same store visible to several agents and machines. It earns a slot only when a cross-agent handoff (Claude Code → Codex in the same directory) is actually exercised. Status in this harness: **deferred** (audit section 4: "Defer; run via Docker only if Codex handoff is actually exercised"; section 7 lists it among the things not in the tree).

## Cost and keys

Free, MIT. No API key. Runs a local server (port 49374 on 127.0.0.1 in the Docker recipe).

## Network and the gate

At use time: none (localhost only). Install is network: the wrapper is fetched with `curl` and the server image with `docker run`, which hit `"Bash(curl:*)"`, `"Bash(docker pull:*)"` and `"Bash(docker run:*)"` in `harness/settings.json` and ask. The hook and MCP installers rewrite `~/.claude/settings.json` and the host MCP config: a standing-configuration change, confirm it explicitly and keep the timestamped backups the tool makes.

## Install

Not installed on the reference machine. The README's recommended path (Docker; verified from the README on 2026-09-10):

```
mkdir -p ~/.local/bin
curl -fsSL https://github.com/akitaonrails/ai-memory/releases/latest/download/ai-memory-wrapper -o ~/.local/bin/ai-memory
chmod +x ~/.local/bin/ai-memory
docker run -d --name ai-memory --restart unless-stopped -p 127.0.0.1:49374:49374 -v ai-memory-data:/data docker.io/akitaonrails/ai-memory:latest
ai-memory install-mcp --client claude-code --apply
ai-memory install-hooks --agent claude-code --apply
```

Platform table from the README: Linux, macOS and Windows via WSL2 = Supported; **native Windows = Experimental** (prebuilt zip or source build, PowerShell hooks; `docs/windows.md`). The README's rule: install where the agent runs, and never mix the Windows wrapper with WSL2-launched agents. On this Windows 11 machine the agents run natively, so the supported route (WSL2) means running Claude Code inside WSL2 too; Docker Desktop 29.6.2 is present. Codex wiring is the same pattern (`--client codex`, `--agent codex`, listed in the README).

## Activate in OmniHarness

Routing row: **Memory** → "repo CONTEXT.md and `docs/adr/` are the truth; host memory holds preferences only". ai-memory does not change that row: what it stores is a convenience layer, never the source of truth, and nothing in it overrides AGENTS.md. Before the first install the agent says: "This fetches the ai-memory wrapper with curl, starts a Docker container on localhost:49374 and rewrites my hooks and MCP config (backups are kept). Windows native is Experimental. Proceed?"

## Verify it works

From an agent session with the MCP registered, call the `memory_status` tool (the `docs/windows.md` checklist names it). Expected: a status reply from the local server. UNVERIFIED exact output.

## Uninstall

```
ai-memory uninstall --apply
docker rm -f ai-memory
```

The first removes only ai-memory-installed files and leaves backups; the `ai-memory-data` volume and `~/.local/bin/ai-memory` are listed for the owner, not deleted.

## License

MIT.

## Source

https://github.com/akitaonrails/ai-memory

Verified on 2026-09-10
