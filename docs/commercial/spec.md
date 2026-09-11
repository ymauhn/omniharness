# Spec: the commercial phase of the OmniHarness portal (R1 + R2)

Status: approved at the plan gate of 2026-09-11 (`grilling.md`, Q1–Q8). Execution starts on Codex (`../handoff-codex.md`). Tickets: `TICKETS.md`. Token ceiling for both rounds: 4 M, report at the end of each round, warning at 80 %.

## Goal and success criterion

Goal: the portal (`site/index.html`, public edition on GitHub Pages at https://ymauhn.github.io/omniharness/) gains a real members area: sign-in with Google, GitHub or a magic link; member content stored outside the page and readable only by an authorised account (RLS); a subscription checkout through Asaas's hosted page with Pix and card; a first library of member content in PT-BR and EN.

Success criterion, R1: a visitor signs in with each of the three methods on the live page; a signed-in account that is not on the members allow-list sees the library locked; an allow-listed account reads the guides, which are absent from the public HTML (`node tests/test_site.js` asserts it); the visual battery is green with the new states; the authors section and the roadmap are on the page; usage reported.

Success criterion, R2: an account buys a monthly or annual plan in the Asaas sandbox through the hosted checkout; the webhook marks the subscription active and the same account reads the library without any manual step; a lapsed subscription locks it again; the webhook handler has a zero-token test; the library holds the demonstration content with honest labels; usage reported against the 4 M ceiling.

## Product truth that binds every ticket

From `PRODUCT.md` and the v3 direction contract: nothing pretends (no fake login, no invented number, no "tested" label without a run record); every paid or network call waits for the owner's yes with its cost named (HITL invariant); every claim has a zero-token check where one is possible; the design language is `site/DESIGN.md` (Geist, the calmed palette, the indigo accent on interactive states, plates not kickers); host parity: whatever is built must run from Codex and Claude Code alike, Claude-only pieces are adapters. The agent never creates accounts, never enters credentials, API keys or card data; those steps are the owner's and each ticket lists them.

## Architecture

**Supabase project** (owner-created, free tier). Auth providers: Google, GitHub (OAuth apps the owner creates with the Supabase callback URL), email magic link. Site URL `https://ymauhn.github.io/omniharness/`; redirect allow-list adds `http://localhost:8000/` for local tests. Public config (project URL, anon key) lives in `site/auth.json` and the build embeds it; the anon key is public by design, the service key never enters the repo (environment variable, used only by the gated upload step).

**Tables** (SQL in `supabase/schema.sql`, applied by the owner in the SQL editor or by the agent with the Supabase CLI behind the gate):
- `members` (R1 allow-list): `user_id uuid references auth.users, email text, note text, created_at`. Owner inserts rows by hand in R1.
- `subscriptions` (R2): `user_id, asaas_customer_id, asaas_subscription_id, plan text check (plan in ('monthly','annual')), status text, current_period_end timestamptz, updated_at`.
- `guides`: `slug text primary key, kind text check (kind in ('guide','slides','flow','prompt')), lang text check (lang in ('en','pt-BR')), title text, body text, version int, updated_at`.
- RLS: `guides` select allowed when `exists (select 1 from members m where m.user_id = auth.uid())` in R1; in R2 the policy becomes `exists (select 1 from subscriptions s where s.user_id = auth.uid() and s.status = 'active' and s.current_period_end > now())` plus the allow-list (the owner keeps free seats). No insert/update from the client; the upload uses the service key.

**Page** (one source, `site/index.html`, two editions as today): `supabase-js` UMD from jsDelivr, pinned with an integrity hash and deferred, like force-graph. An `<html data-auth>` attribute with the states `out`, `in`, `member`; the header shows Sign in / the account email / Sign out; a modal `#auth` with the three methods, focus trap, Escape, reduced motion, i18n through the existing dictionary. The library section keeps its public rows; member rows show a lock until `member`, then fetch `guides` for the reader's language and render with the existing `md()`; slides are `guide` bodies split on `---` and shown one at a time with keyboard arrows; flows are inline SVG or the existing force-graph with a small data payload (no new library unless a ticket proves the need); prompts are JSON rendered as cards with a copy button. A `window.__portal.auth(stub)` test hook lets `tests/visual/shoot.py` drive every state without a network.

**Edge Functions** (R2, Deno, in `supabase/functions/`): `asaas-checkout` creates or reuses the Asaas customer and subscription for the signed-in user and returns the hosted checkout URL; `asaas-webhook` validates the `asaas-access-token` header against the secret, maps Asaas events to `subscriptions.status` and `current_period_end`, and is idempotent. The mapping lives in `supabase/functions/_shared/asaas.js`, plain ESM JavaScript with no Deno API, so `node --test tests/test_asaas.js` covers it at zero tokens and the Deno function only wraps it. Event names, payload fields and the sandbox's way of confirming a Pix payment are read from the Asaas documentation in T8 and quoted with URL and date, never assumed.

**Build**: `scripts/site_build.py` keeps both editions; a new `--push-guides` step upserts `site/library/**` into `guides` through the REST API with the service key from the environment (network: HITL, the command prints the row count and waits). The `<template data-members>` guide bodies leave the public HTML in T6; the members claude.ai artifact stays as a mirror until T12 decides its fate.

**Library content** (`site/library/`): `guides/<slug>.<lang>.md` (slides use `---` separators), `flows/<slug>.json` (nodes, edges, labels in both languages), `prompts/<slug>.json` (`id, title, use_case, prompt, variables, lang, tested: {run: null | {date, command, cost_usd, verdict}}`). `tests/test_library.py` validates every file against this shape and fails on a `tested.run` without a cost. Labels on the page: "template, not tested" until a run record exists.

## Non-goals

No Stripe; no custom card form; no server beyond Supabase; no gamified interface (next phase); no thesis-review implementation (roadmap); no price invented; no scraping of authors' data.

## Owner-only steps (each ticket repeats its own)

Create the Supabase project; create the Google and GitHub OAuth apps and paste their IDs and secrets into Supabase; set the site and redirect URLs; run `schema.sql`; insert the first `members` rows; create the Asaas sandbox account, its API key and the webhook token; set the Edge Function secrets; decide the plan prices; send authors' names, bios and photos; approve every gated command when it asks.
