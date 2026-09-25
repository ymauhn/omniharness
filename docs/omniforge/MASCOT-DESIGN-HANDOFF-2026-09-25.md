# OmniForge Prompt Copilot mascot — parallel design handoff

Status: **design brief for a separate session**, 2026-09-25. The user likes the current OmniForge Lab aesthetic and wants a cute, memorable robot companion with two selectable skins: crisp pixel art and a softly shaded modern 3D-like style. This handoff is for visual exploration and animation prototypes; it does not assert that Prompt Copilot logic is implemented. The main session is closing T13/E2/Lab validation and should not be blocked by mascot work.

## Read first

- [Prompt Copilot and OS design intake](PROMPT-COPILOT-AND-OS-EXTENSIONS-2026-09-25.md): behavior, privacy, selection action and performance gates.
- [Lab source](../../omniforge-lab/index.html): current three themes and layout. The user praised this aesthetic; retain its compact command-center feel. Theme tokens are `--bg`, `--surface`, `--text`, `--muted`, `--accent`, etc. `operations` is dark violet, `atelier` is pale teal, `bridge` is dark cyan. Do not assume the mascot must be purple in every theme.
- [V1 contract](V1-RELEASE-CONTRACT.md): the local app is a prototype; do not imply that a mascot mockup certifies agent behavior.
- Existing visual-directions sheet: `C:/Users/Yeonatan/.codex/visualizations/2026/09/21/01a0c19a-ec42-7c51-9d09-678ba9e45e19/omniforge-ui-directions.html` (reference only; a separate session should avoid editing it unless the owner asks).

## Character and interaction brief

Create **one recognizable character** with two skins on the same semantic rig, so changing skins does not change what a gesture means. It should feel friendly and capable, more like a small robotic teammate than a cartoon interrupting the workflow. Explore one compact silhouette, face/eyes, and one distinctive OmniForge visual motif that can work at approximately 32–48 px beside the chat and at larger sizes in onboarding or branding. Avoid persistent bouncing, sound and modal interruptions.

Prototype these states in both skins: resting, thinking/typing, one quiet suggestion after a pause, actions for text selected in the **bottom orchestrator chat**, suggestion accepted, suggestion dismissed with one concise follow-up question, and muted. The selection affordance belongs to the chat draft, **not** the terminal. It must work with keyboard selection/focus as well as a mouse. Show a short contextual menu with candidate actions (`clarear`, `adicionar contexto`, `pesquisar`, `sugerir skill`) and a preview/apply/dismiss pattern. A draft is never silently rewritten or submitted. The owner chose **Discreet** as the default mode; Active and Off remain settings.

The pixel skin should have deliberate pixel geometry and crisp scaling rather than a blurred downsample. The modern skin can use soft depth, restrained shadows and highlights, but its runtime should not depend on continuous 3D rendering. Try a few expressive transitions that reveal state without covering the user's text. Honor `prefers-reduced-motion` with a still pose and state label.

## Deliverable and file boundary

Work only in a new `docs/omniforge/mascot/` folder until the current technical checkpoint is committed. Provide a self-contained interactive HTML/CSS/JS comparison page, any optimized local assets it needs, and a short `README.md` with character rationale, state map, asset provenance/licensing, generation prompts if used, measured file sizes and performance observations. Let the owner toggle pixel/modern skin, the three Lab themes, reduced motion, pause-trigger and selected-text menu. The preview must be obviously a **design prototype**: fake prompt text and fake skill suggestions are permitted when labeled, with no model/network call.

Do not edit `omniforge-lab/index.html`, `core.mjs`, `server.mjs`, `harness/`, `evals/`, `scripts/` or the T13 handoff in this parallel design task. Do not install a new service or publish media. Leave integration notes rather than touching the live Lab. If the design session sees concurrent changes, read current Git state before any commit and commit only its own folder after review.

## Performance and acceptance

Treat performance as a measurable concern, not a reason to avoid an expressive design. Prefer SVG/CSS or a small sprite sheet for runtime; animate `transform`/`opacity`, stop animation when idle/offscreen, and load the larger skin asset only when selected. Avoid a permanent render loop and huge transparent video/GIF assets. Record actual compressed bytes and a quick Windows browser observation for idle CPU, animated frame rate/frame time and reduced-motion behavior; target smooth interaction on ordinary laptops, but report measured results instead of claiming a fixed device budget without a test. A static fallback must remain legible if animation or GPU compositing is unavailable.

Check that both skins remain identifiable at chat size; text selection and terminal selection behave differently; keyboard focus and reduced motion work; theme contrast remains readable; toggling skins does not reset the draft; and a dismissed suggestion leaves the original text intact. The handoff is complete when the owner can open the comparison page and choose a direction, with an explicit list of what is still mock behavior.

The owner explicitly allowed use of **existing Higgsfield credits if available** for mascot visual exploration. First inspect the available balance and the relevant Higgsfield skill instructions; do not buy credits or start unrelated media generation. Record which outputs used credits and how many, and distinguish AI concept renders from optimized runtime assets. A local SVG/CSS prototype is sufficient even if no credits remain.
