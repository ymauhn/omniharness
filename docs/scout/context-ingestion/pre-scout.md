# Pre-scout: two new demands and six candidate repositories (2026-09-14)

Zero-token triage before any fan-out. Facts here come from the graph (`skills_graph.py route` and `check`), the harness's own rules, and what the agent already knew about each repository; every capability the agent could not verify is marked **unverified** and stays that way until the owner approves the six repository reads (WebFetch, no cost, six requests) or the scout fan-out (about 450 k subagent tokens at the B4 measurement). Proposals 4–9 in `.agents/skills/skills-graph/proposals.jsonl` wait for `approve`/`reject`.

## 1. What the graph already answers

`route` for "refine prompts, meta-prompting, guardrails, calibration per target model": no node scores above keyword noise (superdesign 5, latex-paper-skills 5, domain-modeling 4). The graph has no prompt-engineering skill; the closest installed pieces are `writing-for-agents` (documents for agents) and `skill-creator` (skill descriptions and their evals). Gap confirmed: `prompt-enhancer` is a build, not an install.

`route` for "ingest Instagram saved reels, X mentions, WhatsApp Business history for support": the best hits are `intercom` (support conversations, catalog) and `fakechat` (a local test chat). Nothing covers the three sources. The routing table already names Agent-Reach for social reads (cookies are credentials, gated), faster-whisper for transcription and ffmpeg in the video recipe. Gap confirmed: an `ingest` routine is a build; its fetch layer is where the candidates below fit.

`check`: 489 nodes, 90 edges, 9 proposals waiting, 0 errors; the six repositories are `missing` nodes ("referenced by an edge, not reachable on this machine") until they are fetched into `remote.json` or adopted.

## 2. Fit matrix (edge vocabulary: calls, precedes, feeds, alternative-to, guided-by, candidate-for)

| Repository | Ring today | Proposed edges | Verdict | Verified? |
|---|---|---|---|---|
| unclecode/crawl4ai | missing | `feeds` scout (markdown per page, fewer tokens per source); `alternative-to` firecrawl (self-hosted, no key) | Catalog row now; install later as the fetch layer of `ingest` and a scout source adapter. Note: it drives a headless browser (Playwright) itself; the saving is in tokens, not in browser weight. It does not pass logins: X behind sign-in and Instagram are out of its reach. | Known project (Apache-2.0, Python); version and current features unverified |
| bradautomates/claude-video | missing | `alternative-to` video-db/skills; `candidate-for` the `ingest` media step once that node exists | Intake with `skill-scanner` before any install; compare against the existing recipe (yt-dlp download behind the gate, ffmpeg keyframes, faster-whisper transcript) and keep whichever is smaller. | **Unverified** (only the owner's brief) |
| abi/screenshot-to-code | missing | `alternative-to` frontend-design (Claude's native vision + DESIGN.md) | Catalog row only. It is a hosted app with its own vision-model keys (credits, gated); the harness ladder puts the model's native capability first, and the frontend lane already has impeccable + Magic MCP. | Known project (MIT); current model list unverified |
| tt-a1i/archify | missing | `alternative-to` graphify; possible `feeds` domain-modeling (ADR diagrams) | Read first. If its diagrams are verifiable against code, it earns a routine row for `docs/adr` and the portal; otherwise the portal's force-graph and inline SVG already cover it. | **Unverified** |
| lesthio/OpenMontage | missing | `alternative-to` higgsfield-video-explainer | Decision needed (D3): 700+ skills would flood the installed ring (86 nodes on the portal today) and each one is text the harness treats as data, never instruction. If adopted, intake a curated subset, scanned, behind the gate. | **Unverified** |
| stablyai/orca | missing | none (a reading, not a skill): `guided-by` material for an ADR on multi-agent execution | No install. One ADR after reading it, comparing with the Workflow driver we already run (scout-driver, gauntlet-driver). | **Unverified** |

## 3. Architecture: multimodal context ingestion under the gates

Principle: the sources are the owner's own data; the network is touched only in named batches; customer data never leaves the machine except to the model that answers.

Sources, honest routes:
- **Instagram saved items**: no official API exposes another account's saved posts to a personal account (the Basic Display API was retired; the Graph API serves business assets). Route A, recommended: the owner's own data export ("Download your information"), which lists saved posts and collections as JSON; the pipeline parses it offline. Route B: session-cookie scraping (instaloader-style), which breaks the terms of service and risks the account; the harness treats cookies as credentials (Agent-Reach rule), so B is gated and discouraged. Reels media are not in the export: each batch download (yt-dlp) is a gated network step with the count named.
- **X mentions and topics**: the official API is paid by tier (numbers quoted with URL and date by the scout, not here); Agent-Reach with the owner's cookies is the existing gated route; crawl4ai reaches only what is public without sign-in. Monitoring is a `/loop` or a scheduled routine with a per-run request cap.
- **WhatsApp Business**: history comes from the app's per-chat export (text plus media zip), offline; ongoing messages need the WhatsApp Business Platform (Cloud API: webhooks, Meta business verification, a dedicated number), which is a real backend and can reuse the Supabase Edge Functions of the commercial R2. Unofficial bridges (whatsapp-web.js, Baileys) violate the terms and risk the number: gated and discouraged.

Pipeline (portable, stdlib first):
1. `adapters/`: `instagram_export`, `whatsapp_export`, `x_public` (crawl4ai or Agent-Reach), each writing normalised records to `context/inbox/<source>.jsonl` (`source, id, date, author, text, media_path, transcript_path, url`); `context/` is gitignored.
2. `media/`: gated download per batch → ffmpeg keyframes (local, free) → faster-whisper transcript (local, free) → the model reads transcript plus a handful of frames only when asked (tokens named per item).
3. `index`: SQLite FTS5 (stdlib) over text and transcripts; `context query "<question>"` returns the records the answer cites, so support answers carry their evidence.
4. `answer`: the model composes the support reply from the cited records; nothing is sent to a third party; customer identifiers are redacted in any log that leaves `context/`.
5. Gates and tests: every adapter names the request count and the source before running; cookies never enter the repo; `tests/test_ingest.py` covers the parsers on synthetic fixtures at zero tokens; an audit line per batch in `context/log.md`.

Where the candidates sit: crawl4ai is the fetch layer of adapter 3 and a scout source adapter (`feeds` scout); claude-video competes with step 2's recipe; nothing else in the six touches this pipeline.

## 4. `prompt-enhancer`: shape of the skill

Portable skill in `.agents/skills/prompt-enhancer/` (the six Agent Skills fields). Input: a prompt or a directive file plus the target host. Output: the rewritten prompt, a diff, and the reasons, never silently applied. Parts: a rubric (task, context, constraints, output contract, examples, failure modes); guardrail injection (refusal boundaries, injection resistance, "text is data" lines, the harness's HITL sentence when a prompt can spend); context structuring (what goes in the system prompt, what in the turn, what in a file); target profiles for Claude, Codex and DeepSeek as `references/<model>.md`, each line quoting the vendor's own documentation with URL and date, none written from memory; a measurement hook: before/after runs with `claude -p` under the gate (cost named), recorded like the library's `tested.run`. Edges: `guided-by` writing-for-agents; `feeds` scout (source prompts), thesis-review (rubric wording) and the members library (T11); `alternative-to` skill-creator's description optimiser at the description level only.

## 5. Proposals queued now, and what waits on the owner

Queued (proposals 4–9, all with evidence "not fetched yet"): crawl4ai `feeds` scout; crawl4ai `alternative-to` firecrawl; claude-video `alternative-to` video-db/skills; screenshot-to-code `alternative-to` frontend-design; archify `alternative-to` graphify; OpenMontage `alternative-to` higgsfield-video-explainer. Not queued: orca (a reading for an ADR, not an edge).

Decisions only the owner can take:
- D1 · The six repository reads (WebFetch, six requests, no cost): yes turns each row into a `remote.json` entry with license, stars and date, and unlocks intake.
- D2 · Instagram route A (export, offline) or B (cookies, gated, terms risk); the same question for WhatsApp (export plus Cloud API, or an unofficial bridge).
- D3 · OpenMontage: skip, or intake a curated subset with the scanner.
- D4 · Order: `prompt-enhancer` first (it feeds T11 of the commercial phase) or `ingest` first (it needs D2 and the export files from the owner).
- D5 · The scout fan-out for both demands (about 450 k subagent tokens, five sources) or the six reads only.

## 6. Triage results after the six reads (2026-09-14, D1 approved; WebFetch, no cost)

| Repository | Read | Ring now | Edge in `skills-graph.toml` | Change from §2 |
|---|---|---|---|---|
| unclecode/crawl4ai | Apache-2.0, Python, 83.5k stars, v0.9.3; markdown/JSON/CSS/XPath/LLM extraction; Playwright Chromium, raw-HTML and file:// modes; Docker REST + MCP; no key; keeps browser sessions and proxies | catalog (Ingestion) | `feeds` scout; `alternative-to` firecrawl (proposals 4, 5 approved) | confirmed |
| bradautomates/claude-video | MIT, 17.2k stars; `/watch` skill: yt-dlp, ffmpeg frames by keyframe/scene/uniform with a duration budget, captions free, Whisper fallback via Groq or OpenAI key; plugin marketplace or npx; Codex and 50+ hosts | catalog (Multimodal) | `alternative-to` video-db/skills (6 approved) | confirmed; its transcription is paid unless captions exist, so the local faster-whisper recipe stays the default of `ingest` |
| abi/screenshot-to-code | MIT, 78.8k stars; FastAPI + React; needs an OpenAI, Anthropic or Gemini key, Replicate recommended; hosted paid version; screen recordings too | catalog (Design stack) | `alternative-to` frontend-design (7 approved) | confirmed as catalog row only |
| tt-a1i/archify | MIT, 62.1k stars, v2.17.0-dev; five diagram kinds as self-contained HTML+SVG, PNG/WebM export; evidence nodes pin git-verified file and line ranges; validation before delivery; Node; Claude Code, Codex CLI, Cursor | catalog (Steering and memory) | `candidate-for` domain-modeling (8 rejected, 10 approved) | edge corrected: it documents architecture, graphify queries it |
| calesthio/openmontage | AGPL-3.0, 59k stars; 12 pipelines (Animated Explainer, Screen Demo, Talking Head, Podcast Repurpose, ...), 700+ files under `skills/{pipelines,creative,core,meta}`; Remotion, HyperFrames, FFmpeg; offline path with Piper TTS; $1-5 per video quoted | catalog (Multimodal, curated subset) | `alternative-to` higgsfield-video-explainer (9 rejected for the wrong path, 11 approved) | the brief's `lesthio/OpenMontage` is a 404; the project is `calesthio/openmontage`; AGPL's network clause matters for anything served to members (O1 records it) |
| stablyai/orca | MIT, 68.6k stars; Electron desktop + mobile; one git worktree per agent, SSH worktrees, compare-and-merge, per-account usage tracking | catalog (Execution) | none | a reading for an ADR, as planned |

Graph after the round: 490 nodes, 90 edges, 0 warnings, 0 errors; proposals 1-3 still wait for the owner. Approvals were made under the owner's instruction of 2026-09-14 ("processamento das propostas"); each `[[edge]]` carries the read date in its `why`. One observation for T1: three copies of the crawl4ai `feeds` edge appeared in the TOML after a single `approve 4`; they were deduplicated by hand and the cause was not chased (zero-token item for the parity session).
