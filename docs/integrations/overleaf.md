# Overleaf

## What it is

Overleaf's Git bridge: every Overleaf Cloud project is a git remote at `https://git.overleaf.com/<project-id>`, which is how `thesis-review` gets the `.tex` in and the revised `.tex` out.

## When to reach for it

Try first: the author downloads the project zip (or the `.log`) and hands over the files; `thesis-review` takes explicit paths and needs no integration. The git clone is the path when the manuscript is revised more than once: pull, review, push a revision with `REGISTRO_ALTERACOES.md`. The community MCP server mjyoo2/OverleafMCP (`@mjyoo2/overleaf-mcp`, MIT, JavaScript, reads and writes files over the same git bridge) is an opt-in alternative for section-level reads and edits from inside the agent; it adds an npm package and a running process for what `git` and the skill's scripts already do, so it goes through the intake procedure in `docs/integrations/skill-scanner.md` first.

## Cost and keys

Git integration is a premium Overleaf feature (paid subscription of the project owner, or access granted). The git authentication token comes from Account Settings, expires after one year, at most 10 per account; username is `git`. The token is a credential: never paste it in chat or in a file in the repo; the owner enters it at the git prompt or stores it in the git credential helper. The compile gate (`docker pull texlive/texlive`, `latest` tag listed at 2.5 GB on Docker Hub, "about 2 GB" in the skill) is free.

## Network and the gate

Clone, pull and push are network calls; Overleaf's bridge rate-limits automated polling. No ask entry matches `git clone` or `git pull` (name the project and confirm by the AGENTS.md rule); `"Bash(git push:*)"` in `harness/settings.json` gates the push and `"Bash(git commit:*)"` the commit. The compile gate hits `"Bash(docker pull:*)"` and `"Bash(docker run:*)"`. The MCP alternative launches `npx -y @mjyoo2/overleaf-mcp` (network on first run, not in the ask list: confirm by the AGENTS.md rule).

## Install

Nothing to install for the git path (on the reference machine `git` and Docker 29.6.2 were on PATH and no TeX was; `docs/PHASE0_AUDIT.md` section 8 explains why the compile gate runs in Docker). Owner steps, verified from the Overleaf docs:

```
git clone https://git.overleaf.com/<project-id>
```

Username `git`, password = the token from https://www.overleaf.com/user/settings. Branches, symlinks and Git LFS are not supported by the bridge.

MCP alternative (verified from the repo page; the same `mcpServers` shape goes into Claude Code's `.mcp.json`, see `docs/integrations/mcp-servers.md`):

```json
{"mcpServers": {"overleaf": {"command": "npx", "args": ["-y", "@mjyoo2/overleaf-mcp"],
  "env": {"OVERLEAF_PROJECT_ID": "<project-id>", "OVERLEAF_GIT_TOKEN": "<token>"}}}}
```

The token sits in that file: keep `.mcp.json` out of git or use the user scope.

## Activate in OmniHarness

Routing row: **Thesis, paper, revise-and-resubmit** → `thesis-review`. The agent works on the cloned directory: gates first (`facts`, `style`), parecer, one question round, apply confirmed items, `integrity`, then the compile gate from the skill: `docker run --rm -v "$PWD":/w -w /w texlive/texlive latexmk -pdf <main>.tex`, failing on `Overfull`, `undefined`, `Citation .* undefined`; or grep a `.log` the author downloaded from Overleaf. Before the first compile the agent says: "The compile gate pulls `texlive/texlive` (about 2 GB, one time) and runs it in Docker; alternatively hand me the Overleaf `.log`. Proceed?" Before a push: "This pushes the revised chapter to the Overleaf project `<id>`; proceed?" The agent never commits or pushes unasked.

## Verify it works

```
git -C <clone> remote -v
```

Expected: `origin  https://git.overleaf.com/<project-id> (fetch)` and `(push)`. For the compile gate: `docker run --rm texlive/texlive latexmk --version` prints a `Latexmk, John Collins, ...` line (exact version line UNVERIFIED).

## Uninstall

Delete the clone (triage: list it), revoke the token in Account Settings, `docker rmi texlive/texlive`, and remove the `overleaf` entry from `.mcp.json` if the MCP was added.

## License

Overleaf Cloud: proprietary service, git integration on paid plans. mjyoo2/OverleafMCP: MIT. texlive/texlive image: TeX Live's own licenses (LPPL and others).

## Source

https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration.md · https://github.com/mjyoo2/OverleafMCP · https://hub.docker.com/r/texlive/texlive

Verified on 2026-09-10
