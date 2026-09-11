# DESIGN.md: the community portal's visual system

Written at finish from the built page (`site/index.html`), as the impeccable flow prescribes: the rulebook describes the world that shipped, it did not precede it. v2 (2026-09-11) extends v1 (2026-09-10) inside the same world; nothing in v1 was replaced. Any component picked or generated later (for example through the 21st Magic MCP) is filtered by this file.

## World

A Quick Reference Handbook card. The harness is checklists and gates, so the page is set like one: challenge on the left, response on the right, a signal-amber `STOP` line where a human must answer. Two scenes, both composed: a printed card in daylight (light theme) and a night panel next to a terminal (dark theme). Nothing glows, nothing is glass, no gradient anywhere. v2 adds an index rail with seven tabs, a sticky diagram panel, filter chips, and transcript frames; all inherit the card's rules.

## Tokens

| Role | Light | Dark |
|---|---|---|
| paper (page ground) | `#F2F4F6` | `#0F161D` |
| card | `#FFFFFF` | `#16202A` |
| ink (text) | `#14202B` | `#E9EEF3` |
| ink-2 (secondary text, tinted from ink, never gray) | `#3D4B59` | `#A7B4C1` |
| rule / rule-soft | `#C9D1D9` / `#E1E6EB` | `#2B3743` / `#222D38` |
| amber (the committed colour: rail, STOP rows, active chips, highlighted subgraph, selection, focus) | `#E9A020` fill, `#7A4E00` as text | `#F2B233` fill and text |
| amber-soft (STOP row and active chip ground) | `#FBEBC8` | `#3A2C0F` |
| green / red (real states only: a passed check, a failed control arm, the remote ring) | `#1F8A55` / `#C63D2F` | `#4CC585` / `#E8675A` |
| blue (one data hue, the `guided-by` edge only) | `#2F6FD1` | `#6FA0F0` |
| rail (index tabs, terminal and frames) | `#14202B`, dim text `#8FA0B0` | `#0A1015` |

Shadows carry an offset and a soft blur (`0 12px 32px -16px` plus `0 2px 6px -2px`); no zero-offset halos. Borders are 1px; the only heavier rules are the 2px ink rule under a card header, a library heading and the footer, and the 6px amber left rule of a STOP row (the card's own warning convention). Radii: 2px on controls and chips, 3px on frames and guides, 4px on cards, none on rows.

## Type

- Display and checklist voice: **Archivo**, variable width 75–85, weight 700–800, uppercase for checklist lines, section titles, tabs and filter chips with `.02em`–`.12em` tracking; headings `text-wrap: balance`, hero tracking `-.02em`.
- Reading: **Public Sans** 400/600, body 1.0625rem, line-height 1.55, measure 52–68ch (steps 52ch, ledes 62ch, guides 76ch).
- Code, paths, measurements, transcript frames and graph labels only: **Red Hat Mono** 400/500, `tabular-nums`. Never as a costume for "technical"; the frames are transcripts, which is data.
- Scale: .8125 / 1.0625 / 1.25 / 2.25 rem; hero `clamp(2.3rem, 4.4vw, 4rem)`; chips and tabs .72–.78rem.
- Fallback stacks are declared for every face; fonts load from Google Fonts with `display=swap`, the page's only external request.

## Space and layout

4px base: 4, 8, 12, 16, 24, 32, 48, 64. Sibling rhythm through `gap`, not per-element margins. More space above a heading than below it (section padding 64 top / 48 bottom, heading margin 24 below). Container 1180px. Desktop: a 104px sticky rail on the left, content on the right. Hero in two columns (offer, checklist card). Flow in two columns (steps with generous 64px gaps so each enters the observer alone; the sticky panel). Members in two columns (the explanation, the door card). Showcase steps in two columns (facts, frame). Under 980px the rail becomes a horizontal sticky strip, the panel sticks under it at a 16:10 aspect, and every grid collapses to one column; under 560px the checklist response wraps under its challenge and rows lose their right column.

## Components

- **Checklist card** (v1, seven rows in v2): rows `n · challenge · response · mark`; rows one and two carry a `copy` control (mono, 1px rule, amber on hover); the mark ticks in on load, staggered 200 ms, exponential ease-out, off under `prefers-reduced-motion`; the last row is the STOP row.
- **Rail**: seven uppercase Archivo tabs on ink, amber when current (IntersectionObserver; plain anchors without JS).
- **Steps**: a 2px left rule that turns amber when the step is current; a mono step number; chips naming the skills, filled amber-soft when current. Numbered because the flow is a sequence.
- **Diagram panel**: a card holding a square canvas; three rings (installed nodes filled ink at 0.6R, catalog hollow amber at 0.82R, remote hollow green at 0.96R), same-ring edges as quadratic curves pulled toward the centre, cross-ring edges straight; edge colour by type (calls ink-2, precedes amber, feeds green, guided-by blue, alternative-to dashed ink-2, candidate-for dashed amber); the current step's subgraph at full alpha with labels, the rest at .07/.22; hover shows a tooltip (id, description, ring) and click opens the node's source. Legend below on desktop only.
- **Filters**: uppercase Archivo chips with a 1px ink rule, amber fill when pressed; a search input in the card colour; a mono count.
- **Rows** (v1): title link, description in ink-2, right-aligned mono tags (`pay` amber, `free` green, member `mem` amber with the lock glyph); a `read here` control in the members edition opens the guide inline.
- **Guide**: a card-coloured box, 76ch, rendering the markdown subset (headings in Archivo, paragraphs, flat lists, fences on the rail colour).
- **Door** (members): a card with a dashed state line (public: lock; members: solid green check) and the reason there is no login form.
- **Proof table**: uppercase mono-tracked headers, 2px ink header rule, tabular numbers, a state dot (green pass, red fail, amber pending), the reproduce command in mono, a caption with the caveat.
- **Frames** (showcase): rail-coloured transcript boxes with a dim title bar (source, timestamp), mono 0.8rem, amber for headings inside the transcript, green for a pass, red for a denial, dim for prompts; scroll inside at 24rem.
- **Buttons** (v1): 2px ink rule, uppercase Archivo; primary ink on paper, amber on hover; a 1px lift.
- **Gate simulation** (v1): command list left, night terminal right; `ask:` lines amber, triage lines green.
- **Icons**: authored inline SVG symbols (`check`, `stop`, `out`, `lock`), 2px round stroke, one family.

## Browser surfaces

`::selection` amber on ink; `:focus-visible` 2px amber outline with 3px offset; links underlined in amber with `.18em` offset and a thicker underline on hover; `scrollbar-color` from rule and paper; `color-scheme` declared per theme so form controls (the search input) follow; the canvas rerenders on theme change.

## Copy

The product's own words: invariants, benchmark names, recipe titles and numbers as they appear in the repository. Controls name their action ("copy", "read here", "y · allow once", "n · refuse"). No invented users, quotes, prices or capabilities; the simulation says it is a simulation; the members door says why there is no login form; every pending number says "pending" until the build fills it from `site/showcase/06-metrics.json`.
