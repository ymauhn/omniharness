# OmniForge Companion Studio

Status: **local design prototype; behavioral core checked, browser and owner visual acceptance pending**. Date: 2026-09-25.

Open `index.html` directly in a current browser. It uses ordinary local script/style files, system fonts and inline SVG: no ES modules, web server, build step, package installation or internet connection is required. Keep the four runtime files together. This direct-file launch path is designed into the artifact but has not yet been exercised in a browser.

From the repository root:

```powershell
node --test docs/omniforge/mascot/model.test.cjs
node --check docs/omniforge/mascot/app.js
node --check docs/omniforge/mascot/model.js
node docs/omniforge/mascot/measure.cjs
```

## Design

The same compact robot appears in two skins: **Soft signal**, with static SVG gradients and soft depth; and **Pocket pixel**, with a deliberately stepped silhouette and crisp SVG geometry. Their shared identity is a diamond antenna, two pill-shaped eyes, small side ears, a rounded compact body and a tiny paired-chevron chest badge. The prototype contains side-by-side large comparisons and the chosen skin at 44 px and 53 px beside the composer. Neither variant uses a 3D engine, raster render, video or external asset.

The Operations, Atelier and Bridge palettes follow the Lab's violet/dark, teal/light and cyan/dark directions. Select a skin or theme without resetting the draft. Appearance controls deliberately remain separate from assistance controls. The expression buttons let the owner inspect poses; they do not run the corresponding action or certify real agent state.

| Semantic state | Visual / behavior |
|---|---|
| Resting | Open eyes, still body; no idle animation loop |
| Thinking/typing | Narrower eyes and tilted antenna; at most two finite motion cycles in manual preview |
| Suggestion | Alert eyes; one finite lift when a proposal appears |
| Selection | Eyes follow the selected span; contextual actions stay below the composer |
| Accepted | Happy eyes and raised arm; finite acknowledgement |
| Dismissed | Tilted antenna and question mark; at most one follow-up per draft revision, then 30-second passive cooldown |
| Muted | Dimmed eyes with resting lines, still and explicitly labeled |

## What works locally

- Discreet default uses a 1.7-second pause; Active uses 0.7 seconds. Both operate on the local draft only. Off cancels timers, hides proposals and leaves the editor usable.
- Mouse or keyboard selection in the composer captures the exact span and its draft revision. A separate terminal example does not register assistance actions. Actions are Clarify, Add context, Research and Suggest skill.
- The four actions use clearly labeled deterministic templates. The skill and project examples are not live catalog/memory lookups. There is no semantic model, research request or prompt submission.
- Proposals are previews. Apply checks the full original text, revision and project identity before replacing only the captured span. Edits, edit-then-restore and a changed project invalidate the proposal. Undo also rejects subsequent edits; it never overwrites them.
- A dismissal preserves the draft, restores focus to the editor, announces one concise question at most per draft revision, and suppresses automatic suggestions for 30 seconds. Editing rearms the question for the next proposal; repeated requests on unchanged text do not repeat it. Manual requests remain available. Expression buttons explicitly label pose previews; a muted preview does not claim that actual assistance is Off, and muted poses never animate.
- Reduced motion respects the operating-system preference and the explicit toggle, including anchor scrolling. Animations are finite, use transforms, and pause independently outside the viewport or in a hidden tab. There is no permanent timer or render loop, sound, storage, network request or telemetry upload.

## Verification record

Base commit: `fa620d61f72c4566c00b802e792b4a04556e809c`. Isolated writer branch: `codex/mvp-mascot`. Approved reference: `../../archive/MASCOT-DESIGN-HANDOFF-2026-09-25.md`, SHA-256 `37eceaaa7cc026b34cf6703be20f938269fa5a6b6e8972a46e5ebd0a87be5860`.

The initial implementation deliberately had the ordinary unsafe selected-offset behavior: concatenate `currentDraft.slice(0, start) + replacement + currentDraft.slice(end)` without validating the captured draft. The first runnable requirement was recorded **before the fix**:

```text
node --test docs/omniforge/mascot/model.test.cjs
exit 1; tests 1; pass 0; fail 1; skipped 0
AssertionError: Stale selection must never rewrite a changed draft
true !== false
```

After fixing snapshot/revision/project validation, the expanded run found a mistake in the partial-word test fixture: replacing indices 2..7 of `refatorar` with `modela` leaves `remodelaar`. The expected case was corrected to insert `model`, retaining the same selected span. That intermediate run was 4/5, not reported as passing.

After initial implementation, the coordinator's two independent readers found four issues: follow-up lifetime, misleading muted-pose labeling, animation on entering Off, and focus/live announcement after dismissal. Repair cycle 1 addresses all four. Two additional behavior checks verify rearming after a new revision and a still muted state; DOM focus/announcement still need browser verification.

Current core run: **7/7 tests passed, 0 failed, 0 skipped**, Node `v24.19.0` on this Windows host. Covered: stale selection, duplicate phrases, correct undo and rejected stale undo, project switching, edit-then-restore, Portuguese/Unicode/multiline/partial-word edits, surrogate-boundary rejection, passive assistance conditions, dismissal rearming and muted-state motion. Both JavaScript syntax checks passed. The coordinator obtained two fresh source re-reviews of repair cycle 1; both reported no blockers and independently verified 7/7 tests and syntax. Browser evidence is still required before visual acceptance. Node model checks do not test DOM focus, layout, visual contrast, frame rate or browser event ordering.

Browser automation was intentionally not attempted in this isolated task: the coordinator owns resolution of the prior host browser-policy review. **CPU, FPS/frame time, GPU load, viewport screenshots, screen-reader behavior and manual visual quality remain unmeasured.** No browser pass is implied by the test count. Owner design acceptance remains pending.

## Measured asset size

Measured with `measure.cjs`: gzip level 9 per runtime file, not an actual HTTP transfer. All SVG markup is included in `app.js`; there are no image or font downloads.

| Runtime file | Source bytes | Gzip bytes |
|---|---:|---:|
| `index.html` | 7,862 | 2,931 |
| `style.css` | 14,541 | 4,079 |
| `app.js` | 16,952 | 5,383 |
| `model.js` | 2,164 | 819 |
| **Total after repair 1** | **41,519** | **13,212** |

The initial pre-review baseline was 40,453 source bytes and 12,892 gzip bytes. Snapshot sizes are not performance claims.

`measure.cjs` prints current SHA-256 hashes and sizes, so future edits can invalidate this snapshot visibly. The two small inline skins are both present for comparison; production integration can mount only the selected runtime skin. Low asset size is not a CPU/FPS benchmark.

## Manual acceptance for the coordinator

1. Open the page at desktop and narrow mobile widths; inspect both skins in all three themes and at the small composer size. Confirm no clipped control, hidden label or horizontal overflow.
2. Type, pause and review the untouched original before applying. Dismiss twice and verify the question does not repeat. Test Off while a timer/proposal is active.
3. Select a phrase by mouse and Shift+arrows; Tab into the contextual controls. Apply to duplicate phrases, Portuguese/emoji and multiline text. Edit before apply and verify stale rejection; edit after apply and verify undo does not erase work.
4. Select terminal example text: no Copilot menu. Switch skin/theme without changing the draft. Verify keyboard focus remains visible and reachable.
5. Enable reduced motion, hide the tab and scroll each animated surface out of view. Capture actual idle/animated performance before quoting a processing budget.
6. Ask the owner which silhouette/material and expression intensity they prefer. Visual acceptance remains their decision.

## Provenance and integration boundary

All SVG geometry, gradients, CSS, copy and interaction code were created for this repository under its MIT license. No third-party art was imported and no Higgsfield generation was requested; media/API credits spent by this artifact task: none. Native Codex development usage is **unavailable here**, not zero. The artifact runs no model; native delegation and the worktree alone do not prove managed executor containment or receipt reconciliation.

Owner amendment, 2026-09-25: unavailable nonblocking validation may be deferred to the final MVP round. The coordinator therefore integrated this reviewed artifact provisionally, with the browser/visual gate still open as [V-01](../VALIDATION-PENDING.md). This is not visual approval or live Copilot integration. For integration, `model.js` is the pure draft-safety seam; replace only the illustrative proposal construction in `app.js` with the real indexed-catalog/provider adapter, preserving project/revision identity. Route actual usage and agent state through the harness. Do not connect the terminal selection to this editor controller, and do not let a provider response apply to a newer draft. Theme and skin choice may later be persisted per user without persisting draft text implicitly.

This first slice does not implement the full Prompt Copilot, live catalog classification, shared memory, model execution, subscription credit display, key vault or OS integration. It is a real reviewable design artifact, with explicitly mocked recommendation content.
