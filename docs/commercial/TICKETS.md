# Tickets: the commercial phase (R1 + R2)

Spec: `spec.md`. Plan gate record: `grilling.md`. Onboarding for the executing host: `../handoff-codex.md`. Format per ticket: round, blocked by, `ready-for-agent`, owner steps (only the owner can do these; the agent stops and asks), acceptance (checkable), files, host note (Claude Code vs Codex vs Hermes). Take tickets in order unless the blocking edges allow otherwise. Every gated command (network, installs, `git commit`, `git push`) names its cost and waits for the yes.

## T1 · Host parity check on Codex (R1 · blocked by: none · ready-for-agent: yes)

Owner steps: none.
Acceptance: `python scripts/install.py --check` reports no drift after `--adopt`; `python -m unittest discover tests` (33 tests, the visual ones skip without Playwright), `node tests/test_driver.js` and `python evals/run.py selftest` pass; `$omniharness` loads the rules and reports the install; every divergence found (paths, junctions vs symlinks, `.cmd` wrappers, missing Workflow tool) is written to `docs/experiments/codex-parity-2026-09.md` as a numbered list with the command and its output, and mirrored as roadmap rows in T3. No fix beyond a one-line one is applied in this ticket.
Files: `docs/experiments/codex-parity-2026-09.md`.
Host note: this ticket is the portability test itself; on Codex the scout fan-out is the one-by-one WebSearch path, the Gauntlet driver and the impeccable plugin are Claude-only (report their absence, do not emulate).

## T2 · Authors section: cards, positioning, placeholders (R1 · blocked by: T1 · ready-for-agent: yes)

Owner steps: send names, one-line role, bio (2–3 sentences), photo file, and the GitHub, LinkedIn, Lattes and Scholar URLs for each author; until then the card keeps a named placeholder.
Acceptance: the `#authors` section renders N cards from one markup pattern (`.author`: photo slot that falls back to the avatar symbol when the file is absent, name, role, bio, links with `aria-disabled` while empty); the section lede states, in the owner's approved wording, that OmniHarness was conceived and developed by researchers in machine learning and artificial intelligence (geometric deep learning, graph neural networks, agentic systems engineering) and PT-BR entries exist for every new string in `site/i18n/pt-BR.json`; `PRODUCT.md` carries the authorship line; `python -m unittest tests.test_visual` stays green at 1440 and 390 with `lang_untranslated == 0`; `site/DESIGN.md` gains the card as a component only if its treatment differs from the existing `.author`.
Files: `site/index.html`, `site/i18n/pt-BR.json`, `PRODUCT.md`, `site/showcase/log.md`.
Host note: on Codex apply `site/DESIGN.md` by hand; the impeccable detector and critique run only on Claude Code, so leave a line in the log for a later pass.

## T3 · Roadmap: Linux-first parity and thesis-review as a rigour auditor (R1 · blocked by: T1 · ready-for-agent: yes)

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
