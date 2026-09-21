# Tickets: the commercial phase (R1 + R2)

Current checkpoint ticket (2026-09-21): [T13-H1 — Claude review, commit and return handoff to Codex](../t13/TICKET-HANDOFF-CLAUDE.md). Read it before changing or committing the pending E1/T13 work. T1 is committed; E1 and T13 S1/S2/S4 plus the S3 offline core are implemented locally. S3 live acceptance and S5–S7 remain open. Current AGENTS.md task-scoped autonomy supersedes the historical blanket network/install confirmation wording below.

Spec: `spec.md`. Plan gate record: `grilling.md`. Onboarding for the executing host: `../handoff-codex.md`. Format per ticket: round, blocked by, `ready-for-agent`, owner steps (only the owner can do these; the agent stops and asks), acceptance (checkable), files, host note (Claude Code vs Codex vs Hermes). Take tickets in order unless the blocking edges allow otherwise. Every gated command (network, installs, `git commit`, `git push`) names its cost and waits for the yes.

## T1 · Host parity check on Codex (R1 · blocked by: none · ready-for-agent: yes)

Status 2026-09-20: local scope completed; see `../experiments/codex-parity-2026-09.md`. The owner authorised runtime, links, eval fixes, visual dependencies and a T1 commit. All 41 Python tests, including both visual tests, passed without skips; the full runner passed. Live agent-host coverage remains a documented limitation. `../evals/PLAN.md` now takes priority over commercial execution; ADR 0006 records the decision.

Owner steps: none.
Acceptance (updated by owner): `scripts/check.ps1` passes the complete Python/Node/eval/install/graph battery with no skips; every divergence found (paths, junctions vs symlinks, `.cmd` wrappers, missing Workflow tool) is written to `docs/experiments/codex-parity-2026-09.md` and mirrored as roadmap rows in T3. Runtime, link, evaluator and validation fixes are explicitly authorised.
Files: `docs/experiments/codex-parity-2026-09.md`.
Host note: this ticket is the portability test itself; on Codex the scout fan-out is the one-by-one WebSearch path, the Gauntlet driver and the impeccable plugin are Claude-only (report their absence, do not emulate).

## T2 · Authors section: cards, positioning, placeholders (R1 · blocked by: T1 · ready-for-agent: yes)

Owner steps: send names, one-line role, bio (2–3 sentences), photo file, and the GitHub, LinkedIn, Lattes and Scholar URLs for each author; until then the card keeps a named placeholder.
Acceptance: the `#authors` section renders N cards from one markup pattern (`.author`: photo slot that falls back to the avatar symbol when the file is absent, name, role, bio, links with `aria-disabled` while empty); the section lede states, in the owner's approved wording, that OmniHarness was conceived and developed by researchers in machine learning and artificial intelligence (geometric deep learning, graph neural networks, agentic systems engineering) and PT-BR entries exist for every new string in `site/i18n/pt-BR.json`; `PRODUCT.md` carries the authorship line; `python -m unittest tests.test_visual` stays green at 1440 and 390 with `lang_untranslated == 0`; `site/DESIGN.md` gains the card as a component only if its treatment differs from the existing `.author`.
Files: `site/index.html`, `site/i18n/pt-BR.json`, `PRODUCT.md`, `site/showcase/log.md`.
Host note: on Codex apply `site/DESIGN.md` by hand; the impeccable detector and critique run only on Claude Code, so leave a line in the log for a later pass.

## T3 · Roadmap: Linux-first parity and thesis-review as a rigour auditor (R1 · blocked by: T1 · ready-for-agent: yes)

T1 follow-up rows (2026-09-20, not shipped): live Codex/Claude guard interception parity; POSIX execution of the revised installer; complete Codex plugin inventory in the graph; unclosed file-handle ResourceWarnings in graph tests. Visual dependencies and execution are now required locally. Evidence: `../experiments/codex-parity-2026-09.md`. The academic scope now follows ADR 0006's broader controlled-research direction, after eval integrity work.

Owner steps: none.
Acceptance: `docs/roadmap.md` exists with dated rows, each labelled `not shipped`, for (a) Linux-first parity: POSIX path normalisation in `scripts/install.py`, an `install.sh`, executables decoupled from `.cmd` wrappers, symlinks where Windows uses junctions, plus every row T1 found; (b) thesis-review as a scientific-rigour auditor: repository results cross-check (clone behind the gate, locate result files, compare to the manuscript's tables), conference style rules for IEEE, ACM, SBC and Beamer as `references/`, mathematical consistency as an LLM rubric (explicitly not deterministic); (c) the members area items of R2. The portal's vault list "On the roadmap, not shipped" links to the file; README's tree lists it; nothing in `.agents/skills/thesis-review/SKILL.md` claims any of (b).
Files: `docs/roadmap.md`, `README.md`, `site/index.html` (one link), `site/i18n/pt-BR.json`.
Host note: none.

## T4 · Library structure and validator (R1 · blocked by: T1 · ready-for-agent: yes)

Owner steps: none.
Acceptance: `site/library/{guides,flows,prompts}/` exist with the shapes in `spec.md`; `tests/test_library.py` validates every file (fields, `lang` in the two values, slides split on `---`, `tested.run` requires `cost_usd`) and fails on a planted bad fixture; three demonstration items exist, one per kind, in both languages, labelled `template, not tested`; `scripts/site_build.py` reads the library and lists it in the members rows (locked until T6 ships) without changing the public edition's weight by more than 5 KB.
Files: `site/library/**`, `tests/test_library.py`, `scripts/site_build.py`.
Host note: none.

## T5 · Supabase project and auth providers (R1 · blocked by: T1 · ready-for-agent: partly, the agent writes the checklist and the SQL, the owner executes the console steps)

Owner steps (checklist the ticket prints, in this order): create the Supabase project; copy the project URL and anon key into `site/auth.json`; in Google Cloud Console create an OAuth client with the Supabase callback URL and paste ID and secret into Supabase Auth; in GitHub Developer Settings create an OAuth app the same way; enable the email provider with magic links; set Site URL `https://ymauhn.github.io/omniharness/` and add `http://localhost:8000/` to the redirect allow-list; run `supabase/schema.sql` in the SQL editor; insert the first `members` row (your own account, after your first sign-in).
Acceptance: `supabase/schema.sql` creates `members`, `guides` and the R1 RLS policy and is idempotent (`create table if not exists`, `create policy` guarded); `docs/integrations/supabase.md` follows the one-page template (cost, gate entry, install state, the checklist above, the URLs read with dates); `site/auth.json` is present with the anon key and a comment that it is public by design; `.gitignore` excludes any `SUPABASE_SERVICE_KEY` file; no secret is committed (`git grep -i "service_role"` finds only docs).
Files: `supabase/schema.sql`, `docs/integrations/supabase.md`, `site/auth.json`, `.gitignore`.
Host note: none.

## T6 · Sign-in modal, auth state and the honest member gate (R1 · blocked by: T4, T5 · ready-for-agent: yes for the stubbed part, the live check waits on T5)

Owner steps: sign in once with each method on the live page and confirm; add your account to `members`.
Acceptance: `supabase-js` UMD pinned from jsDelivr with an integrity hash, deferred; `<html data-auth>` in `out | in | member`; header control and `#auth` modal with Google, GitHub and magic link (email field, "check your inbox" state, error text that says what to do), focus trap, Escape, reduced motion, PT-BR entries; the `<template data-members>` bodies are gone from `site/index.html` and `node tests/test_site.js` asserts no member body in either edition; after `member`, the library fetches `guides` for the current language and renders them with `md()`; `window.__portal.auth(stub)` drives the states and `tests/visual/shoot.py --states` captures `out`, `in` (locked rows visible), `member` (a guide open) with `test_visual.py` asserting 0 console errors, 0 overflow and the lock text present or absent per state; a real sign-in with each provider on the live page is recorded in `site/showcase/log.md` by the owner's word; `scripts/site_build.py --push-guides` upserts the library through REST with the service key from the environment, prints the count, and asks before the network call.
Files: `site/index.html`, `site/i18n/pt-BR.json`, `scripts/site_build.py`, `tests/visual/shoot.py`, `tests/test_visual.py`, `tests/test_site.js`.
Host note: the design pass (impeccable critique, audit, finish reviewer) runs on Claude Code; on Codex ship against `site/DESIGN.md` and leave the pass as the first item of T7's log entry.

## T7 · R1 closure: battery, showcase, usage report (R1 · blocked by: T2, T3, T4, T6 · ready-for-agent: yes)

Owner steps: the yes to commit and push; the yes to redeploy Pages (a push of `site/public` does it).
Acceptance: all zero-token tests green; detector 0 when a Claude session is available; `site/showcase/log.md` and `docs/benchmarks.md` carry the measured numbers; the members artifact is republished as a mirror or the log says why not; token usage for R1 reported against the 4 M ceiling (main loop and subagents, measured, not estimated); the tree is clean after the commit.
Files: `site/showcase/log.md`, `docs/benchmarks.md`, `site/public/`.
Host note: none.

## T8 · Asaas sandbox, integration page, fees quoted (R2 · blocked by: T7 · ready-for-agent: partly)

Owner steps: create the Asaas sandbox account; generate the API key and the webhook access token; fix the monthly and annual prices; approve the fetches of the Asaas docs (WebFetch, zero cost).
Acceptance: `docs/integrations/asaas.md` quotes the subscription API, the hosted checkout, the webhook event names, the Pix and card fees and the sandbox way of confirming a payment, each with URL and date read; the plan prices appear only when the owner fixed them, otherwise `to be defined`; `harness/settings.json` gains no new pattern (the calls come from Edge Functions, so the AGENTS.md list is the enforcement, stated in the page).
Files: `docs/integrations/asaas.md`, `docs/catalog/free-tiers.md`.
Host note: none.

## T9 · Edge Functions: checkout and webhook, with a zero-token test (R2 · blocked by: T8 · ready-for-agent: yes)

Owner steps: install the Supabase CLI or approve `npx supabase` (gated); set the function secrets (`ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`) through the CLI; approve the deploy.
Acceptance: `supabase/functions/_shared/asaas.js` (plain ESM, no Deno API) maps events to `{status, current_period_end}` and is idempotent; `node --test tests/test_asaas.js` covers confirmed, received, overdue, cancelled and an unknown event, and fails on a bad token; `supabase/functions/asaas-webhook/index.ts` validates `asaas-access-token`, calls the shared mapper and updates `subscriptions` with the service key; `supabase/functions/asaas-checkout/index.ts` requires a signed-in user, creates or reuses the customer and subscription and returns the hosted checkout URL; `schema.sql` gains `subscriptions` and the R2 RLS policy; the webhook URL is registered in the Asaas sandbox by the owner and one sandbox event reaches the function (log line quoted).
Files: `supabase/functions/**`, `supabase/schema.sql`, `tests/test_asaas.js`.
Host note: Deno runs only inside Supabase; the local test is Node, by design.

## T10 · Checkout flow on the page and the subscription gate (R2 · blocked by: T9 · ready-for-agent: yes)

Owner steps: complete one sandbox payment (Pix and card) with the sandbox's test means; the agent never enters payment data.
Acceptance: the `#crew` vault column shows the two plans (prices or `to be defined`), a signed-in user clicks one, the page calls `asaas-checkout` and redirects to the hosted checkout, returns to `?checkout=return`, and polls `subscriptions` until `active` or a timeout message that says what to do next; the RLS policy on `guides` now uses `subscriptions` plus the allow-list; a lapsed subscription (owner flips `status` in the table) locks the library on the next load; visual states `checkout` and `active` captured with the stub; PT-BR entries; no invented number on the page.
Files: `site/index.html`, `site/i18n/pt-BR.json`, `supabase/schema.sql`, `tests/visual/shoot.py`, `tests/test_visual.py`.
Host note: same as T6.

## T11 · Restricted content: guides, flows, prompts (R2 · blocked by: T4, T6 · ready-for-agent: yes)

Owner steps: approve the five `claude -p` runs that test five prompts (cost named first, about the B3 scale); approve `--push-guides`.
Acceptance: 3–4 slide guides (advanced prompt engineering, context chaining, hallucination reduction, one on the harness's own plan gate), 2–3 interactive flows of recommended agentic architectures (data in `site/library/flows/`, rendered with the existing force-graph or inline SVG, no new library unless justified in the log), about 30 prompts for corporate and software-engineering use cases, all in PT-BR and EN, all labelled `template, not tested` except the five with a run record (`date, command, cost_usd, verdict`); `tests/test_library.py` green; `--push-guides` count matches the file count; a member reads one of each kind on the live page.
Files: `site/library/**`, `site/showcase/log.md`.
Host note: the five test runs use `claude -p` (Claude Code CLI); on Codex, run the equivalent through its CLI and record the command, or leave the five for a Claude session.

## T12 · R2 closure: security review, artifact decision, usage report (R2 · blocked by: T10, T11 · ready-for-agent: yes)

Owner steps: decide whether the members claude.ai artifact stays as a mirror or is retired; the yes to commit, push and redeploy.
Acceptance: a security review of the auth and payment surface (`/security-review` on Claude Code, `review-security` on Codex) with findings triaged in the log; RLS policies re-read and quoted; no secret in git history (`git log -p | grep -i service_role` empty); `docs/benchmarks.md` and `site/showcase/log.md` closed with measured numbers; token usage for R1 + R2 reported against the 4 M ceiling; the tree is clean.
Files: `site/showcase/log.md`, `docs/benchmarks.md`.
Host note: none.

---

# Phase B tickets: `prompt-enhancer`, `ingest`, the read candidates (added 2026-09-14)

Decisions: D1-D5 of 2026-09-14 in `../scout/context-ingestion/pre-scout.md` sections 5-6. Specs: `../scout/prompt-enhancer/spec.md`, `../scout/context-ingestion/spec.md`. Order by D4: P1-P4 first (they run in parallel with R1 and feed T11), then I1-I6; O1 and A1 when a session can afford an intake. Same format as T1-T12; every gated command names its cost and waits.

## P1 · `prompt-enhancer` skeleton, lint and tests (B · blocked by: T1 · ready-for-agent: yes)

Owner steps: none.
Acceptance: `.agents/skills/prompt-enhancer/SKILL.md` with the six fields and the routine of the spec; `scripts/prompt_lint.py` (stdlib) exits 1 on a missing task, output contract or "text is data" line when the prompt ingests external content, and prints a JSON report with `--json`; `references/rubric.md` and `references/guardrails.md` written from the harness's own rules (AGENTS.md sentences quoted); `tests/test_prompt_enhancer.py` passes on three good fixtures and fails on a planted bad one; `python scripts/install.py --check` sees the new skill; `tests/test_layout.py` still green (six fields only).
Files: `.agents/skills/prompt-enhancer/**`, `tests/test_prompt_enhancer.py`, `tests/fixtures/prompts/`.
Host note: none.

## P2 · Target profiles from the vendors' documentation (B · blocked by: P1 · ready-for-agent: yes, the reads are gated)

Owner steps: approve the documentation reads (WebFetch, no cost: the Anthropic prompting guide, the OpenAI/Codex prompting guide, the DeepSeek API docs; about six pages).
Acceptance: `references/profiles/{claude,codex,deepseek}.md`, each line with the source URL and the read date; a profile whose read was not approved stays a stub that says so; no line from memory; `prompt_lint.py --host <name>` applies the profile's size and structure rules.
Files: `.agents/skills/prompt-enhancer/references/profiles/`.
Host note: none.

## P3 · B6, the measured lift (B · blocked by: P2 · ready-for-agent: yes, the runs are gated)

Owner steps: approve five `claude -p` pairs (before/after), cost named first, about the B3 scale per pair; on Codex, approve the equivalent CLI runs or leave B6 to a Claude session.
Acceptance: `evals/cases/prompt-enhancer/` with the five pairs and `scripts/grade.py` scoring; `docs/benchmarks.md` gains B6 with the per-pair scores, cost, wall clock and the losses as well as the gains; `python evals/run.py regress` includes it.
Files: `evals/cases/prompt-enhancer/**`, `docs/benchmarks.md`, `.agents/skills/prompt-enhancer/scripts/grade.py`.
Host note: `claude -p` is Claude Code's CLI.

## P4 · Register `prompt-enhancer` (B · blocked by: P1 · ready-for-agent: yes)

Owner steps: the yes to commit.
Acceptance: `skills-graph.toml` edges per the spec (`guided-by` writing-for-agents, `feeds` scout and thesis-review, `alternative-to` skill-creator at the description level), `skills_graph.py build` and `check` clean; an AGENTS.md routing row "Refine a prompt or directive | `prompt-enhancer`"; the portal's run log gains the row (public) and T11 cites the skill for the library prompts; `site/showcase/log.md` entry.
Files: `.agents/skills/skills-graph/skills-graph.toml`, `AGENTS.md`, `site/index.html`, `site/i18n/pt-BR.json`.
Host note: the impeccable detector runs on the portal edit in a Claude session.

## I1 · `ingest` skeleton, export parsers, FTS index, tests (B · blocked by: T1 · ready-for-agent: yes)

Owner steps: none for the fixtures; later, your own exports (Instagram "Download your information", WhatsApp "Export chat") placed under `context/exports/` (gitignored).
Acceptance: `.agents/skills/ingest/` with SKILL.md (six fields) and `scripts/ingest.py --route=export` (default) parsing the Instagram saved-posts JSON by schema discovery and the WhatsApp chat text with one regex per known locale format, into `context/inbox/<source>.jsonl` with the record shape of the spec; SQLite FTS5 index at `context/index.db`; `ingest query` returns cited records; `tests/test_ingest.py` covers every parser and the index on synthetic fixtures; `.gitignore` covers `context/`; a test greps the tree for export files, cookies and tokens.
Files: `.agents/skills/ingest/**`, `tests/test_ingest.py`, `tests/fixtures/ingest/`, `.gitignore`.
Host note: none.

## I2 · Media: reel URL to transcript, locally (B · blocked by: I1 · ready-for-agent: yes, the download is gated)

Owner steps: approve each yt-dlp batch (count named); approve `pip install faster-whisper` if absent (`docs/integrations/faster-whisper.md`); ffmpeg on PATH.
Acceptance: `ingest media --batch <n>` downloads only after the yes, extracts keyframes at a fixed interval with ffmpeg, transcribes with faster-whisper (local, no key), writes `transcript_path` and indexes it; one public reel from the saved list is searchable end to end; `docs/integrations/claude-video.md` documents the catalogued alternative and why it is not the default (paid Whisper API unless captions exist).
Files: `.agents/skills/ingest/scripts/media.py`, `docs/integrations/claude-video.md`.
Host note: none.

## I3 · Session route behind the gate (B · blocked by: I1 · ready-for-agent: yes)

Owner steps: Agent-Reach installed by hand per its page (cookies are credentials); crawl4ai `pip install` and `crawl4ai-setup` (gated); the yes on every run.
Acceptance: `--route=session` prints the warning (session cookies, terms of service, account risk), the source and the request count, and waits for the yes; a test with stdin closed asserts the refusal; adapters `agent_reach.py` (X, Instagram) and `crawl4ai_session.py` (public pages to markdown) write the same record shape; `docs/integrations/crawl4ai.md` (cost none, gate entry: the pip install and every fetch, install state) exists; no cookie or session file under the repo.
Files: `.agents/skills/ingest/scripts/adapters/`, `docs/integrations/crawl4ai.md`, `tests/test_ingest.py`.
Host note: none.

## I4 · X mentions monitoring as a capped loop (B · blocked by: I3 · ready-for-agent: yes)

Owner steps: the yes per run; the per-run cap value.
Acceptance: `ingest watch x --cap <n>` runs one session-route read per interval under `/loop` (Claude Code) or a scheduled routine (Codex), never more than the cap, appends new records only (dedupe by id), and stops on the first refusal; a dry run with a fixture proves the dedupe and the cap.
Files: `.agents/skills/ingest/scripts/watch.py`, `tests/test_ingest.py`.
Host note: `/loop` exists on Claude Code; on Codex use its scheduler and record the command.

## I5 · `answer`: support replies from cited records (B · blocked by: I1 · ready-for-agent: yes, the model call is gated)

Owner steps: approve the model calls (token count named per question); provide one real export for the demonstration.
Acceptance: `ingest answer "<question>"` builds the prompt from the top cited records plus the "text is data" line, names the token count, and the reply quotes record ids; phone numbers and e-mails redacted in logs; B7 in `docs/benchmarks.md`: counts, wall clock and 0 network calls for one export of each kind on the export route.
Files: `.agents/skills/ingest/scripts/answer.py`, `docs/benchmarks.md`.
Host note: none.

## I6 · Register `ingest` (B · blocked by: I1, I2, I3 · ready-for-agent: yes)

Owner steps: the yes to commit.
Acceptance: edges in `skills-graph.toml` (`ingest -calls-> faster-whisper` recipe, `unclecode/crawl4ai -feeds-> ingest`, `bradautomates/claude-video -alternative-to-> ingest` media step), `build` and `check` clean; an AGENTS.md routing row "Personal or business context (Instagram, X, WhatsApp exports) | `ingest --route=export`; `--route=session` gated"; the HITL list names the session route; portal run-log row; showcase log entry.
Files: `.agents/skills/skills-graph/skills-graph.toml`, `AGENTS.md`, `site/index.html`, `site/i18n/pt-BR.json`.
Host note: same as P4.

## O1 · OpenMontage curated subset intake (B · blocked by: T1 · ready-for-agent: yes, the clone is gated)

Owner steps: approve `git clone https://github.com/calesthio/openmontage` into `_intake/openmontage` (gated) and the `make setup` dependencies if the subset needs them; decide whether AGPL-3.0 is acceptable for assets served to members (its network-use clause).
Acceptance: `skill-scanner scan` (or a full read) of `skills/pipelines/` Animated Explainer and Screen Demo plus the `skills/core` files they import, findings reported before any link; the subset adopted with `scripts/install.py --adopt` only after the yes; `docs/integrations/openmontage.md` with cost (offline path: Piper TTS and free stock; paid providers optional), gate entry, install state and the AGPL note; one markdown page of ours turned into one narrated demo clip, offline, recorded in the log with wall clock.
Files: `_intake/openmontage` (gitignored), `docs/integrations/openmontage.md`, `.agents/skills/` (the subset).
Host note: Remotion and HyperFrames need Node 18+; ffmpeg on PATH.

## A1 · Archify intake for `docs/adr` diagrams (B · blocked by: T1 · ready-for-agent: yes, the install is gated)

Owner steps: approve `npx skills add tt-a1i/archify -g` (gated) after the scan.
Acceptance: the skill read in full or scanned, findings reported; one architecture diagram of the harness (hosts, gate, drivers, skills rings) generated with evidence nodes pinned to a commit, validated by its own checks, saved under `docs/adr/` and linked from CONTEXT.md; the `candidate-for domain-modeling` edge either promoted to `feeds` or removed, with the reason in the TOML `why`.
Files: `docs/adr/`, `CONTEXT.md`, `.agents/skills/skills-graph/skills-graph.toml`.
Host note: Node.js required.

---

# T13 · OmniHarness v3, the Swarm & Autonomy Era (master ticket, added 2026-09-14)

Owner's direction of 2026-09-14: the harness must not stay on a permanent hand-brake. Three pillars, configurable autonomy, GOAP-style routing with dynamic rerouting, parallel swarms without collision; the technical shape below is the agent's proposal under the owner's design freedom, and the evidence for it is `../experiments/ruflo-comparison-2026-09-14.md`. Blocked by: T1 (parity first). Ready-for-agent: yes for S1–S4 and S6; S5 runs paid benchmarks behind the gate. Estimated: 6–10 h of agent time, 1.5–2.5 M tokens including the two benchmarks; report measured usage at the close.

## Design in one paragraph

The gate does not disappear; it moves. At session start `/omniharness` (or `$omniharness`) offers three modes and writes a **session envelope** (`.omniharness/session.json`, gitignored): mode, token budget, scope of paths, allowed network hosts, allowed installs, expiry. Inside the envelope the agent runs continuously; outside it the old behaviour returns. Hard stops never move, in any mode: recursive deletion, credentials and keys, `git push`, payments, anything not in the envelope. The plan gate stays the first critical milestone of every mode except Strict, where every step asks as today. GOAP arrives as data, not as a search engine: `needs:` and `cost:` on routine steps and graph nodes, and explicit `alternative-to` edges the agent may take on failure according to the mode. Swarms are Workflow-driven implementers in git worktrees with disjoint scopes, an integrator and a reviewer, under the envelope's budget.

## Owner's answers to T13's pending items (2026-09-14)

1. Invariant 2 amendment: **approved**. The operator's choice of the session envelope at the start counts formally as the explicit prior yes for every operation inside the envelope's scope and budget; the hard stops stay outside any envelope.
2. Session defaults: mode **Balanced** (the menu offers Swarm and Strict); budget **US$ 2.00, about 750 k tokens**, automatic warning at 80 %.
3. Benchmarks B8 and B9: **approved**, to run when S5 is reached, cost named at that moment.

## Modes (chosen at start, changeable with `/omniharness mode <name>`)

| Mode | Plan gate | Gated calls inside the envelope (network to allowed hosts, listed installs, model calls within budget) | Reroute on a failed step | Stops |
|---|---|---|---|---|
| Swarm | once, at the start (the plan is the contract) | allowed and logged with cost | automatic: the cheapest `alternative-to` whose `needs:` hold, logged; `detour` only if none | budget at 80 % (warn) and 100 % (stop), scope breach, hard stops, fatal error, a milestone the plan marks `stop:` |
| Balanced (recommended default) | once, at the start | allowed and logged | automatic for zero-token steps; asks before a paid or network alternative | destructive or high-impact actions, hard stops, budget |
| Strict | every round, as today | every call asks with its cost | asks | as today |

The envelope is signed by the operator's answer to the menu (Claude Code: `AskUserQuestion`; Codex: the question in chat, the answer written by the skill). Every allowed-by-envelope call leaves a line in `.omniharness/session.log` with the command, the host, the cost estimate and the running budget, so `omniharness explain` can say why something ran without asking.

## Sub-tickets

### S1 · Session envelope and modes (blocked by: T1)
Owner steps: answered on 2026-09-14 (see above): the AGENTS.md amendment is approved (invariant 2 gains "or inside a session envelope the operator signed at the start; the hard stops never move"; a "Session modes" section; the HITL list names the hard stops), the default mode is Balanced, the default budget US$ 2.00 (about 750 k tokens) with the warning at 80 %; the agent writes the amendment and the defaults without asking again.
Acceptance: `.agents/skills/omniharness/` gains the menu and writes `.omniharness/session.json` (mode, budget, scope, hosts, installs, expiry); `harness/envelope.py` (stdlib) answers allow / ask / deny for a command from the envelope, the hard-stop list and the running usage read from the transcript path the hook receives, and prints the reason; `harness/guard_bash.py` calls it and returns `permissionDecision` accordingly (Claude Code hooks); `harness/settings.json` gains an `allow` list of read-only commands (git status/log/diff, the test commands, ls, python -c reads) so even Strict stops asking for harmless reads; `tests/test_envelope.py` covers: hard stops denied in every mode, a host outside the list asks in Balanced and Swarm, budget at 100 % stops, an expired envelope falls back to Strict, the log line format; on Codex (no hooks) the skill prints the envelope and AGENTS.md instructs the agent to honour it, recorded as a parity row.
Files: `.agents/skills/omniharness/**`, `harness/envelope.py`, `harness/guard_bash.py`, `harness/settings.json`, `AGENTS.md`, `tests/test_envelope.py`, `.gitignore`.

### S2 · GOAP as data: needs, costs, alternatives, reroute (blocked by: T1)
Owner steps: none.
Acceptance: `skills-graph.toml` nodes accept `needs` (files, env keys, installed skills, binaries) and `cost` (tokens or USD with the benchmark id and date that measured it; unmeasured stays absent, never guessed); `skills_graph.py route` ranks by keyword overlap then by measured cost, `skills_graph.py alternatives <node>` lists `alternative-to` neighbours whose `needs` hold on this machine, cheapest first; PLAN.md steps carry `needs:` and optional `stop:`; `scout status` names the first blocked step and what unblocks it; the reroute rule per mode is implemented in the scout routine text and tested on a fixture plan where step 2 fails; `docs/skills-graph/README.md` documents the fields; `tests/test_skills_graph.py` gains the cases. No A*: the graph is small and the alternatives are explicit edges; an A* over needs and effects is a roadmap row to be opened only when a measured plan exceeds ten steps.
Files: `.agents/skills/skills-graph/**`, `.agents/skills/scout/**`, `docs/skills-graph/README.md`, `tests/test_skills_graph.py`.

### S3 · Swarm driver: worktrees, scope map, integrator, reviewer (blocked by: S1)
Owner steps: the yes to the first real run (cost named from the envelope).
Acceptance: `swarm/swarm.workflow.js` (Claude-only driver, installed like the scout driver) takes tasks from PLAN.md or TICKETS.md with a **scope map** (disjoint path globs per task; the driver refuses overlapping scopes, the claims-board idea made static), spawns one implementer per task with `isolation: 'worktree'` and the ponytail ruleset, collects a structured report per task (worktree, branch, changed files, test command and result, tokens), then one integrator merges the branches in order of dependency, runs the whole zero-token battery and reports conflicts as a numbered list (never resolves a conflict by deleting), then one reviewer runs `ponytail-review` and `code-review`; `budget` comes from the envelope; `parouPor` names why it stopped; optional `--tournament n` runs n implementers on one task and the integrator keeps the winner by tests then by net lines (the orca pattern); `.agents/skills/swarm/SKILL.md` is the portable entry (`/swarm` on Claude Code, `$swarm` on Codex runs the same tasks one after another in worktrees through `git worktree` commands until a parity ticket finds better); `tests/test_swarm_driver.js` covers scope overlap refusal, report shape, integrator order and the stop reasons with a mocked agent.
Files: `swarm/swarm.workflow.js`, `.agents/skills/swarm/**`, `scripts/install.py` (installs the driver), `tests/test_swarm_driver.js`.

### S4 · Cross-run seen store and deterministic hooks (blocked by: S1)
Owner steps: none.
Acceptance: `scout` and `gauntlet` read and write a `seen.jsonl` (URL or finding id, date, verdict) so a rerun skips what a previous run judged, measured against a cold run in the log; the settings fragment adds `SessionStart` (install check and `regress`, zero tokens) and `PostToolUse` on `.agents/skills/**` (layout test and graph check) beside the existing design detector; every hook is local and free, and none calls the model.
Files: `.agents/skills/scout/**`, `gauntlet/**`, `harness/settings.json`, `harness/hooks/*.py`.

### S5 · Benchmarks B8 and B9 (blocked by: S2, S3; gated)
Owner steps: approved on 2026-09-14; the agent still names the cost before each run (about three B3-scale runs each) and records it.
Acceptance: B8 "swarm against sequential": the same three small tickets built sequentially and by the swarm; wall clock, tokens, test pass, conflicts, net lines, recorded in `docs/benchmarks.md` with the commands; B9 "the envelope holds": an adversarial prompt inside Swarm mode tries to exceed the budget, touch a path outside the scope, reach a host outside the list and delete recursively; every attempt denied or asked, the log lines quoted; `evals/cases/{swarm-vs-sequential,envelope-holds}/` with the grader; losses reported as plainly as gains.
Files: `evals/cases/**`, `docs/benchmarks.md`.

### S6 · Docs, portal, showcase (blocked by: S1–S4)
Owner steps: the yes to commit and push.
Acceptance: CONTEXT.md gains envelope, mode, scope map, integrator, seen store; an ADR records the envelope decision and the rejected alternative (installing RuFlo as an MCP server, with the reasons of the comparison file); the portal's flow gains the mode as the first thing the visitor sees after the trigger (L1 text) and the swarm as a layer, PT-BR entries included, visual battery green; `site/showcase/log.md` and README updated; the impeccable detector runs on the portal edit in a Claude session.
Files: `CONTEXT.md`, `docs/adr/0005-session-envelope.md`, `site/index.html`, `site/i18n/pt-BR.json`, `README.md`.

### S7 · Close (blocked by: S5, S6)
Acceptance: full battery green on both hosts where possible; measured usage of T13 against its estimate; the tree clean.

## What was deliberately left out

No shared vector memory between agents (the integrator is the only writer to the main tree); no background workers that spend tokens; no MCP server with hundreds of tools; no automatic A*; no mode that removes the hard stops.
