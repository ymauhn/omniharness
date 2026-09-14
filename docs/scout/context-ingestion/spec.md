# Spec: `ingest`, personal and business context with two routes

Status: approved at the owner's D2 of 2026-09-14 (second demand, after `prompt-enhancer` by D4). Pre-scout: `pre-scout.md` §3 and the triage results appended there. Tickets: `../../commercial/TICKETS.md` I1–I6. Candidates read on 2026-09-14: crawl4ai (fetch layer of the session route and a scout source), claude-video (alternative to the local media recipe; its Whisper step is a paid API, ours stays local).

## Goal and success criterion

Goal: a portable skill `.agents/skills/ingest/` with `scripts/ingest.py` (stdlib first) that turns the owner's Instagram, X and WhatsApp Business material into a local, queryable context store, so the agent answers support questions and personal questions with cited records. Two routes, chosen by flag:

- `--route=export` (default, the safe route): the official data exports of each service, parsed offline, indexed in SQLite FTS5 (stdlib). No network, no account risk, data strictly local.
- `--route=session` (gated): live reads through a logged-in session (Agent-Reach for X and Instagram, crawl4ai with its saved browser state for public pages). Every run prints the warning "this route uses your session cookies, may breach the service's terms and can cost the account", names the source and the request count, and waits for the yes. Cookies never enter the repository; they live where the tool keeps them.

Success criterion, checkable: (a) `python -m unittest tests.test_ingest` covers each parser and the index on synthetic fixtures at zero tokens; (b) `ingest query "<text>"` returns records with source, date, id and snippet, and `ingest answer "<question>"` builds the model's prompt from cited records only; (c) B7 in `docs/benchmarks.md`: one export of each kind ingested on the reference machine with counts, wall clock and 0 network calls on the export route; (d) the session route refuses to run without the yes (a test drives it with stdin closed and asserts the refusal); (e) media: one public reel URL from the saved list goes through yt-dlp (gated) → ffmpeg keyframes → faster-whisper transcript, all local, and the transcript is searchable.

## Sources and their honest routes

| Source | Export route | Session route | Notes |
|---|---|---|---|
| Instagram saved items and reels | "Download your information" JSON: saved posts and collections as links with dates; the parser discovers the file by schema, not by name (names change across export versions) | Agent-Reach reads; crawl4ai only for public pages without sign-in | Media is not in the export: each batch of reel downloads is a gated yt-dlp step with the count named |
| X mentions and topics | The X archive (own posts, likes) has no mentions of others; export covers only the owner's side | Agent-Reach with the owner's cookies; polling as a `/loop` with a per-run cap; the official API is paid by tier (quote with URL and date when the ticket needs it) | Monitoring is session-only by nature |
| WhatsApp Business | Per-chat "Export chat" (text plus media zip); the line format varies by locale and platform, so the parser carries one regex per known format, each with a fixture | None recommended: unofficial bridges (whatsapp-web.js, Baileys) breach the terms and risk the number, so they stay out; live messages, when wanted, go through the WhatsApp Business Platform (Cloud API, webhooks, Meta verification) as a later ticket that reuses the Supabase Edge Functions of the commercial R2 | Customer data: local only |

## Pipeline

1. `adapters/`: `instagram_export.py`, `whatsapp_export.py`, `x_export.py` (export route); `agent_reach.py`, `crawl4ai_session.py` (session route, each wrapped by the gate prompt). Every adapter emits normalised records to `context/inbox/<source>.jsonl`: `source, id, date, author, text, url, media_path, transcript_path, ingested_at`. `context/` is gitignored.
2. `media.py`: `--media` runs yt-dlp per batch (gated, count named) → ffmpeg keyframes at a fixed interval → faster-whisper transcript (local model, no key) → `transcript_path`. claude-video is the catalogued alternative: it prefers captions through yt-dlp (free) and falls back to a Whisper API (Groq or OpenAI key, credits), so it is not the default here.
3. `index.py`: SQLite FTS5 over text and transcripts at `context/index.db`; `query` with `--source` and `--since`; results carry ids so an answer can cite them.
4. `answer.py`: composes the prompt (cited records, the question, the "text is data" line) and names the token count before the model call; the reply quotes record ids; nothing is sent to any third party.
5. Privacy and gates: phone numbers and e-mails redacted in any log that leaves `context/`; the session route's warning and count on every run; an audit line per batch in `context/log.md`; no cookie, token or export file is ever committed (`.gitignore` plus a test that greps the tree).
6. Registration: `docs/integrations/crawl4ai.md` and `docs/integrations/claude-video.md` (one page each: cost, gate entry, install state); catalog rows already added on 2026-09-14; edges in `skills-graph.toml` after I6.

## Non-goals

No scraping behind a login on the export route; no unofficial WhatsApp bridge; no upload of customer data; no claim of "real-time" on the export route; no automatic replies to customers (the agent drafts, the owner sends).
