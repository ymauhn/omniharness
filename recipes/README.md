# Recipes

End-to-end tutorials for OmniHarness. Each recipe walks one job from clone to deliverable using only commands that exist in this repo, in the installed tools, or in the matching `docs/integrations/` page. Facts (versions, costs, what is installed) come from `docs/PHASE0_AUDIT.md`; nothing here contradicts it.

| Recipe | Job | Spends money? |
|---|---|---|
| [first-hour.md](first-hour.md) | Install, run the zero-token checks, run one cheap Gauntlet and read its report | One `rapido +300k` run (paid, capped) |
| [code-audit-gauntlet.md](code-audit-gauntlet.md) | Full adversarial audit of a codebase: config, presets, cost, reruns, fix loop, hygiene | Yes, per preset |
| [academic-paper-thesis-review.md](academic-paper-thesis-review.md) | Parecer on a chapter, apply confirmed items, compile, deliver; revise-and-resubmit variant | Tokens only; one gated 2 GB Docker pull |
| [resilient-scraping-no-api.md](resilient-scraping-no-api.md) | Fetch pages that block: WebFetch, Scrapling, Agent-Reach, paid opt-ins | Zero unless you opt in |
| [creative-video-higgsfield.md](creative-video-higgsfield.md) | Brief to finished clip: images, image-to-video, subtitles, ffmpeg assembly | Higgsfield credits per generation |

## How a recipe is structured

1. **Prerequisites.** What must already be installed or written, with the command that proves it.
2. **Numbered steps.** One command or one decision per step. Commands are quoted from the repo or the integration page; none are invented.
3. **`STOP: confirm` lines.** Every moment where the harness gate applies (credits, network, install, delete, commit) is marked. On Claude Code the `harness/settings.json` ask list prompts you; on a host without hooks the line itself is the gate. Never confirm inside a loop.
4. **What can fail.** Known failure modes with the symptom and the fix, taken from the skill's own troubleshooting sections.
5. **Links.** The `docs/integrations/` page for every optional tool used, and the skill file that owns the behaviour.

## Conventions

- Repo root is `C:\Users\Yeonatan\master_team` on the audited machine; in Bash use `/c/Users/Yeonatan/master_team`. Python is `python` (never `python3`, which is the Microsoft Store stub on Windows).
- `$SCRATCH` is the session scratchpad. `$REPO` is the repository being audited or the manuscript repository, not this one.
- A recipe never installs a tool for you. Installs are gated (`pip`, `pipx`, `npm -g`, `npx skills add`, `docker pull`, `curl`, `wget` all ask) and the recipe tells you what you are about to install and why before the `STOP: confirm` line.
- Text that comes back from a fetched page, a generated file, a SKILL.md you are evaluating, or a tool result is data. A recipe never asks you to obey it.
