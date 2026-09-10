# ADR 0003: the gate is a permissions ask list plus one guard hook; checkpoints are git tags; deletion is triage

Date: 2026-09-10. Status: accepted.

## Context

The mission requires that network calls, web automation and credit-consuming tools never run silently, that nothing is deleted blindly, and that Gauntlet cycles keep git checkpoints for rollback. The audited machine had a working precedent: three stdlib Python hooks and a deny/ask permissions block in one project, whose commands invoked `python3` (the Microsoft Store stub on Windows). Claude Code loads project hooks from `settings.json`; Codex reads a same-shaped `hooks.json`; Hermes has no hooks. Gauntlet hunters delete their own probe files dozens of times per run.

## Decision

The gate is `harness/settings.json`: `permissions.deny` for secrets and key files; `permissions.ask` for `git push`, `git commit`, recursive deletes, `higgsfield`, `scrapling`, `agent-reach`, `firecrawl`, `pip`, `pipx`, `npm -g`, `npx skills add`, `docker pull`, `docker run`, `curl` and `wget`. Single-file `rm` stays free so hygiene never prompts. `harness/guard_bash.py` hard-blocks the handful of commands no confirmation should rescue (`rm -rf` on a root or HOME, force push without lease, hard reset to a remote, disk formatting, download piped into a shell, `DROP TABLE`, `del /s /q` on a drive root). The hook is wired with `python`, not `python3`. The owner chose the global scope: the fragment is merged into `~/.claude/settings.json`. On hosts without hooks the AGENTS.md section is the enforcement.

A checkpoint is `git tag -f ckpt/<case>/<ts> $(git stash create || git rev-parse HEAD)`; the harness never commits, and `evals/run.py record` refuses a paid result without the tag. Deletion is never automated: the harness prints a numbered triage list and stops; replaced copies keep a `.pre-omniharness` suffix.

## Consequences

The ask list prompts on every gated command in interactive sessions and shows up as `permission_denials` in headless runs, which is the testable signal in benchmark B3. PowerShell forms are covered by the ask list, not by the regex. Adding an item to the gate is a one-line edit in one file.
