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
