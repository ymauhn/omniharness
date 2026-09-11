---
name: OmniHarness Community Portal
description: A collider event display for an agent-engineering harness; one session is one event, the trigger is the human, the proof is deposited energy.
colors:
  ground: "#0A0E15"
  layer: "#111827"
  layer-2: "#18233A"
  ink: "#E6ECF5"
  ink-2: "#9AA8BC"
  ink-3: "#7A8BA3"
  rule: "#223047"
  rule-soft: "#1A2536"
  steel: "#4F6B8F"
  steel-dim: "#2C3E57"
  sig-y: "#FFD23F"
  sig-c: "#3DD6F0"
  sig-g: "#7AF0A6"
  sig-v: "#C08BFF"
  energy: "#FF4D4D"
  ok: "#7AF0A6"
  on-sig: "#0A0E15"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Archivo, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 4.3vw, 3.6rem)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.03em"
    fontVariation: "'opsz' 96, 'wdth' 85"
  headline:
    fontFamily: "Bricolage Grotesque, Archivo, system-ui, sans-serif"
    fontSize: "2.44rem"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.02em"
    fontVariation: "'opsz' 96, 'wdth' 90"
  title:
    fontFamily: "Bricolage Grotesque, Archivo, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
    fontVariation: "'opsz' 96, 'wdth' 90"
  body:
    fontFamily: "Schibsted Grotesk, Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  lede:
    fontFamily: "Schibsted Grotesk, Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Bricolage Grotesque, Archivo, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "0.14em"
    fontVariation: "'opsz' 12, 'wdth' 92"
  mono:
    fontFamily: "Azeret Mono, Red Hat Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "0.9em"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
rounded:
  control: "2px"
  frame: "3px"
  panel: "4px"
  stage: "6px"
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
    rounded: "{rounded.frame}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "{colors.sig-y}"
    textColor: "{colors.on-sig}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.frame}"
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
  copy-control:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "3px 8px"
  copy-control-hover:
    backgroundColor: "{colors.sig-y}"
    textColor: "{colors.on-sig}"
  filter-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  filter-chip-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
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
    rounded: "{rounded.frame}"
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
    rounded: "{rounded.panel}"
    padding: "16px 24px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.frame}"
    padding: "8px 12px"
  event-card:
    backgroundColor: "{colors.layer}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
---

# Design System: OmniHarness Community Portal

v3, recorded 2026-09-11 from the shipped page (`site/index.html`; the public edition `site/public/index.html` carries the same CSS). This file replaces the v2 record (the Quick Reference Handbook card, kept in git history): v3 is a different world, chosen in the direction round (seed 3e54bb16) and built under the ponytail ruleset with Playwright visual TDD. The tokens in the frontmatter are the bare `:root`, which is the dark theme; the light theme is a second composition of the same names, listed under Colors.

## Overview

**Creative North Star: "The Collider Event Display"**

The page is an event display and one session is one event. The skills graph is the event itself: tracks curling out of the collision into three detector rings (installed, catalog, remote), the human gate is the trigger that decides which events get recorded, and the benchmarks are deposited energy read off calorimeter bars. The world is dark-native: a near-black vacuum ground that is never pure black, detector rings and rules in muted steel blue, and colour reserved for what carries information: tracks by edge type, bars for spend, one yellow dot for the current layer. The light theme is not a dimmed copy but the publication figure: white ground, ink rings, the same tracks at print-safe values.

Density is instrument-like and legible: one column of reading measure beside a pinned stage, label plates that name every zone literally, tabular figures wherever a number sits, and a beamline index running down the left of the whole page. Nothing glows, nothing is glass, no gradient exists anywhere in the stylesheet. Motion is one authored moment (the event blooms and cools on load) and then camera moves that follow the reader; everything else is still.

Confirmed rejections, from the direction contract and held by the build: the hero-plus-cards docs template; the dark "AI dev tool" page with neon gradients; a decorative graph that does not navigate; a login form that pretends.

**Key Characteristics:**
- Near-black vacuum ground (#0A0E15) with steel-blue rings and rules; colour only on tracks, bars and state.
- Three faces with three jobs: Bricolage Grotesque (display and labels, opsz/wdth axes), Schibsted Grotesk (reading), Azeret Mono (figures, ids, commands).
- Label plates after headings name every zone; wayfinding is reading, never a kicker.
- A 4 px spacing scale (s1–s8) and four radii (2/3/4/6 px); 1 px rules carry all structure.
- The beamline index on the left and the pinned stage on the right are the page's silhouette with the content removed.
- One shadow token, soft and low; depth is tonal (ground, layer, layer-2).

## Colors

A steel-blue dark palette with four signal hues that mean edge types, one red that means spend, and a light theme composed as a publication figure. Frontmatter values are the dark theme; the light theme values below are normative for `:root[data-theme="light"]` and for `prefers-color-scheme: light` without an explicit `data-theme="dark"`.

### Primary
- **Trigger Yellow** (`sig-y`, #FFD23F; light #8A6700): the "precedes" track and the "candidate-for" dotted track; the current-layer dot on the beamline; the current step's left rule and its chips' borders; `ask:` lines and the y/n buttons in the terminal; the `pay` tag; the compare slider's handle; the copy control and primary button on hover; text selection. It is the colour of "this is where you are" and "this asks for a yes".
- **Track Cyan** (`sig-c`, #3DD6F0; light #077A90): the "calls" track; the focus ring; the underline on link hover; the plate's dot; the `Run` and `read here` controls on hover; the `mem` tag; ordered-list markers in Contribute.

### Secondary
- **Track Green** (`sig-g`, #7AF0A6; light #177347): the "feeds" track and the remote ring's stroke.
- **Track Violet** (`sig-v`, #C08BFF; light #6A3FC6): the "guided-by" track, nowhere else.
- **Pass Green** (`ok`, #7AF0A6; light #177347): the passed-state dot, `free` tags, the members door when open, `triage:` lines in the terminal. It is the same value as `sig-g` in both themes; the alias exists so that state and edge type can diverge later without a hunt through the stylesheet.
- **Deposited Energy** (`energy`, #FF4D4D; light #C42A2A): the cost bars and the 100 px scale swatch in the calorimeter, the failed-state dot, and the stroke of a "missing" node on the stage. Never a button, never text.

### Neutral
- **Vacuum** (`ground`, #0A0E15; light #FFFFFF): the page ground, the terminal, guide code fences, the beamline dots at rest, and text on the ink-filled tooltip, labels and pressed chips.
- **Layer** (`layer`, #111827; light #F4F6FA): the stage, event cards, plates, command lines, the search field, guides, the ask-list rows; a catalog or remote node's fill on the stage.
- **Layer 2** (`layer-2`, #18233A; light #E9EEF6): the track drawer only, one step above the stage it slides over.
- **Ink** (`ink`, #E6ECF5; light #101722): all primary text, installed nodes, the primary button and pressed filter fill, tooltip and compare-label ground. Body contrast is measured by the visual test, never assumed.
- **Ink 2** (`ink-2`, #9AA8BC; light #4B5A70): secondary text: ledes, notes, descriptions, drawer paragraphs, chip and plate text, resting copy and filter controls.
- **Ink 3** (`ink-3`, #7A8BA3; light #5E6E86): the label voice: uppercase display labels, rail items at rest, table headers, ring names on the stage, tags, the colophon, `dim` terminal lines, the "alternative-to" dashed track.
- **Rule** (`rule`, #223047; light #D6DEE9): borders of the stage, event cards, plates, terminal, drawer and chips; the step rule at rest; the figures' top and bottom rules.
- **Rule Soft** (`rule-soft`, #1A2536; light #E8EDF4): section dividers, header bottom, stage header and legend dividers, run-log and table row dividers, drawer list rows.
- **Steel** (`steel`, #4F6B8F; light #6B819E): the beamline's spine, the crew columns' top rule, the footer's top rule, table header rule, the borders of command lines, ask-list rows, copy, run, filter and search controls; link underlines at rest; the resting ring-legend dot.
- **Steel Dim** (`steel-dim`, #2C3E57; light #B9C6D8): the three painted detector rings on the stage and the scrollbar thumb.
- **On Signal** (`on-sig`, #0A0E15; light #FFFFFF): text on a signal-filled surface (yellow or cyan fills on hover, selection).

### Named Rules
**The Tracks-and-Bars Rule.** Hue means one thing: an edge type on a track, spend on a bar, a state on a dot or a tag. No signal colour fills a surface at rest; a fill in yellow or cyan is a hover or a selection, and it always pairs with `on-sig`.

**The Never-Pure-Black Rule.** The ground is #0A0E15 in the dark theme; #000000 does not appear. Depth comes from the three neutral steps, not from black.

**The Two-Compositions Rule.** Light is a composed theme (the publication figure), not an inversion. Every token has its own light value; the three-state pattern is the bare `:root` (dark), `@media (prefers-color-scheme:light) :root:not([data-theme="dark"])`, and `:root[data-theme="light"]`, and `color-scheme` is declared in each so native controls follow.

## Typography

**Display Font:** Bricolage Grotesque (with Archivo, system-ui, sans-serif)
**Body Font:** Schibsted Grotesk (with Public Sans, Segoe UI, system-ui, sans-serif)
**Label/Mono Font:** Azeret Mono (with Red Hat Mono, Cascadia Mono, Consolas, monospace)

**Character:** A technical grotesk pinned to the tracks. Bricolage Grotesque does two jobs through its variable axes: at `opsz 96` and `wdth 85–90` it is the display voice, tight and slightly condensed; at `opsz 12` and `wdth 92` it is the uppercase label voice with `.14em` tracking, the voice of every plate, rail item, table header and legend. Schibsted Grotesk reads; Azeret Mono carries every figure, id, path and command with tabular numerals. The three faces load from Google Fonts with `display=swap` (weights 300–800 variable for Bricolage; 400/500/700 Schibsted; 300/400/500 Azeret); self-hosting was considered and left standing by the owner's page-weight bar, so the fallback stacks above are what a blocked font request renders, and they are declared for every face.

### Hierarchy
- **Display** (500, `clamp(2.4rem, 4.3vw, 3.6rem)`, 1.05; `opsz 96`, `wdth 85`, `-.03em`): the thesis in the first viewport only; `text-wrap: balance`; the emphasised phrase is underlined in Trigger Yellow at `.07em` thickness and `.16em` offset, not italic.
- **Headline** (500, 2.44rem, 1.05; `opsz 96`, `wdth 90`, `-.02em`): section headings, each followed on the same baseline by its plate.
- **Title** (600 at 1.25rem; steps use 500 at 1.5625rem; crew titles 500): h3s in cards, steps and crew columns. The drawer's title is mono 500 at 1rem because it is an id.
- **Lede** (400, 1.25rem, 1.55; `ink-2`, 64ch): the paragraph under a section heading; the hero paragraph shares it at 62ch.
- **Body** (400, 1rem, 1.6): reading text; step paragraphs 50ch, contribute list 68ch, member guides 76ch at .95rem, event card and table text .9rem.
- **Label** (600/500/400, .72rem, `.14em`, uppercase; `opsz 12`, `wdth 92`): plates, rail items, figure captions, table headers, stage header and legend, tags, drawer terms, compare labels, footer invariant titles; tracking steps down to `.12em`, `.10em` or `.08em` where the label sits inside a control or a tooltip.
- **Mono** (400/500, `.9em` in text; .74rem chips; .78–.8rem ids, tags and table figures; .86–.88rem terminal and commands; 1rem hero figures; `tabular-nums`): every number, id, path, command and transcript line.

### Named Rules
**The Plate-Not-Kicker Rule.** The label that names a zone comes after its heading, on the same baseline, inside a plate; a label above a heading does not exist on this page and is not to be introduced.

**The Figures-Are-Mono Rule.** A number, an id, a path or a command is set in Azeret Mono with tabular numerals; a number in the reading face is a defect.

**The One-Axis-Voice Rule.** Labels are Bricolage at `opsz 12`, `wdth 92`; display is Bricolage at `opsz 96`, `wdth 85–90`. No third setting of the axes, and no tracking on display text beyond the negative values above.

## Layout

The container is 1240 px wide with 24 px side padding (16 px under 560 px). Inside it a two-column frame: the beamline index at 132 px on the left, sticky at 24 px from the top, and the content column at the remainder, 48 px apart. The first two sections share an event grid, `.9fr | minmax(360px, 1.1fr)` with a 48 px gutter: the thesis and the layers stack on the left, the stage card occupies the right and is sticky at 16 px from the top, so the layers scroll under it while it stays. The graph is `min(72vh, 720px)` tall on desktop.

Rhythm is the 4 px scale in the frontmatter (s1–s8: 4, 8, 12, 16, 24, 32, 48, 64) used through `gap` and section padding, never per-element margins between siblings. Sections carry 64 px above and 48 px below with a 1 px `rule-soft` divider; the section head sits 24 px above its lede, the lede 32 px above the content. The steps list uses a 64 px gap so each layer enters the observer alone. The ~4 px cluster (plate, chip, tag and control padding) is micro-padding and is not the page rhythm.

Other grids: the trigger simulation `.9fr | 1.1fr` at 32 px; the crew three equal columns at 32 px; the strata three equal columns at 24 px; the hero figures five auto columns; the footer invariants five columns at 24 px. The calorimeter table has a 960 px minimum width inside a horizontally scrolling wrapper.

Breakpoints: at 1040 px the frame collapses to one column, the beamline becomes a horizontal sticky strip at the top (its dots and sub-labels hidden, the current item in Trigger Yellow), the event grid stacks as hero, stage, layers with the stage sticky at 44 px and `min(44vh, 420px)` tall, the drawer rises from the bottom at 70% height, and the sim, crew and strata become single columns; figures go to three columns, invariants to two. At 560 px the header stacks, command and run-log rows lose their right column, controls get a 44 px minimum height, the search fills the width, and invariants go to one column. On touch, the graph canvas keeps `pan-y pinch-zoom` so the page still scrolls through the stage.

## Elevation & Depth

Depth is tonal. Three neutral steps (ground, layer, layer-2) and two rule weights do all the layering; a raised surface is one step lighter with a 1 px `rule` border. There is one shadow token and it sits under the stage card only: soft, low, two layers. Hover lifts are 1 px translations, not shadow growth. The drawer covers the stage as a solid `layer-2` panel with a `rule` left border, no scrim, no blur. Nothing glows and no backdrop filter exists.

### Shadow Vocabulary
- **Stage** (`box-shadow: 0 6px 10px -8px rgba(0,0,0,.7), 0 1px 2px rgba(0,0,0,.5)`; light `0 6px 10px -8px rgba(16,23,34,.28), 0 1px 2px rgba(16,23,34,.12)`): the pinned stage card, the one surface that floats over scrolling content.

### Named Rules
**The One-Shadow Rule.** The `--shadow` token is the only shadow, and the stage is the only element that carries it. A new component earns depth through `layer`/`layer-2` and a rule, not through a new shadow.

## Shapes

Rectilinear with four small radii that grade by scale: 2 px on controls, plates, chips, filter buttons, terminal prompt buttons, the focus ring and compare labels; 3 px on framed lines and boxes (command lines, ask-list rows, buttons, tooltip, guides, the members door); 4 px on panels (terminal, event cards, the compare frame); 6 px on the stage alone. Energy bars and the scale swatch use 1 px; the only circles are dots: the beamline marker (7 px), plate and legend dots (6–8 px), state dots (.55em), the compare handle (26 px with a 3 px ground border), and nodes on the canvas (2.6 px, 3.6 px when isolated).

Every border is 1 px; the only heavier strokes are the 2 px link underline on hover, the 2 px slider divider and the 2 px legend track swatches. Structure is drawn with rules on one side: the beamline's left spine, the step's left rule, the crew column's top rule, the footer's top rule, the table header's bottom rule. The members door is the one dashed border, and it turns solid when the door is open. Rings on the stage are painted at 1 device pixel regardless of zoom.

## Components

### Buttons
- **Shape:** framed (3 px), 12 × 24 px padding, Bricolage 600 at .95rem, 1 px border.
- **Primary:** ink fill, ground text, ink border; hover turns Trigger Yellow with `on-sig` text and lifts 1 px (180 ms, `cubic-bezier(.16,1,.3,1)`).
- **Ghost:** transparent, ink text, `rule` border; hover fills `layer` with a `steel` border.
- **Focus:** the global ring (2 px `sig-c`, 3 px offset, 2 px radius).
- **Small controls** (copy, run, read here, filter, drawer close): the label voice at .72rem uppercase, 1 px `steel` or `rule` border, 2 px radius, transparent; copy fills yellow on hover, run and read-here fill cyan, the terminal's y/n buttons are yellow-outlined and fill yellow. Every control names its action in its text.

### Label plates
- **Style:** inline-flex, the label voice (.72rem, `.14em`, uppercase, `opsz 12`), `ink-2` text with the zone name in `ink` at 500, `layer` fill, 1 px `rule` border, 4 × 12 px padding, 2 px radius; an optional 6 px cyan dot.
- **Placement:** after the section's h2 on the same baseline (`.sec-head`), or after a crew column's h3; never above a heading. Zones: Event, Trigger, Layers, Run log, Shift crew, Calorimeter, Events 1–3, Contribute, plus Open core, The vault, Services.

### Beamline (the layer index)
- **Style:** a sticky column with a 1 px `steel` left spine; eight items in the label voice (`ink-3`, `.14em`), each with a body-face sub-label at .78rem in `ink-2` and a 7 px ground-filled, steel-stroked dot sitting on the spine.
- **States:** hover `ink`; current (`aria-current`, set by an IntersectionObserver at `-30% 0 -60%`) turns the text `ink` and the dot Trigger Yellow. Under 1040 px it becomes a horizontal strip with the current item's text in yellow.

### Stage (the event)
- **Card:** `layer` fill, 1 px `rule`, 6 px radius, the stage shadow, `overflow: hidden`; a header row in the label voice (`ink-3`, `.12em`) with the graph name in `ink` and a live count ("86 tracks · 84 links"); a legend row below with the three ring dots (installed filled ink, catalog yellow-stroked, remote green-stroked) and six 14 px track swatches.
- **Canvas:** force-graph 1.51.4 on a transparent background; three rings painted every frame in `steel-dim` at 1 device pixel with uppercase Bricolage names above them at radii .44, .74 and .96 of the stage; nodes 2.6 px, installed filled `ink`, catalog `layer`-filled with a yellow stroke, remote with a green stroke, missing with an energy stroke; tracks coloured by type (calls cyan, precedes yellow, feeds green, guided-by violet, alternative-to `ink-3`, candidate-for yellow) and every type but calls also dashed (`7 3`, `2 3`, `10 3 2 3`, `3 3`, `1 3`) so hue is never the only code; .12 curvature; labels in Azeret Mono 500 appear on isolation, hover, or above 2.2× zoom. Isolation dims the rest to .18 alpha and thickens lit tracks to 1.6 px.
- **Tooltip:** ink fill, ground text, 3 px radius, 8 × 12 px padding, 30ch max; mono id, the description, the ring in the label voice at .75 opacity.
- **Drawer:** 360 px from the right (full width from the bottom under 1040 px), `layer-2`, 1 px `rule` edge, 24 px padding; enters in 320 ms `cubic-bezier(.16,1,.3,1)`; a close control top-right, the ring in the label voice, the id as a mono h3, the description, a `dl` of tracks and ring, the track list (mono .78rem, `rule-soft` rows, arrows for direction), and "open the source" as a mono link with the out-icon. Escape or a background click closes it; focus moves to the close control on open.
- **Keyboard track list:** a visually hidden `ul` of one button per node that becomes a wrapped mono list when focused, so the graph's information is reachable without the pointer.

### Layer steps and chips
- **Step:** 1 px `rule` left border and 24 px left padding; the title is Bricolage 500 at 1.5625rem with an "L1"…"L9" index in the label voice at 400; the paragraph in `ink-2` at 50ch; a row of skill chips.
- **Current:** the left rule turns Trigger Yellow (300 ms) and the chips' borders with it, chip text to `ink`; set by an IntersectionObserver at the viewport's middle band, which also isolates the step's tracks on the stage and moves the camera.
- **Chip:** Azeret Mono .74rem, 2 × 8 px padding, 1 px `rule` border, 2 px radius, `ink-2`; no fill in either state.

### Trigger (the gate simulation)
- **Ask list:** rows in `layer` with a 1 px `steel` border and 3 px radius, the command in mono at .88rem with a `.d` description, a `Run` control at the right.
- **Terminal:** `ground` fill, 1 px `rule`, 4 px radius, 16 × 24 px padding, Azeret Mono .86rem at 1.65, 8rem minimum height, `role="log"`; line voices: `ask` in yellow, `ok` in pass green, `dim` in `ink-3`, plain in `ink`; a y/n prompt row with yellow-outlined buttons that disable after the answer at .4 opacity. The first line says it is a simulation.

### Run log (filters and rows)
- **Filter chips:** the label voice at .72rem, 8 × 12 px, 1 px `steel` border, 2 px radius, `ink-2`; pressed (`aria-pressed`) fills `ink` with `ground` text. Grouped by kind and by host in 4 px gaps; a search field in `layer` with a `steel` border and a 16rem minimum width; a live count in the label voice.
- **Rows:** `1fr | auto` grid, 12 px vertical padding, `rule-soft` dividers; the title at 500 with a `.d` description in `ink-2`; right-aligned tags in the label face at `ink-3`, coloured only by meaning (`pay` yellow, `free` pass green, `mem` cyan with the lock icon). A member guide opens inline as a `layer` box at 76ch rendering the markdown subset.

### Crew columns and the door
- **Columns:** three, each opened by a 1 px `steel` top rule and 16 px padding; an h3 at 500, a plate under it, a bulleted list in `ink-2` at .95rem.
- **Door:** a mono .8rem box with a dashed 1 px `rule` border and 3 px radius, the lock icon and the reason there is no login form; in the members edition the border is solid pass green with the check icon and green text.

### Calorimeter (the proof table)
- **Table:** full width, .9rem, `rule-soft` row dividers; headers in the label voice with a 1 px `steel` bottom rule; each benchmark cell carries a bold name, a `.d` description and the rerun command in mono; a state dot before the result (pass green, fail red, pending yellow).
- **Energy bars:** an inline 8 px bar in `energy` at 1 px radius, width in px equal to cents (100 px = $1.00), beside the dollar figure; the header draws the scale as a 100 px × 6 px swatch labelled "= $1.00". Token-only rows carry no bar. The caption sits below the table in `ink-2` at .8rem and carries the caveat.

### Events strata and the compare slider
- **Event card:** `layer`, 1 px `rule`, 4 px radius; a header in the label voice with the event name in `ink` and its date; a 16:10 capture (`object-fit: cover`, top-anchored, ground behind, a `picture` that follows the colour scheme); a body at 16 px with `ink-2` text at .9rem and a mono `dl` of measurements.
- **Compare:** a 16:9 frame with two full-bleed captures, the "after" clipped by `--cut`; a 2 px Trigger Yellow divider with a 26 px yellow circle handle (3 px ground border); ink-filled compare labels top-left and top-right; the whole frame is an invisible range input with an `ew-resize` cursor. The slider compares and never hides; the three events stay exposed above it.

### Footer
- **Invariants:** five columns (two, then one, at the breakpoints) opened by a 1 px `steel` top rule, each title in the label voice at `ink` and the body in `ink-2` at .9rem; then a colophon row in the label face at `ink-3` with the licence, the version, the graph date, the one library and the repository link.

### Browser surfaces
- Selection: Trigger Yellow with `on-sig` text. Focus: 2 px cyan outline, 3 px offset, 2 px radius, `:focus-visible` only. Links: inherit colour, 1 px `steel` underline at `.2em` offset, 2 px cyan on hover. Scrollbar: `steel-dim` thumb on `ground`. `color-scheme` per theme. Icons: three authored inline SVG symbols (check, out, lock) at 1em, 1.75 round stroke, `currentColor`.

### Motion
- **The bloom:** on load the force simulation runs from the beamline outward and cools in 3.2 s (`cooldownTime 3200`, alpha decay .028, velocity decay .32), then the whole event fits the stage at 3.4 s. It is the page's one authored moment.
- **Camera:** each layer change isolates its tracks and calls `zoomToFit` over 700 ms with 48 px padding, capped at 2.4× so a two-track layer never fills the stage with two dots; CSS state transitions (step rule, chips, drawer, buttons) use `cubic-bezier(.16,1,.3,1)`, an exponential ease-out, at 150–320 ms.
- **Reduced motion:** alpha decay 1, 220 warm-up ticks and zero cooldown settle the layout before the first frame; the camera moves in 0 ms; every CSS transition is off; `scroll-behavior` is `auto`. The graph still repaints on a colour-scheme change.

### Copy
- The product's own words: invariants, benchmark ids, skill names and numbers as they stand in the repository, each number with its command and its date. Controls name their action (copy, Run, y · allow once, n · refuse, read here, close, Join the discussions, Open a pull request). The simulation says it is a simulation; the door says why there is no login form; prices are not set and are not invented; a value the build has not filled says "pending".

## Do's and Don'ts

### Do:
- **Do** place a zone's name in a plate after its heading (`.sec-head`: h2, then `.plate`), and give every new zone one.
- **Do** keep the ground at #0A0E15 (#FFFFFF in light) and layer surfaces with `layer` and `layer-2` plus a 1 px `rule`; the stage's shadow is the only shadow.
- **Do** set every number, id, path and command in Azeret Mono with `tabular-nums`, and every label in Bricolage at `opsz 12`, `wdth 92`, .72rem, uppercase.
- **Do** colour by meaning only: tracks by type with a dash per type, bars in `energy` at 100 px per dollar, dots and tags by state; pair any signal fill with `on-sig`.
- **Do** compose both themes through the three-state token pattern and declare `color-scheme` in each; read tokens from `getComputedStyle` when painting a canvas, and repaint on scheme change.
- **Do** honour reduced motion by settling layout before the first frame and turning every transition off; keep the bloom the only authored moment.
- **Do** keep the beamline's current item, the current step's rule and its chips in Trigger Yellow; that yellow means "you are here" and "this asks".
- **Do** measure before quoting: body contrast, overflow, page weight and console errors come from `tests/visual/shoot.py`, not from this file.

### Don't:
- **Don't** put a label above a heading (a kicker or eyebrow); the plate after the heading is the only label placement.
- **Don't** use a gradient, a glow, a blur, glass or a backdrop filter; none exists in the stylesheet.
- **Don't** add a second shadow token or move the shadow off the stage.
- **Don't** fill a surface with a signal colour at rest, use `energy` for anything but spend and failure, or use `sig-v` outside the guided-by track.
- **Don't** invent a fourth face, a fourth axis setting for Bricolage, or a radius outside 2/3/4/6 px (1 px on bars).
- **Don't** invent users, quotes, prices, adoption numbers or a login form; do not render a number the build has not filled as anything but "pending".
- **Don't** animate anything beyond the bloom, the camera and the 150–320 ms state transitions; nothing reveals on scroll.
