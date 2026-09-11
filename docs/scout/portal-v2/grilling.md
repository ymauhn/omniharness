# Grilling round: portal v2 (2026-09-11)

Format of the `grilling` skill (one frontier round, a recommendation per question). The owner was not present during this run, so every question proceeded on its recommendation, per AGENTS.md ("a skipped question proceeds on the recommended default, flagged for veto"). Vetoes reopen the question; nothing below is locked.

❓ **Q1 - Members area on a static site**: the dossier shows three honest ways (pattern 4): encrypt the page (staticrypt: one shared password, brute-force possible, not authentication), delegate identity to a platform login, or add a proxy/Identity service and pay for it. A login form that stores nothing is out by the owner's constraint.

➡️ Delegate identity: the claude.ai artifact edition is the members' door. Its viewers are real accounts on the owner's share list; the page carries no credential form. The public GitHub Pages edition shows the same library with the restricted bodies omitted at derivation time (not hidden by CSS), and says how to become a member. staticrypt stays a documented option for a public-site members page later; a proxy never (zero backend). Assumed.

---

❓ **Q2 - What is restricted**: which content is member-only?

➡️ The full text of the prompt guides (the SKILL.md bodies rendered in the page) and the plan and spec templates. Everything else is public: manuals links, tutorials, benchmarks, the showcase. Assumed.

---

❓ **Q3 - Library taxonomy**: Diátaxis quadrants (tutorial, how-to, explanation, reference) as navigation buckets, or as labels?

➡️ Labels as in-page filters, plus a host filter (Claude Code, Codex, Hermes) and an always-visible text search (pattern 3; the HN objection that four buckets confuse readers). One page, no separate docs site; docsify only if the library outgrows one page (recommendation 5). Assumed.

---

❓ **Q4 - The interactive diagram**: scrollytelling library or hand-rolled, and how does the skills graph render?

➡️ IntersectionObserver by hand (about 40 lines, no dependency) driving a sticky panel; the skills graph rendered with force-graph (UMD from cdnjs, pinned) from the same `graph.json` `skills_graph.py build` writes, embedded in the page so the diagram cannot diverge from the repository (pattern 2, recommendations 1 to 3). Each scroll step highlights one subgraph; a node script checks every node a step cites exists in the JSON. No `onStepProgress` dependence (Safari), no `vh` heights. Assumed.

---

❓ **Q5 - Proof format**: keep the current benchmark table or adopt the leaderboard format?

➡️ openbench style (pattern 5, recommendation 7): per benchmark x/n, cost in USD, date, commit, the exact reproduce command and the caveat sentence "a sample, not a verdict"; plus the page's own weight (KB, requests) as one line (recommendation 8). Assumed.

---

❓ **Q6 - First viewport**: keep the QRH checklist?

➡️ Keep it, but lead with code (recommendation 9): row 1 is the copyable install command, row 2 is `/omniharness`; the rest of the checklist follows. No reference validates a checklist as a converting first viewport, so this stays a hypothesis to measure. Assumed.

---

❓ **Q7 - Community door**: own feed or GitHub?

➡️ GitHub Discussions and issues, linked from one entry point; no own feed (pattern 6: weak curation is the dominant criticism of feeds). Assumed.

---

❓ **Q8 - The living showcase**: screenshots or authored frames?

➡️ Authored HTML frames from the real transcripts (log lines, dossier excerpts, the installer plan, the review), each with its timestamp and numbers from `site/showcase/log.md`. No rasters, so nothing needs provenance and the page stays light. Assumed.

---

❓ **Q9 - Two hosts, one source**: how do the GitHub Pages and artifact editions stay one page?

➡️ One `site/index.html`; `scripts/site_build.py` derives the artifact fragment and strips member-only blocks for the public edition, and is the single place where the two differ. Assumed.

Frontier empty. Shared understanding assumed, not confirmed; the owner's vetoes reopen any line above.
