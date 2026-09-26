# OmniForge Lab architecture

One page: the processes, the data files, the trust boundaries and where each piece of behaviour lives. For what is proven to work and its test evidence, see [STATUS.md](STATUS.md); for day-to-day notes and host quirks, [omniforge/LAB.md](omniforge/LAB.md).

## Processes

```
 browser tab                     Lab server (server.mjs)                 PTY coordinator (pty.mjs)
 ┌─────────────┐   HTTP + SSE    ┌───────────────────────────┐  spawn()  ┌───────────────────────┐
 │ app/main.mjs│◄───────────────►│ WorkspaceStore (core.mjs)  │◄─────────►│ node-pty child shells │
 │ + panels    │  X-OmniForge-   │ AgentEngine (engine.mjs)   │           │ (interactive terminals│
 └─────────────┘  Token header   │ review.mjs (diff/merge)    │           │  + agent CLI sessions)│
                                 │ workflows/arsenal/extensions│           └───────────┬───────────┘
                                 │ /keys/catalog/classifier    │                       │ argv, no shell
                                 └──────────────┬──────────────┘                       ▼
                                                │ HTTP POST, per-run secret   ┌───────────────────┐
                                                │ (never the launch token)   │ claude.exe / codex │
                                 ┌──────────────┴──────────────┐            │  in its own worktree│
                                 │ agent-hook.mjs (short-lived) │◄───────────┤  (Claude --settings │
                                 │ relays one lifecycle event   │  hook/     │   or Codex notify)  │
                                 │ then always exits 0          │  notify    └───────────────────┘
                                 └───────────────────────────────┘
```

- **Lab server** (`server.mjs`) is the composition root: one Node `http` server, loopback-only, that serves the static page and its ES modules, answers the JSON API, and streams state/terminal/agent/evidence events over one `/api/events` Server-Sent-Events connection. It owns the long-lived services below and wires their events to `broadcast()`.
- **PTY coordinator** (`pty.mjs`, class `PtyCoordinator`) is the only thing that spawns child processes with a pseudo-terminal (`node-pty`). It is used two ways: a plain interactive shell opened from the workspace UI, and — from `engine.mjs` — the `claude`/`codex` executable itself, so an agent run *is* a PTY session like any other, just with extra env vars and a fixed argv.
- **Agent CLIs** (`claude.exe` / `codex.exe`) run as that PTY child, `cwd` set to a disposable git worktree, native login only (no key is copied in). Claude gets `--session-id`, `--settings <throwaway file>` and the task prompt as argv; Codex gets `--no-daemon -C <worktree> -c notify=[...]` and the prompt. Both receive `OMNIFORGE_RUN_ID`, `OMNIFORGE_RUN_TOKEN` and `OMNIFORGE_HOOK_URL` as environment variables only.
- **Hook relay** (`agent-hook.mjs`) is the file both CLIs are told to invoke on their own lifecycle events (Claude's `UserPromptSubmit`/`PreToolUse`/`Notification`/`Stop` hooks piped on stdin; Codex's `notify` with the payload as its last argv element). It does one `fetch` of the Lab's `/api/agent-events` with the run's token, has a 3-second hard timeout, and always exits 0 — it must never be able to block or fail the agent it reports on.
- **Python children**: `harness/catalog_api.py`-style scripts for the skills catalog (`catalog-service.mjs`, one JSON request/response over stdio per query), `harness/classifier_worker.py` for the optional local Laya model (`classifier-service.mjs`, spawned only after the operator explicitly enables it, PyTorch imported lazily inside its own `main()`), and a Python bootstrap for the agent arsenal (`arsenal-service.mjs`). None of these ever runs the owner's task; they only serve read/query data to the page.
- **Extension runner** (`extension-runner.mjs` + `extension-sandbox.mjs`) spawns a separate Node process with `--permission` (read access to its own sandbox file only) that evaluates a generated mini-tool's `check(input)` inside a fresh V8 `vm` context with code generation disabled in both the parent and sandboxed realm. This is the one place untrusted generated code executes.

## Data files

Everything below lives under `dataDir` (default `<repo>/.omniforge-lab/`, overridable with `OMNIFORGE_DATA_DIR`, gitignored) unless noted otherwise. Writes go through `lib/fsutil.mjs`'s atomic/durable helpers.

| Path | Owner | Holds |
|---|---|---|
| `state.json` (+ `.bak`, `.lock`) | `core.mjs` `WorkspaceStore` | projects, sessions, tasks, notes (with history), `memoryRevision`, terminal `layout`, `workflowRegistry` — the one file an exclusive lock protects against a second Lab process |
| `runs.json` | `engine.mjs` `AgentEngine` | one record per agent run: host, worktree, branch, base SHA, state, timestamps, usage |
| `evidence/<taskId>.json` | `review.mjs` | every merge attempt for that task (accepted or refused), test result, diff stat, usage, reviewer note |
| `runs/<runId>/claude-settings.json` | `engine.mjs` | the throwaway Claude hooks file for exactly one run |
| `worktrees/<8-char id>/` | `engine.mjs` (via `git worktree add`) | the disposable checkout + branch a run edits; the project's real repo only grows a `.git/worktrees/` entry, its working tree is never touched until merge |
| `extensions/<projectId>/…` | `extensions.mjs` | versioned generated mini-tool manifests and source |
| `keys.json` | `key-vault.mjs` | masked provider key metadata only; the secret itself goes to the Windows Credential Manager |
| `skill-catalog.json` | `catalog-service.mjs` | the skills-graph snapshot the page's catalog view reads |
| `arsenal/<projectId>.json(.lock)` | `arsenal-service.mjs` | the project-bound agent arsenal registry |

Outside `dataDir`: `.omniharness/runtime/laya-multilingual/<rev>/` is the opt-in local Laya checkpoint; usage reconciliation *reads* (never writes) `~/.claude/projects/**/<session>.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl`, the CLIs' own transcript files. A run's `usage.inputTokens` excludes cache reads on every host: Claude reports it that way, and for Codex, whose `input_tokens` include cached input, the engine stores `input_tokens - cached_input_tokens` (never negative); cache reads are `cacheReadTokens`.

## Trust boundaries

1. **Loopback + exact Host check.** The server binds `127.0.0.1` only, and every request's `Host` header must equal the exact `127.0.0.1:<port>` the server printed at startup or it is refused — a DNS-rebinding defense, since the printed port is the only thing a same-origin check has to go on.
2. **Launch token, not a cookie.** The page keeps its random per-launch token in port-scoped `localStorage` and sends it as `X-OmniForge-Token` (or, for the one route `EventSource` cannot add a header to, as a query parameter on `/api/events`). No cookie is used, because a browser sends cookies to *every* port on `127.0.0.1`, so another local service could read one. The page itself (`/`, `/app/*.mjs`, panel modules, vendor assets) is unauthenticated static content — it holds no secret.
3. **Per-run hook secret, separate from the launch token.** Each agent run gets its own random secret, handed to the CLI process only as an environment variable and checked with a timing-safe comparison. A hook event can move only that run's own state. `/api/agent-events` is the one route that accepts *this* secret instead of the launch token, because the external CLI process never has the launch token.
4. **argv-only spawning, never a shell.** `engine.mjs`, `review.mjs` and `pty.mjs` always call `execFile`/`spawn` with an argv array; a task title, branch name or prompt is never interpolated into a shell string, so it cannot break out via quotes, `&` or backticks. On Windows, only an absolute `.exe` path is accepted for the agent executables — a `.cmd`/`.bat` shim is refused, because that would run through `cmd.exe`. The one deliberate exception is the merge's optional test command: it is a command line the owner typed, so `review.mjs` runs it with `powershell.exe -NoProfile -Command` (argv, bounded output, timeout); no task or agent text is ever placed in it.
5. **Merge stays inside plain git operations.** `review.mjs` never resets, force-pushes or deletes a branch/worktree; only `git merge` and `git merge --abort` touch the owner's real working tree, guarded by strict commit identity (`user.useConfigOnly`), a clean/on-branch check before *and* after the test command runs, and a scan for untracked or ignored files the merge would silently overwrite. No repository hook runs in any of its git calls: each passes `-c core.hooksPath=<review.mjs itself>` (a file, which can hold no hooks; the command line outranks every config file) and the commit and merge also pass `--no-verify`, so a pre-commit hook (lint-staged, or one the agent wrote in an ignored husky folder) cannot stage unreviewed content and a post-commit hook cannot add commits. After its commit the gate still refuses unless the commit's tree is the tree the owner reviewed.
6. **Extension containment, not a certified sandbox.** A generated mini-tool runs in a separate Node process under `--permission` (no file writes, reads limited to the sandbox script, no child processes or workers), in a `vm` context without host objects and with string code generation disabled, with a memory cap, a deadline and an output bound. Node 24 cannot deny sockets; the context simply never receives a reference that could open one. See the `ponytail:` note in `omniforge-lab/extension-runner.mjs`.
7. **The owner's own CLI profile is never rewritten.** A run's Claude hook wiring is a throwaway `--settings` file passed just for that process; Codex's `notify` override is scoped to that one `--no-daemon` invocation. Neither touches `~/.claude/settings.json` or the user's own Codex config.

## Module map

| Module | Role |
|---|---|
| `server.mjs` | composition root: HTTP routes, SSE broadcast, wires every service below |
| `core.mjs` | `WorkspaceStore` (state.json), skills listing, project asset inventory |
| `pty.mjs` | `PtyCoordinator`: spawns and tracks every PTY child, plain shell or agent |
| `engine.mjs` | `AgentEngine`: worktree/branch creation, agent launch, hook/prompt-text state machine, usage reconciliation from the CLIs' own transcripts |
| `agent-hook.mjs` | the hook/notify relay script the CLIs themselves invoke |
| `review.mjs` | `createReview`: diff, gated merge, evidence bundle |
| `workflows.mjs` | saved task DAGs and prompt snippets (`workflow-panel.mjs` mounts its UI) |
| `arsenal-service.mjs` + `arsenal-http.mjs` | agent arsenal registry and its routes (`arsenal-panel.mjs` UI) |
| `extensions.mjs` + `extension-runner.mjs` + `extension-sandbox.mjs` | generated mini-tool lifecycle and its sandboxed execution |
| `key-vault.mjs` | provider key storage (Windows Credential Manager + masked metadata) |
| `catalog-service.mjs` | skills-graph catalog queries via a Python child |
| `classifier-service.mjs` + `copilot-classification.mjs` | optional local Laya classifier lifecycle and prompt classification |
| `usage.mjs` | Codex quota read and the four-figure usage summary |
| `terminal-output.mjs` | bounded terminal output buffer shared by SSE and replay |
| `lib/fsutil.mjs` | the one durable/atomic file-write helper every service above uses |
| `lib/git-env.mjs` | drops inherited git location variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, …) from the Lab's own git calls, agent launches and the merge's test command |
| `app/main.mjs` | page composition root: builds every panel, owns the one `EventSource` |
| `app/state.mjs`, `app/dom.mjs` | shared page state, `api()`/`connect()`, small DOM helpers |
| `app/workspace.mjs`, `app/tasks.mjs`, `app/fleet.mjs`, `app/review-panel.mjs`, `app/graphs.mjs`, `app/assets.mjs`, `app/navigation.mjs` | one page view each: terminals, task list, Agentes fleet/kanban, diff/merge panel, the three graphs, asset inventory, view switching |
| `copilot.mjs`, `memory-panel.mjs`, `workflow-panel.mjs`, `extensions-panel.mjs`, `usage-panel.mjs`, `arsenal-panel.mjs`, `terminal-grid.mjs` | sibling panel modules `app/main.mjs` mounts alongside the `app/*.mjs` views |
