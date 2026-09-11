# Showcase log: portal v2 (2026-09-10)

Every line is a measured fact from the session that built portal v2. Times are UTC.

- 2026-09-11T02:48:01Z  step 1 scout: fan-out started (5 sources + 1 synthesis, porFonte 6, tetoTokens 300k)
- 2026-09-11T02:50:25Z  step 4 skill-installer: plan printed (impeccable 2 TODO + 1 owner-only; magic-mcp waits on API_KEY_21ST)
- 2026-09-11T02:51:37Z  step 4 skill-installer: apply impeccable --yes DENIED by the Claude Code auto-mode classifier (Bash permission); the gate held; impeccable stays uninstalled, the two commands go to the owner
- 2026-09-11T02:52:11Z  step 1 scout: done; 6 agents, 0 errors, 443,262 subagent tokens, 107 tool uses, 205.7 s; dossier at docs/scout/portal-v2/dossier.md
- 2026-09-11T02:52:36Z  step 1 scout: done; 6 agents, 0 errors, 443,262 subagent tokens, 107 tool uses, 205.7 s; dossier at docs/scout/portal-v2/dossier.md
- 2026-09-11T02:54:00Z  step 2 setup: skills_graph.py route ran (zero tokens); installed answer: code-review, ponytail-review, review; catalog candidates: frontend-design, impeccable (not installed)
- 2026-09-11T03:04:21Z  step 6 build: portal v2 source written (one file, two editions via scripts/site_build.py); tests/test_site.js green
- 2026-09-11T03:06:03Z  step 7 evals: checkpoint tagged; detour-bounded harness + control arms started (cap $0.40 each)
- 2026-09-11T03:06:48Z  step 6 review: ponytail-review on site/index.html, 4 findings applied (net -4 lines: unused tokens, merged selectors, table branch of the md renderer); rebuilt; inspection round done (1440 + 390, no console errors)
- 2026-09-11T03:08:21Z  step 7 evals: first detour-bounded run hit the $0.40 cap in both arms before an answer (harness $0.4258, 5 turns; control $0.4502, 2 turns): rerun at $1.00 / $0.60 with the control arm as the raw model (all tools disallowed)
- 2026-09-11T03:11:45Z  step 7 evals: detour-bounded rerun: harness PASS ($0.357, 3 turns, 77.8 s), control raw model fails the structure as expected ($0.616, 54.5 s); metrics record written, page rebuilt with the numbers
- 2026-09-11T03:12:32Z  step 8 publish: members edition republished as the claude.ai artifact; public edition at site/public/index.html; commit awaits the owner
- 2026-09-11T03:27:39Z  v3 prep: Playwright visual TDD harness (tests/visual/shoot.py, tests/test_visual.py) found horizontal overflow in v2 (992 px at 1440, 1776 px at 390) and v1 (148 px at 390); fixed with min-width:0 on the grid items; v1 and v2 baselines captured
- 2026-09-11T03:28:26Z  v3 prep: mobile rail bleed fixed (8 px); tests/test_visual.py green at 1440 and 390, light and dark; force-graph verified on jsDelivr (1.51.4, not on cdnjs); impeccable still not installed: owner runs the two commands
- 2026-09-11T03:39:29Z  v3 step 0: impeccable plugin installed by the owner (marketplace + plugin OK, launcher binary not yet downloaded); registered in the graph as installed (the launcher binary is an owner-only step and does not count)
- 2026-09-11T04:24:06Z  v3 step 0: plan gate passed (owner answered Q0-Q9); launcher first run authorized (Q0)
- 2026-09-11T04:26:16Z  v3 step 3: impeccable context ran (binary ~/.impeccable/bin/0.1.5/impeccable.exe); PRODUCT.md written from the owner Q7 answers; code-led (no image generation on this machine)
- 2026-09-11T04:30:28Z  v3 step 3: direction round rolled (seed 3e54bb16, assigned index 7 field notebook; challenger collider event display wins both axes -> build); visual TDD extended (states, hook, node count): RED on v2 as expected
- 2026-09-11T04:42:06Z  v3 step 4: v3 source written (event display world, force-graph 1.51.4, pinned stage, open-core sections, evolution strata); first build and RED/GREEN visual run next
- 2026-09-11T04:48:43Z  v3 step 5: visual TDD GREEN (1440/390 x light/dark, hover 241 ms, drawer, filter, copy); detector down from 84 to 1 standing (monotonous-spacing on the label micro-padding, judged intentional); one file-level ignore recorded (cramped-padding: the slider)
- 2026-09-11T04:49:56Z  v3 step 6: critique A (design) + critique B (evidence) + audit launched as three isolated subagents; reviewer packet in .impeccable/review
- 2026-09-11T04:50:26Z  v3 step 6: ponytail-review on site/index.html: 4 findings applied (unused tokens --s9/--t-xl, unused .evt .chips rule, unused byId map, default linkDirectionalParticles call), net -5 lines
- 2026-09-11T04:50:41Z  v3 step 6: ponytail-review on site/index.html: 3 findings applied (unused --s9/--t-xl tokens, unused byId map, default linkDirectionalParticles call), net -4 lines
- 2026-09-11T04:55:18Z  v3 step 6: critique A done (108,993 subagent tokens; scores hierarchy 7, typography 7, colour 7, layout 6, first viewport 6, interaction 6, copy 9, calibration 7; P0: rings never painted, legend collision); critique B done (46,183 tokens; evidence clean)
- 2026-09-11T05:02:41Z  v3 step 6: critique+audit batch applied (rings painted, stage before layers on phones, touch-action pan-y, selection isolates, keyboard track list, drawer out of the tab order, control borders at 3:1, tokens cached, escaping, SRI+defer, dash per track type, legend on phones, five-column calorimeter, captures per scheme); detector 0; visual test green
- 2026-09-11T05:04:06Z  v3 step 7: impeccable finish reviewer spawned (round 1 of 2) with the packet in .impeccable/review; subagent tokens so far: critique A 108,993 + critique B 46,183 + audit 109,532 = 264,708 of the 1.5M ceiling
- 2026-09-11T05:09:45Z  v3 step 7: finish reviewer round 1: fix (7 items; 77,613 tokens). Batch applied: eager strata captures + scroll-through before full-page captures, edition rules last with attribute specificity, calorimeter widths and a drawn cost scale, blurbs at sentence boundaries, labels only on isolated tracks; self-hosting fonts left standing (would break the 350 KB bar)
- 2026-09-11T05:11:48Z  v3 step 7: verdict pass 1: 5 resolved, 1 partial (wall-clock cell), 1 unresolved by decision (self-hosted fonts, owner call); reviewer tokens 77,613 + 97,645; round 2 fix: the requests cell shortened
- 2026-09-11T05:12:39Z  note: the Q4 WebKit check (scroll jumps) could not run: Playwright has only Chromium installed here; installing WebKit is a gated download (about 100 MB) for the owner to decide
- 2026-09-11T05:13:03Z  v3 step 7: verdict pass 2: fix 3 resolved; all material fixes resolved except the self-hosted fonts item, which the reviewer leaves to the owner (disposition word stays "fix" at that scope); reviewer tokens 77,613 + 97,645 + 103,365 = 278,623; subagents total so far 543,331 of 1.5M
- 2026-09-11T05:13:23Z  v3 step 7: verdict pass 2: fix 3 resolved; every material fix resolved except self-hosted fonts, which the reviewer leaves to the owner (its disposition word stays fix at that scope); reviewer tokens 77,613 + 97,645 + 103,365 = 278,623; subagents so far 543,331 of 1.5M
- 2026-09-11T05:13:45Z  v3 step 8: final ponytail-review: 2 cuts (unused .mono class, unused .st.wait rule), then net 0
- 2026-09-11T05:21:21Z  v3 step 8: documenter wrote site/DESIGN.md v3 and .impeccable/design.json (120,458 tokens); subagents total 663,789 of 1.5M; 33 python tests + 9 node scenarios green; public 106.6 KB (28.6 KB deflated); members edition republished
- 2026-09-11T06:05:36Z  v3 closed by the owner: Google Fonts stays (reviewer item closed by the owner word), WebKit skipped, commit and GitHub Pages approved; v3.1 starts (calmer palette and type, PT-BR/EN, theme switcher, authors, logo)
