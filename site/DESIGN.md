# DESIGN.md: the community portal's visual system

Written at finish from the built page (`site/index.html`), as the impeccable flow prescribes: the rulebook describes the world that shipped, it did not precede it. Any component picked or generated later (for example through the 21st Magic MCP) is filtered by this file.

## World

A Quick Reference Handbook card. The harness is checklists and gates, so the page is set like one: challenge on the left, response on the right, a signal-amber `STOP` line where a human must answer. Two scenes, both composed: a printed card in daylight (light theme) and a night panel next to a terminal (dark theme). Nothing glows, nothing is glass, no gradient anywhere.

## Tokens

| Role | Light | Dark |
|---|---|---|
| paper (page ground) | `#F2F4F6` | `#0F161D` |
| card | `#FFFFFF` | `#16202A` |
| ink (text) | `#14202B` | `#E9EEF3` |
| ink-2 (secondary text, tinted from ink, never gray) | `#3D4B59` | `#A7B4C1` |
| rule / rule-soft | `#C9D1D9` / `#E1E6EB` | `#2B3743` / `#222D38` |
| amber (the committed colour: tab rail, STOP lines, selection, focus) | `#E9A020` fill, `#7A4E00` as text | `#F2B233` fill and text |
| amber-soft (STOP row ground) | `#FBEBC8` | `#3A2C0F` |
| green / red (real states only: a passed check, a failed control arm) | `#1F8A55` / `#C63D2F` | `#4CC585` / `#E8675A` |
| rail (tab index) | ink on `#14202B` | `#0A1015` |

Shadows carry an offset and a soft blur (`0 12px 32px -16px` plus `0 2px 6px -2px`); no zero-offset halos. Borders are 1px; the only heavier rule is the 2px ink rule under a card header, a section heading of the library, or the footer. Radii: 2px on controls, 4px on the card, none on rows.

## Type

- Display and checklist voice: **Archivo**, variable width 75–85, weight 700–800, uppercase for checklist lines, section titles and tabs with `.02em`–`.12em` tracking; headings `text-wrap: balance`, hero tracking `-.02em`.
- Reading: **Public Sans** 400/600, body 1.0625rem, line-height 1.55, measure 62–68ch.
- Code, paths and measurements only: **Red Hat Mono** 400/500, `tabular-nums`. Never as a costume for "technical".
- Scale: .8125 / 1.0625 / 1.25 / 1.625 / 2.25 rem; hero `clamp(2.4rem, 4.6vw, 4.25rem)`.
- Fallback stacks are declared for every face; fonts load from Google Fonts with `display=swap`.

## Space and layout

4px base: 4, 8, 12, 16, 24, 32, 48, 64, 96. Sibling rhythm through `gap`, not per-element margins. More space above a heading than below it (section padding 64 top / 48 bottom, heading margin 24 below). Container 1180px. Desktop: a 104px sticky tab rail on the left, content on the right; hero in two columns (offer left, checklist card right); library in two columns of dotted-rule rows. Under 980px the rail becomes a horizontal sticky strip and every grid collapses to one column; under 560px the checklist response wraps under its challenge.

## Components

- **Checklist card**: header with title and an amber `NORMAL` tab; rows `n · challenge · response · mark`; the mark ticks in on load (scale + stroke draw, exponential ease-out, staggered 250 ms, disabled under `prefers-reduced-motion`); the STOP row has an amber-soft ground and a 6px amber left rule (the one place a coloured left rule is earned: it is the card's own warning convention).
- **Tab rail**: uppercase Archivo labels on ink, amber when current (set by IntersectionObserver; plain anchors without JS).
- **Rows**: title link, description in ink-2, right-aligned mono tag (`pay` amber, `free` green). No cards inside cards.
- **Buttons**: 2px ink border, uppercase Archivo; primary is ink on paper and turns amber on hover; a 1px lift on hover.
- **Gate simulation**: command list left, a night-panel terminal right; `ask:` lines in amber, triage lines in green; y/n buttons disable after one answer.
- **Tables**: uppercase mono-tracked headers, 2px ink header rule, tabular numbers, a state dot for pass/fail, caption below.
- **Icons**: authored inline SVG symbols (`check`, `stop`, `out`), 2px round stroke, one family.

## Browser surfaces

`::selection` amber on ink; `:focus-visible` 2px amber outline with 3px offset; links underlined in amber with `.18em` offset and a thicker underline on hover; `scrollbar-color` from rule and paper; `color-scheme` declared per theme so form controls follow.

## Copy

The product's own words: invariants, benchmark names, recipe titles and numbers as they appear in the repository. Controls name their action ("Install in five commands", "y · allow once", "n · refuse"). No invented users, quotes, prices or capabilities; the simulation says it is a simulation.
