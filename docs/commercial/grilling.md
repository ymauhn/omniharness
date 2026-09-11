# Commercial phase: plan gate record (2026-09-11)

The grilling round for the commercial phase ran in chat before any scout fan-out (the owner deferred the fan-out to the next session for cost). Every answer below is the owner's; nothing was assumed. This file is the plan-gate evidence the AGENTS.md rule requires before spec, design or code.

| # | Question | Owner's answer |
|---|---|---|
| Q1 | One round or two? | Two: R1 (authors, ML/AI positioning, Linux and thesis-review roadmap, library structure, Supabase Auth); R2 (Asaas, RLS on subscriptions, webhooks, restricted content). Each round has its own plan gate. |
| Q2 | thesis-review: implement the deterministic part now or roadmap? | Roadmap now, labelled "not shipped"; implementation is its own round after the commercial phase. |
| Q3 | Auth provider | Supabase Auth (Google, GitHub, magic link) with RLS as the real member gate. |
| Q4 | Payments | Asaas with the hosted checkout (no card data touches the page); Pix and card, monthly and annual. |
| Q5 | Members library | PT-BR and EN; prompts labelled "template, not tested"; a subset of 5 tested with `claude -p` behind the gate, cost declared first. |
| Q6 | Plan prices | Placeholders "to be defined" until the owner fixes them. |
| Q7 | Authors | The owner sends names, bios and photos; the cards ship with named placeholders. |
| Q8 | Token ceiling | 4 M for the two rounds, usage report at the end of each round, warning at 80 %. |

Alerts raised and accepted: client-side gating of content embedded in the HTML is pretending, so member content moves out of the page behind RLS; documenting thesis-review features that do not exist would invent capability, so they go to the roadmap; the agent never creates accounts, enters credentials or card data, so those steps are the owner's, with a checklist.

Deferred by the owner: the scout fan-out (about 450 k subagent tokens, B4 measurement) and the implementation, both to a Codex session as the host-portability test. The spec is `spec.md`; the tickets are `TICKETS.md`; the onboarding is `../handoff-codex.md`.
