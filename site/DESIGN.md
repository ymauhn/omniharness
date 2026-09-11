---
name: OmniHarness Community Portal
description: A collider event display for an agent-engineering harness; one session is one event, the trigger is the human, the proof is deposited energy.
colors:
  ground: "#0C0E13"
  layer: "#12151C"
  layer-2: "#181C25"
  ink: "#E8EAEE"
  ink-2: "#A3A9B5"
  ink-3: "#7C8391"
  rule: "#232833"
  rule-soft: "#1B1F28"
  steel: "#3B4354"
  steel-dim: "#2A3040"
  accent: "#8B96FF"
  sig-y: "#E2C365"
  sig-c: "#7CB7E8"
  sig-g: "#7BD3A5"
  sig-v: "#C09BF0"
  energy: "#E5737A"
  ok: "#7BD3A5"
  on-sig: "#0C0E13"
typography:
  display:
    fontFamily: "Geist, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2.3rem, 4vw, 3.4rem)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Geist, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.022em"
  lede:
    fontFamily: "Geist, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  body:
    fontFamily: "Geist, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  small:
    fontFamily: "Geist, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "0.14em"
  mono:
    fontFamily: "Geist Mono, Cascadia Mono, SFMono-Regular, Consolas, monospace"
    fontSize: "0.9em"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
rounded:
  control: "4px"
  line: "6px"
  panel: "8px"
  stage: "10px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  s8: "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.title}"
    rounded: "{rounded.line}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-sig}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.line}"
    padding: "12px 24px"
  button-ghost-hover:
    backgroundColor: "{colors.layer}"
    textColor: "{colors.ink}"
  plate:
    backgroundColor: "{colors.layer}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
  lang-segment:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.line}"
    padding: "5px 12px"
  lang-segment-pressed:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-sig}"
  theme-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.line}"
    size: "34px"
  copy-control:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "3px 8px"
  copy-control-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-sig}"
  filter-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  filter-chip-pressed:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-sig}"
  skill-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.mono}"
    rounded: "{rounded.control}"
    padding: "2px 8px"
  skill-chip-current:
    textColor: "{colors.ink}"
  search-input:
    backgroundColor: "{colors.layer}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  command-line:
    backgroundColor: "{colors.layer}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.line}"
    padding: "12px 16px"
  stage-card:
    backgroundColor: "{colors.layer}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stage}"
    padding: "0"
  terminal:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.control}"
    padding: "16px 24px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.line}"
    padding: "8px 12px"
  event-card:
    backgroundColor: "{colors.layer}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
  author-card:
    backgroundColor: "{colors.layer}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stage}"
    padding: "24px"
  avatar:
    backgroundColor: "{colors.layer-2}"
    textColor: "{colors.ink-3}"
    size: "96px"
---

# Design System: OmniHarness Community Portal

v3.1, recorded 2026-09-11 from the shipped page (`site/index.html`; the public edition `site/public/index.html` carries the same CSS, byte for byte). This file replaces the v3 record (Bricolage Grotesque / Schibsted Grotesk / Azeret Mono on a bluer ground, kept in git history). v3.1 keeps the v3 world, the collider event display, and recalibrates its materials against the owner's named bar (Linear, the Vercel changelog, Raycast): one type family in two cuts, a calmer palette, an indigo accent that carries every interactive state, radii graded 4/6/8/10, a header language segment and theme toggle, an inline SVG logo, and an Authors section. The tokens in the frontmatter are the bare `:root`, which is the dark theme; the light theme is a second composition of the same names, listed under Colors.

## Overview

**Creative North Star: "The Collider Event Display"**

The page is an event display and one session is one event. The skills graph is the event itself: tracks curling out of the collision into three detector rings (installed, catalog, remote), the human gate is the trigger that decides which events get recorded, and the benchmarks are deposited energy read off calorimeter bars. The world is dark-native: a near-black ground that is never pure black, rings and rules in a desaturated slate, and colour reserved for what carries information: tracks by edge type, bars for spend, one indigo accent for "you are here" and "this responds". The light theme is not a dimmed copy but the publication figure: white ground, ink rings, the same tracks at print-safe values.

v3.1 calmed the instrument. The signal hues sit at lower chroma than v3, the steel of the rings is nearly neutral, and the yellow that used to mark every interactive state has handed that job to a single accent so that hue on a track means an edge type and nothing else. One family, Geist, does display, reading and labels through weight and size alone; Geist Mono carries every figure, id, path and command with tabular numerals. Density is instrument-like and legible: one column of reading measure beside a pinned stage, label plates that name every zone literally, and a beamline index running down the left of the whole page. Nothing glows, nothing is glass, no gradient exists anywhere in the stylesheet. Motion is one authored moment (the event blooms and cools on load) and then camera moves that follow the reader; everything else is still.

Confirmed rejections, from the direction contract and held by the build: the hero-plus-cards docs template; the dark "AI dev tool" page with neon gradients; a decorative graph that does not navigate; a login form that pretends.

**Key Characteristics:**
- Near-black ground (#0C0E13) with slate rings and rules; colour only on tracks, bars and state; one indigo accent (#8B96FF) for every interactive state.
- One family in two cuts: Geist (display, reading, labels; weight 400–700) and Geist Mono (figures, ids, commands, canvas labels; 400/500).
- Label plates after headings name every zone; wayfinding is reading, never a kicker.
- A 4 px spacing scale (s1–s8) and four radii graded by scale (4/6/8/10 px); 1 px rules carry all structure.
- The beamline index on the left and the pinned stage on the right are the page's silhouette with the content removed; the logo repeats the ring and the three pixel squares.
- One shadow token, soft and low; depth is tonal (ground, layer, layer-2).

## Colors

A slate dark palette with one indigo accent for interaction, four low-chroma signal hues that mean edge types, one red that means spend, and a light theme composed as a publication figure. Frontmatter values are the dark theme; the light theme values below are normative for `:root[data-theme="light"]` and for `prefers-color-scheme: light` without an explicit `data-theme="dark"`.

### Primary
- **Indigo Accent** (`accent`, #8B96FF; light #5E6AD2): every interactive state and every "you are here": the current layer's dot on the beamline (and its text under 1040 px), the current step's left rule and its chips' borders, the pressed language segment and pressed filter chip, the copy, run and read-here controls on hover, the primary button on hover, the theme toggle's border on hover, the terminal's y/n buttons (outline at rest, fill on hover), the plate's dot, the underline under the thesis' emphasised phrase, link underlines on hover, the focus ring, text selection, the compare slider's divider and handle, the `mem` tag, ordered-list markers in Contribute, and the ring and top square of the logo. Always paired with `on-sig` when it fills.

### Secondary
- **Track Yellow** (`sig-y`, #E2C365; light #8F7010): the "precedes" track and the "candidate-for" dotted track; the catalog ring's legend stroke and catalog nodes' stroke on the stage; `ask:` lines in the terminal; the `pay` tag. In v3.1 it no longer marks position or hover.
- **Track Cyan** (`sig-c`, #7CB7E8; light #2A72B0): the "calls" track and its legend swatch, nowhere else.
- **Track Green** (`sig-g`, #7BD3A5; light #1E7F53): the "feeds" track, the remote ring's legend stroke and remote nodes' stroke.
- **Track Violet** (`sig-v`, #C09BF0; light #6E44CC): the "guided-by" track, nowhere else.
- **Pass Green** (`ok`, #7BD3A5; light #1E7F53): the passed-state dot, `free` tags, the members door when open, `ok` lines in the terminal. It is the same value as `sig-g` in both themes; the alias exists so that state and edge type can diverge later without a hunt through the stylesheet.
- **Deposited Energy** (`energy`, #E5737A; light #C43B48): the cost bars and the 100 px scale swatch in the calorimeter, the failed-state dot, and the stroke of a "missing" node on the stage. Never a button, never text.

### Neutral
- **Ground** (`ground`, #0C0E13; light #FFFFFF): the page ground, the terminal, guide code fences, the beamline dots at rest, the ground behind captures, and text on ink-filled surfaces (tooltip, compare labels, primary button).
- **Layer** (`layer`, #12151C; light #F6F7F9): the stage, event cards, author cards, plates, command lines, the ask-list rows, the search field, guides; a catalog or remote node's fill on the stage.
- **Layer 2** (`layer-2`, #181C25; light #EEF0F4): the track drawer (one step above the stage it slides over) and the avatar disc.
- **Ink** (`ink`, #E8EAEE; light #15181E): all primary text, installed nodes and their legend dot, the primary button fill, tooltip and compare-label ground, the ship and three lower squares of the logo, the theme toggle's icon. Body contrast is measured by the visual test, never assumed.
- **Ink 2** (`ink-2`, #A3A9B5; light #4E5563): secondary text: ledes, notes, descriptions, drawer paragraphs, author roles and bios, chip and plate text, resting copy, filter and segment controls, the members door at rest.
- **Ink 3** (`ink-3`, #7C8391; light #66707F): the label voice: uppercase display labels, rail items at rest, table headers, ring names on the stage, tags, the colophon, `dim` terminal lines, the avatar glyph, disabled author links, the "alternative-to" dashed track.
- **Rule** (`rule`, #232833; light #E2E5EA): borders of the stage, event and author cards, plates, terminal, drawer, chips, the language segment, the theme toggle, the avatar, the compare frame; the step rule at rest; the figures' top and bottom rules; the door's dashed border.
- **Rule Soft** (`rule-soft`, #1B1F28; light #EDEFF3): section dividers, header bottom, stage header and legend dividers, run-log and table row dividers, drawer list rows, event-card image rule.
- **Steel** (`steel`, #3B4354; light #8A93A3): the beamline's spine, the crew columns' top rule, the footer's top rule, table header rule, the borders of command lines, ask-list rows, copy, run, filter and search controls; link underlines at rest; the resting ring-legend dot; the fallback track colour on the canvas.
- **Steel Dim** (`steel-dim`, #2A3040; light #D3D8E0): the three painted detector rings on the stage and the scrollbar thumb.
- **On Signal** (`on-sig`, #0C0E13; light #FFFFFF): text on an accent-filled surface (pressed segment and filter, hovers, selection).

### Named Rules
**The One-Accent Rule.** Interaction has one colour. Position, hover, pressed, focus, selection and the slider are `accent`; no signal hue marks a state. A fill in `accent` always pairs with `on-sig`.

**The Tracks-and-Bars Rule.** Signal hue means one thing: an edge type on a track (and the ring that edge type belongs to), spend on a bar, a state on a dot or a tag. No signal colour fills a surface, at rest or on hover.

**The Never-Pure-Black Rule.** The ground is #0C0E13 in the dark theme; pure black does not appear anywhere. Depth comes from the three neutral steps, not from black.

**The Three-States Rule.** Light is a composed theme (the publication figure), not an inversion. Every token has its own light value; the pattern is the bare `:root` (dark), `@media (prefers-color-scheme:light) :root:not([data-theme="dark"])` (the system's choice), and `:root[data-theme="light"]` (the visitor's explicit choice, stamped on `<html data-theme>` by the toggle and remembered in `localStorage`), and `color-scheme` is declared in each so native controls follow. The canvas reads its colours from `getComputedStyle` and repaints on every change.

## Typography

**Display Font:** Geist (with Inter, Segoe UI, system-ui, sans-serif)
**Body Font:** Geist (the same stack; `--display` and `--text` are two names for one face so they can diverge later)
**Label/Mono Font:** Geist Mono (with Cascadia Mono, SFMono-Regular, Consolas, monospace)

**Character:** One neutral grotesk doing every job by weight and size, the way Linear and Raycast set type. Geist at 500 with negative tracking is the display and headline voice; at 600 it is titles and the uppercase label voice with wide tracking; at 400 it reads. Geist Mono carries every figure, id, path, command, transcript line and the node labels painted on the canvas, always with tabular numerals. Both load from Google Fonts with `display=swap` (Geist variable 300–800; Geist Mono 400 and 500); self-hosting was considered and left standing by the owner's page-weight bar, so the fallback stacks above are what a blocked font request renders, and they are declared for every face.

### Hierarchy
- **Display** (500, `clamp(2.3rem, 4vw, 3.4rem)`, 1.06, `-.03em`): the thesis in the first viewport only; `text-wrap: balance`; the emphasised phrase is underlined in `accent` at `.07em` thickness and `.16em` offset, not italic.
- **Headline** (500, 2.25rem, 1.08, `-.025em`): section headings, each followed on the same baseline by its plate.
- **Title** (600 at 1.1875rem, `-.022em`): h3s in cards, guides and the author card; steps use 500 at 1.5rem, crew columns 500 at 1.1875rem. The drawer's title is mono 500 at 1rem because it is an id.
- **Lede** (400, 1.1875rem, 1.55; `ink-2`, 64ch): the paragraph under a section heading; the hero paragraph shares it at 62ch.
- **Body** (400, 1rem, 1.6): reading text; step paragraphs 50ch, author bio 60ch, contribute list 68ch, member guides 76ch at .95rem, event card and table text .9rem, drawer paragraphs .92rem.
- **Small** (400, .8125rem, 1.5; `ink-2` or `ink-3`): descriptions under a title (`.d`), notes, the table caption, the tooltip, the colophon.
- **Label** (600, .72rem, uppercase): plates, rail items, figure captions, table headers, stage header and legend, tags, drawer terms, compare labels, footer invariant titles, the language segment, the edition badge, the wordmark's sub-label. Tracking grades by context: `.14em` on rail, figure and table labels; `.12em` on the stage header, ring legend, filter and run controls, drawer and event terms; `.1em` on plates, copy controls, the edition badge and the track legend; `.08em` on the language segment and the tooltip's ring line. Weight steps to 500 on table headers, invariant titles and the wordmark's sub-label, and to 400 on the step index ("L1"…"L9").
- **Mono** (400/500, `.9em` in text; .74rem chips; .78–.8rem ids, tags, drawer and table figures; .86–.88rem terminal and commands; 1rem hero figures; `tabular-nums`): every number, id, path, command and transcript line. On the canvas: node labels in `500 11px "Geist Mono"` (scaled by zoom), ring names in `600 10px "Geist"` uppercase.

### Named Rules
**The Plate-Not-Kicker Rule.** The label that names a zone comes after its heading, on the same baseline, inside a plate; a label above a heading does not exist on this page and is not to be introduced.

**The Figures-Are-Mono Rule.** A number, an id, a path or a command is set in Geist Mono with tabular numerals; a number in the reading face is a defect.

**The One-Family Rule.** Geist and Geist Mono are the only faces. Hierarchy is weight (400/500/600, 700 on the wordmark alone) and size; no third family, no italics (the thesis' emphasis is an underline), no variable axes beyond weight.

## Layout

The container is 1240 px wide with 24 px side padding (16 px under 560 px). The header is one row: the wordmark with its 28 px inline logo on the left; on the right a nav of three links, the edition badge, the language segment (PT-BR | EN) and the 34 px theme toggle, 24 px apart. Below it a two-column frame: the beamline index at 132 px on the left, sticky at 24 px from the top, and the content column at the remainder, 48 px apart. The first two sections share an event grid, `.9fr | minmax(360px, 1.1fr)` with a 48 px gutter: the thesis and the layers stack on the left, the stage card occupies the right and is sticky at 16 px from the top, so the layers scroll under it while it stays. The graph is `min(72vh, 720px)` tall on desktop.

Rhythm is the 4 px scale in the frontmatter (s1–s8: 4, 8, 12, 16, 24, 32, 48, 64) used through `gap` and section padding, never per-element margins between siblings. Sections carry 64 px above and 48 px below with a 1 px `rule-soft` divider; the section head sits 24 px above its lede, the lede 32 px above the content. The steps list uses a 64 px gap so each layer enters the observer alone. The ~4 px cluster (plate, chip, tag and control padding) is micro-padding and is not the page rhythm.

Other grids: the trigger simulation `.9fr | 1.1fr` at 32 px; the crew three equal columns at 32 px; the strata three equal columns at 24 px; the hero figures five auto columns; the authors one column at 820 px maximum, each card `96px | 1fr` at 24 px; the footer invariants five columns at 24 px. The calorimeter table has a 960 px minimum width inside a horizontally scrolling wrapper.

Breakpoints: at 1040 px the frame collapses to one column, the beamline becomes a horizontal sticky strip at the top (its dots and sub-labels hidden, the current item in `accent`), the event grid stacks as hero, stage, layers with the stage sticky at 44 px and `min(44vh, 420px)` tall, the drawer rises from the bottom at 70% height, and the sim, crew, strata and author card become single columns; figures go to three columns, invariants to two. At 560 px the header stacks, command and run-log rows lose their right column, controls get a 44 px minimum height, the search fills the width, and invariants go to one column. On touch, the graph canvas keeps `pan-y pinch-zoom` so the page still scrolls through the stage.

## Elevation & Depth

Depth is tonal. Three neutral steps (ground, layer, layer-2) and two rule weights do all the layering; a raised surface is one step lighter with a 1 px `rule` border. There is one shadow token and it sits under the stage card only: soft, low, two layers. Hover lifts are 1 px translations, not shadow growth. The drawer covers the stage as a solid `layer-2` panel with a `rule` left border, no scrim, no blur. Nothing glows and no backdrop filter exists.

### Shadow Vocabulary
- **Stage** (`box-shadow: 0 6px 10px -8px rgba(0,0,0,.7), 0 1px 2px rgba(0,0,0,.5)`; light `0 6px 10px -8px rgba(16,23,34,.28), 0 1px 2px rgba(16,23,34,.12)`): the pinned stage card, the one surface that floats over scrolling content.

### Named Rules
**The One-Shadow Rule.** The `--shadow` token is the only shadow, and the stage is the only element that carries it. A new component earns depth through `layer`/`layer-2` and a rule, not through a new shadow.

## Shapes

Rectilinear with four radii that grade by scale, calibrated to Linear's and Raycast's softness: 4 px on controls (plates, copy and run controls, filter and skill chips, the search field, the drawer's close, the edition badge, the compare labels, the focus ring), on the terminal and on the compare frame; 6 px on framed lines and small containers (command lines, ask-list rows, buttons, the language segment, the theme toggle, the tooltip, guides and their code fences, the members door); 8 px on event cards; 10 px on the stage and the author card. Energy bars and the scale swatch use 1 px; the only circles are dots and discs: the beamline marker (7 px), plate and legend dots (6–8 px), state dots (.55em), the compare handle (26 px with a 3 px ground border), the avatar (96 px), nodes on the canvas (2.6 px, 3.6 px when isolated) and the logo's ring.

Every border is 1 px; the only heavier strokes are the 2 px link underline on hover, the 2 px slider divider, the 2 px legend track swatches and the 2 px avatar glyph. Structure is drawn with rules on one side: the beamline's left spine, the step's left rule, the crew column's top rule, the footer's top rule, the table header's bottom rule. The members door is the one dashed border, and it turns solid when the door is open; a not-yet-filled author link carries a dashed underline in `ink-3`. Rings on the stage are painted at 1 device pixel regardless of zoom.

The logo is the page's geometry at 32 units: a ring (`accent`, 1.6 stroke), a ship (the triangular track in `currentColor`, 1.8 stroke, round joins) and four 3-unit pixel squares, one at the top in `accent` and three at the base and centre in `currentColor`. The favicon repeats it with the dark values baked in.

## Components

### Buttons
- **Shape:** framed (6 px), 12 × 24 px padding, Geist 600 at .95rem with `.01em` tracking, 1 px border.
- **Primary:** ink fill, ground text, ink border; hover turns `accent` with `on-sig` text and lifts 1 px (180 ms, `cubic-bezier(.16,1,.3,1)`).
- **Ghost:** transparent, ink text, `rule` border; hover fills `layer` with a `steel` border.
- **Focus:** the global ring (2 px `accent`, 3 px offset, 4 px radius).
- **Small controls** (copy, run, read here, filter, drawer close): the label voice at .72rem uppercase, 1 px `steel` or `rule` border, 4 px radius, transparent; every one fills `accent` with `on-sig` on hover or when pressed; the terminal's y/n buttons and the read-here control are `accent`-outlined with `accent` text at rest. Every control names its action in its text.

### Header controls
- **Language segment** (`.seg`): a 6 px-radius frame in `rule` holding two buttons (PT-BR, EN) in the label voice at `.08em`, 5 × 12 px padding, transparent with `ink-2` text; the pressed one (`aria-pressed="true"`) fills `accent` with `on-sig`. The choice is remembered in `localStorage` and translates the page in place from one dictionary.
- **Theme toggle** (`.theme`): a 34 px square, 1 px `rule` border, 6 px radius, transparent, `ink` icon; hover turns the border `accent`. It shows the sun when the effective theme is dark and the moon when it is light (resolved by `data-theme` first, then `prefers-color-scheme`), stamps the explicit choice on `<html data-theme>`, saves it, swaps the captures' sources, and rereads the canvas tokens.
- **Wordmark** (`.mark`): the 28 px logo, "OmniHarness" in Geist 700 at 1.15rem, and a sub-label ("event display") in the label voice at 500, `ink-3`.
- **Edition badge** (`.edition`): the label voice at `.1em`, 1 px `rule` border, 3 × 8 px, 4 px radius, `ink-2`; reads "public edition" or "members edition" from `<html data-edition>`.

### Label plates
- **Style:** inline-flex, the label voice (.72rem, `.1em`, uppercase, 600), `ink-2` text with the zone name in `ink` at 500, `layer` fill, 1 px `rule` border, 4 × 12 px padding, 4 px radius; an optional 6 px `accent` dot.
- **Placement:** after the section's h2 on the same baseline (`.sec-head`), or after a crew column's h3; never above a heading. Zones: Event, Trigger, Layers, Run log, Shift crew, Calorimeter, Events 1–3, Authors, Contribute, plus Open core, The vault, Services.

### Beamline (the layer index)
- **Style:** a sticky column with a 1 px `steel` left spine; items in the label voice (`ink-3`, `.14em`), each with a body-face sub-label at .78rem in `ink-2` and a 7 px ground-filled, steel-stroked dot sitting on the spine.
- **States:** hover `ink`; current (`aria-current`, set by an IntersectionObserver at `-30% 0 -60%`) turns the text `ink` and the dot `accent`. Under 1040 px it becomes a horizontal strip with the current item's text in `accent`.

### Stage (the event)
- **Card:** `layer` fill, 1 px `rule`, 10 px radius, the stage shadow, `overflow: hidden`; a header row in the label voice (`ink-3`, `.12em`) with the graph name in `ink` and a live count ("86 tracks · 84 links"); a legend row below with the three ring dots (installed filled ink, catalog yellow-stroked, remote green-stroked) and six 14 px track swatches.
- **Canvas:** force-graph 1.51.4 on a transparent background; three rings painted every frame in `steel-dim` at 1 device pixel with uppercase Geist 600 names in `ink-3` above them at radii .44, .74 and .96 of the stage; nodes 2.6 px, installed filled `ink`, catalog `layer`-filled with a `sig-y` stroke, remote with a `sig-g` stroke, missing with an `energy` stroke; tracks coloured by type (calls cyan, precedes yellow, feeds green, guided-by violet, alternative-to `ink-3`, candidate-for yellow) and every type but calls also dashed (`7 3`, `2 3`, `10 3 2 3`, `3 3`, `1 3`) so hue is never the only code; .12 curvature; labels in Geist Mono 500 at 11 px appear on isolation, hover, or above 2.2× zoom. Isolation dims the rest to .18 alpha and thickens lit tracks to 1.6 px (.8 at rest, .35 dimmed). Colours are read from the tokens at load and on every theme change.
- **Tooltip:** ink fill, ground text, 6 px radius, 8 × 12 px padding, 30ch max; mono id, the description, the ring in the label voice at .75 opacity.
- **Drawer:** 360 px from the right (full width from the bottom under 1040 px), `layer-2`, 1 px `rule` edge, 24 px padding; enters in 320 ms `cubic-bezier(.16,1,.3,1)`; a close control top-right, the ring in the label voice, the id as a mono h3, the description, a `dl` of tracks and ring, the track list (mono .78rem, `rule-soft` rows, arrows for direction), and "open the source" as a mono link with the out-icon. Escape or a background click closes it; focus moves to the close control on open.
- **Keyboard track list:** a visually hidden `ul` of one button per node that becomes a wrapped mono list when focused, so the graph's information is reachable without the pointer.

### Layer steps and chips
- **Step:** 1 px `rule` left border and 24 px left padding; the title is Geist 500 at 1.5rem with an "L1"…"L9" index in the label voice at 400; the paragraph in `ink-2` at 50ch; a row of skill chips.
- **Current:** the left rule turns `accent` (300 ms) and the chips' borders with it, chip text to `ink`; set by an IntersectionObserver at the viewport's middle band, which also isolates the step's tracks on the stage and moves the camera.
- **Chip:** Geist Mono .74rem, 2 × 8 px padding, 1 px `rule` border, 4 px radius, `ink-2`; no fill in either state.

### Trigger (the gate simulation)
- **Ask list:** rows in `layer` with a 1 px `steel` border and 6 px radius, the command in mono at .88rem with a `.d` description, a `Run` control at the right.
- **Terminal:** `ground` fill, 1 px `rule`, 4 px radius, 16 × 24 px padding, Geist Mono .86rem at 1.65, 8rem minimum height, `role="log"`; line voices: `ask` in `sig-y`, `ok` in pass green, `dim` in `ink-3`, plain in `ink`; a y/n prompt row with `accent`-outlined buttons that fill `accent` on hover and disable after the answer at .4 opacity. The first line says it is a simulation.

### Run log (filters and rows)
- **Filter chips:** the label voice at .72rem, 8 × 12 px, 1 px `steel` border, 4 px radius, `ink-2`; pressed (`aria-pressed`) fills `accent` with `on-sig` text. Grouped by kind and by host in 4 px gaps; a search field in `layer` with a `steel` border and a 16rem minimum width; a live count in Geist .74rem `ink-3`.
- **Rows:** `1fr | auto` grid, 12 px vertical padding, `rule-soft` dividers; the title at 500 with a `.d` description in `ink-2`; right-aligned tags in Geist .72rem at `ink-3`, coloured only by meaning (`pay` yellow, `free` pass green, `mem` accent with the lock icon). A member guide opens inline as a `layer` box (6 px radius) at 76ch rendering the markdown subset; its `read here` control is `accent`-outlined and fills on hover.

### Crew columns and the door
- **Columns:** three, each opened by a 1 px `steel` top rule and 16 px padding; an h3 at 500, a plate under it, a bulleted list in `ink-2` at .95rem.
- **Door:** a mono .8rem box with a dashed 1 px `rule` border and 6 px radius, the lock icon and the reason there is no login form; in the members edition the border is solid pass green with the check icon and green text.

### Calorimeter (the proof table)
- **Table:** full width, .9rem, `rule-soft` row dividers; headers in the label voice at 500 with a 1 px `steel` bottom rule; each benchmark cell carries a bold (500) name, a `.d` description and the rerun command in mono; a state dot before the result (pass green, fail red).
- **Energy bars:** an inline 8 px bar in `energy` at 1 px radius, width in px equal to cents (100 px = $1.00), beside the dollar figure; the header draws the scale as a 100 px × 6 px swatch labelled "= $1.00". Token-only rows carry no bar. The caption sits below the table in `ink-2` at .8125rem and carries the caveat.

### Events strata and the compare slider
- **Event card:** `layer`, 1 px `rule`, 8 px radius; a header in the label voice with the event name in `ink` and its date; a 16:10 capture (`object-fit: cover`, top-anchored, ground behind, its source swapped by the theme toggle); a body at 16 px with `ink-2` text at .9rem and a mono `dl` of measurements.
- **Compare:** a 16:9 frame (4 px radius) with two full-bleed captures, the "after" clipped by `--cut`; a 2 px `accent` divider with a 26 px `accent` circle handle (3 px ground border); ink-filled compare labels top-left and top-right; the whole frame is an invisible range input with an `ew-resize` cursor. The slider compares and never hides; the three events stay exposed above it.

### Authors
- **Card** (`.author`): `layer`, 1 px `rule`, 10 px radius, 24 px padding, a `96px | 1fr` grid at 24 px (one column under 1040 px); at most 820 px wide.
- **Avatar** (`.avatar`): a 96 px disc in `layer-2` with a 1 px `rule` border holding the authored avatar symbol (56 px, 2 px round stroke) in `ink-3`; never a raster until the maintainer supplies one.
- **Text** (`.who`): the name as a title h3 (600, 1.1875rem); the role in `ink-2` at .95rem; the bio in `ink-2` at 60ch and 1.55; a row of links (`.links`) at .9rem in 8 × 16 px gaps, each with the out-icon; a link not yet supplied is `aria-disabled`, `ink-3`, with a dashed underline, and its text says what to add.

### Footer
- **Invariants:** five columns (two, then one, at the breakpoints) opened by a 1 px `steel` top rule, each title in the label voice at 500 in `ink` and the body in `ink-2` at .9rem; then a colophon row in Geist .8125rem at `ink-3` with the licence, the version, the graph date, the one library and the repository link.

### Browser surfaces
- Selection: `accent` with `on-sig` text. Focus: 2 px `accent` outline, 3 px offset, 4 px radius, `:focus-visible` only. Links: inherit colour, 1 px `steel` underline at `.2em` offset, 2 px `accent` on hover. Scrollbar: `steel-dim` thumb on `ground`. `color-scheme` per theme. Icons: six authored inline SVG symbols (check, out, lock, sun, moon, avatar) at 1em (the avatar at 56 px), 1.75 round stroke, `currentColor`; the logo is inline SVG in the wordmark and, with the dark values baked in, the favicon.

### Motion
- **The bloom:** on load the force simulation runs from the beamline outward and cools in 3.2 s (`cooldownTime 3200`, alpha decay .028, velocity decay .32), then the whole event fits the stage. It is the page's one authored moment.
- **Camera:** each layer change isolates its tracks and calls `zoomToFit` over 700 ms with 48 px padding, capped at 2.4× so a two-track layer never fills the stage with two dots; CSS state transitions (step rule, chips, drawer, buttons, rail, copy, run, filters) use `cubic-bezier(.16,1,.3,1)`, an exponential ease-out, at 150–320 ms.
- **Reduced motion:** alpha decay 1, 220 warm-up ticks and zero cooldown settle the layout before the first frame; the camera moves in 0 ms; every CSS transition is off; `scroll-behavior` is `auto`. The graph still repaints on a colour-scheme change.

### Copy
- The product's own words: invariants, benchmark ids, skill names and numbers as they stand in the repository, each number with its command and its date. Controls name their action (copy, Run, y · allow once, n · refuse, read here, close, Switch theme, PT-BR, EN, Join the discussions, Open a pull request). The simulation says it is a simulation; the door says why there is no login form; the Authors section says which lines are placeholders; prices are not set and are not invented; a value the build has not filled says "pending" or "add the link".

## Do's and Don'ts

### Do:
- **Do** place a zone's name in a plate after its heading (`.sec-head`: h2, then `.plate`), and give every new zone one.
- **Do** keep the ground at #0C0E13 (#FFFFFF in light) and layer surfaces with `layer` and `layer-2` plus a 1 px `rule`; the stage's shadow is the only shadow.
- **Do** set every number, id, path and command in Geist Mono with `tabular-nums`, and every label in Geist 600 at .72rem uppercase with tracking between `.08em` and `.14em`.
- **Do** give every interactive state (current, pressed, hover, focus, selection, the slider) to `accent`, and pair every `accent` fill with `on-sig`.
- **Do** colour by meaning only: tracks by type with a dash per type, bars in `energy` at 100 px per dollar, dots and tags by state.
- **Do** compose both themes through the three-state token pattern and declare `color-scheme` in each; read tokens from `getComputedStyle` when painting a canvas, and repaint on scheme change or toggle.
- **Do** grade radii by scale: 4 px controls, 6 px framed lines, 8 px cards, 10 px the stage and the author card.
- **Do** honour reduced motion by settling layout before the first frame and turning every transition off; keep the bloom the only authored moment.
- **Do** measure before quoting: body contrast, overflow, page weight and console errors come from `tests/visual/shoot.py`, not from this file.

### Don't:
- **Don't** put a label above a heading (a kicker or eyebrow); the plate after the heading is the only label placement.
- **Don't** use a gradient, a glow, a blur, glass or a backdrop filter; none exists in the stylesheet.
- **Don't** add a second shadow token or move the shadow off the stage.
- **Don't** mark a state with a signal hue: `sig-y` is a track and a tag, never "you are here"; `energy` is spend and failure, never a button; `sig-v` lives only on the guided-by track.
- **Don't** fill a surface with a signal colour, at rest or on hover; only `accent` and `ink` fill.
- **Don't** add a face beyond Geist and Geist Mono, an italic, a weight outside 400–700, or a radius outside 4/6/8/10 px (1 px on bars).
- **Don't** invent users, quotes, prices, adoption numbers, a biography or a login form; a line the maintainer has not filled says so in its own text.
- **Don't** animate anything beyond the bloom, the camera and the 150–320 ms state transitions; nothing reveals on scroll.
