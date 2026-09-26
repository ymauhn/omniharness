# OmniForge Lab status

Measured on this host, 2026-09-26 (Windows 11 Pro, Node v24.19.0, Python 3.12.14): `npm --prefix omniforge-lab test` → **319/319, zero skipped**; `python -m unittest discover tests` → **390 OK, zero skipped**, both also with %TEMP% reached through a junction alias (commit `f3f781e`) (this includes every Playwright E2E file under `tests/`, run in real Chromium against a fresh synthetic demo server, never the owner's own repository — see `tests/test_omniforge_e2e.py`'s `LabCase`). Rerun either command yourself for a current number; this page names the file that proves each claim so drift is checkable, not the count itself.

## What works

| Feature | Proved by |
|---|---|
| Real agent run in a disposable worktree, live state from hooks/notify | `omniforge-lab/test/engine.test.mjs`; end to end with a fake Claude/Codex CLI in a real browser: `tests/test_omniforge_e2e_agents.py` |
| Diff, gated merge (refuses on conflict, failing test, stale task, dirty root) | `omniforge-lab/test/review.test.mjs`; end to end: `tests/test_omniforge_e2e_review.py` |
| Evidence bundle (test command, exit code, output hash, diff stat, usage, note) per merge attempt | `omniforge-lab/test/review.test.mjs`, `tests/test_omniforge_e2e_review.py` |
| Agentes fleet board (status grid, blocked-first) and kanban by task status | `omniforge-lab/test/fleet.test.mjs` |
| Review panel (diff view, merge button, evidence, running-state gating) | `omniforge-lab/test/review-panel.test.mjs` |
| Versioned scoped memory: edit/history/archive, conflict detection, bounded context brief | `omniforge-lab/test/memory-panel.test.mjs`, `omniforge-lab/test/memory-panel-dom.test.mjs` |
| Workflows: saved per-project DAGs, prompt insert, atomic task creation, no auto-dispatch | `omniforge-lab/test/workflows.test.mjs`, `omniforge-lab/test/workflows-api.test.mjs`, `omniforge-lab/test/workflow-panel.test.mjs` |
| Prompt Copilot (lexical + optional local Laya) and skills catalog search | `omniforge-lab/test/copilot.test.mjs`, `copilot-provider.test.mjs`, `copilot-routing.test.mjs`, `classifier-service.test.mjs`, `classifier-api.test.mjs`, `catalog.test.mjs` |
| Mascot (two skins, three themes, pose/expression controls) | `docs/omniforge/mascot/model.test.cjs` — **not** part of this repo's two CI commands; run it yourself with `node --test docs/omniforge/mascot/model.test.cjs`, or via `scripts/check.ps1` |
| Terminal panes (1–8, layout, replay, cross-project scope) | `omniforge-lab/test/terminal-grid.test.mjs`, `terminal-grid-controller.test.mjs`, `pane-scope.test.mjs`, `pty.test.mjs`, `terminal-output.test.mjs`, `terminal-output-api.test.mjs` |
| Generated mini-tool (review → enable → sandboxed run → rollback) | `omniforge-lab/test/extension-runner.test.mjs`, `extensions.test.mjs`, `extensions-usage-panel.test.mjs` |
| Agent arsenal, in the page next to Agentes (profiles, draft/review/activate/rollback, session-note derivation) | `omniforge-lab/test/arsenal-service.test.mjs`, `arsenal-http.test.mjs`, `arsenal-panel.test.mjs`; end to end: `tests/test_omniforge_e2e.py::LabE2E::test_agent_template_needs_rule_review_before_activation_and_its_pin_never_executes` |
| Provider key vault (Windows Credential Manager, masked metadata) | `omniforge-lab/test/key-vault.test.mjs` |
| Usage figures (four categories, explicit unknown, Codex quota read) | `omniforge-lab/test/usage.test.mjs` |
| Loopback + token auth, DNS-rebinding refusal, route surface | `omniforge-lab/test/server.test.mjs`, `v1-routes.test.mjs` |
| Pack / install / update / rollback / repair / uninstall manager | `omniforge-lab/test/manage.test.mjs`; host evidence in [omniforge/INSTALL.md](omniforge/INSTALL.md) |
| No line over 200 characters in `omniforge-lab/app/*.mjs`; pt-BR user-facing strings | `omniforge-lab/test/app-line-length.test.mjs`, `user-string-quotes.test.mjs` |
| Every relative Markdown link under `docs/` and the root docs resolves | `tests/test_doc_links.py` |

## Closed or pending

Full register with evidence and pass conditions: [omniforge/VALIDATION-PENDING.md](omniforge/VALIDATION-PENDING.md). Summary:

| Row | What it is |
|---|---|
| V-01 | Local Lab and mascot visual/DOM/interaction acceptance in a real browser — deterministic seams pass, but no permitted browser route has observed it yet |
| V-02 | JEV live typed classification — offline-tested; needs the owner to connect a provider account and credits |
| V-03 | Laya resident worker calibrated quality/latency — lifecycle passed, but catalog prompts abstained, so no calibrated result |
| V-04 | Managed native isolation (all-role tool confinement, orphan-descendant cancellation, complete usage) — closed by design for this release, not certified as a sandboxed mode |
| V-05 | Clean-Windows-user install/update/recover — the packaged manager's own host run passed; a truly clean-user/VM run is still pending |
| V-06 | Human-labeled catalog accuracy and the bounded evolutionary pilot — not yet run |
| V-07 | A real, owner-selected session derived into an agent-arsenal profile and used on an actual task |
| V-08 | Engine live acceptance — Claude passed except usage attribution; Codex's engine side passed but the resolved build had no code-mode host, so nothing was edited; a retry with the complete Codex build is deferred behind the weekly allowance |

## Known limitations

- **Codex has no "blocked" hook.** Claude's own `Notification` hook reports a pending permission/elicitation prompt; Codex's `notify` has no equivalent, so `AgentEngine.event()` never sets `state: 'blocked'` from a Codex hook (`omniforge-lab/engine.mjs`, the `Notification` branch). The fallback is a fixed text match on the terminal's own recent output for a short list of known prompt strings (`trust this folder`, `hooks need review`, `approaching rate limits`, `would you like to run/make…`, see the `PROMPTS` table and the `shells.on('terminal', …)` handler) — a redraw of an already-answered prompt can show blocked again until the next Enter or hook, and a prompt phrased differently is missed entirely.
- **Session uncertainty is scoped per project folder, not resolved automatically.** If the Lab cannot confirm a session's process tree is gone (a crash, a restricted-sandbox stop), `WorkspaceStore` marks it `interrupted` and remembers the folder as uncertain; a *new* session in that exact `cwd` is refused until the operator inspects the real process and calls `acknowledge` (`core.mjs`, `uncertainSessions` / `acknowledgeInterruptedSession`). Sessions in other folders are unaffected, and acknowledgement records the operator's own verification — it does not itself resume or kill anything.
- **Usage is sometimes honestly unknown, never assumed zero.** `engine.mjs`'s `claudeUsage`/`codexUsage` report `status: 'unknown'` with a specific reason whenever the CLI's own transcript cannot be read: no matching session file, a Windows transcript path over 260 characters without long-path support, a transcript with no recorded message usage, or (Codex) no `token_count` event yet. A `null` figure in the usage panel means "not observed", not "free".
