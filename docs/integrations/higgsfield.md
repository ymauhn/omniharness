# Higgsfield

## What it is
Image, video, 3D (GLB) and audio generation through the `higgsfield` CLI and its eight skills; every generation spends credits on your Higgsfield account.

## When to reach for it
Only when the deliverable is a generated asset. Try first: the host's own diagram/SVG output for figures, an existing asset in the repo, or a stock file the owner already has. Audit verdict: keep the CLI, every call gated, no MCP by default.

## Cost and keys
Credits per generation, priced by model and resolution on the Higgsfield plan (prices are set by the platform and change; check the account page before quoting a number). Auth is `higgsfield auth login` (browser sign-in, short-lived tokens); no API key file is stored in this repo.

## Network and the gate
Every call reaches the Higgsfield API and bills credits. Gated by `"Bash(higgsfield:*)"` in `harness/settings.json` and by the AGENTS.md HITL line "Higgsfield CLI or MCP". In `evals/cases/hitl-triage/` the CLI is shimmed so no benchmark arm can spend credits.

## Install
CLI (already installed on the reference machine: `higgsfield 1.1.23`, built 2026-08-08):
```
npm install -g @higgsfield/cli
higgsfield auth login
```
Skills: the eight `higgsfield-*` directories (`generate`, `soul-id`, `product-photoshoot`, `brandkit`, `marketplace-cards`, `websites`, `video-explainer`, `youtube-thumbnail`) are already symlinked into `~/.claude/skills/` on the reference machine. Fresh install: `npx skills add higgsfield-ai/skills` (asks; run the AGENTS.md intake procedure first). Upstream now lists a ninth skill, `higgsfield-game-generation`, not on the reference machine.

### Opt-in: the official hosted MCP
An official hosted MCP exists since 2026-04-30 at `https://mcp.higgsfield.ai/mcp` (OAuth sign-in with the Higgsfield account, no API key). It spends the same credits as the CLI and adds no capability the CLI lacks, so it is not part of the harness. If the owner wants it anyway:
```
claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp
```
Credit warning: MCP tool calls are not Bash, so `harness/settings.json` cannot gate them; the only gate is the agent stating the cost and waiting for a yes before each call.

## Activate in OmniHarness
Routing row "Image, video, 3D, audio": `higgsfield` CLI (credits, gated). The agent picks the skill by intent (`higgsfield-generate` for one-off image/video/3D/audio, `-product-photoshoot`, `-marketplace-cards`, `-brandkit`, `-youtube-thumbnail`, `-video-explainer`, `-websites`, `-soul-id` for a trained face), drafts the exact command, then says first:
"This runs `higgsfield <command>`, which spends an estimated N credits on your Higgsfield account. Proceed?"
Face-moderation caveat: the platform refuses some real faces (reference photos and identity-preserving prompts of real people can come back blocked); an own face is expected to go through `higgsfield-soul-id` training first. UNVERIFIED against official docs (observed behaviour); treat a refusal as final rather than retrying with prompt tricks.

## Verify it works
```
higgsfield version
```
Expected: `higgsfield 1.1.23 (<commit>) built 2026-08-08T19:50:15Z` (no network, no credits).

## Uninstall
`npm uninstall -g @higgsfield/cli` (curl install: `sudo rm /usr/local/bin/higgsfield`; brew: `brew uninstall higgsfield`). MCP: `claude mcp remove higgsfield`. Skills: triage list for the owner; never delete the symlinks yourself.

## License
CLI and skills: MIT. The service is a paid platform.

## Source
https://github.com/higgsfield-ai/cli · https://github.com/higgsfield-ai/skills · https://higgsfield.ai/mcp

Verified on 2026-09-10.
