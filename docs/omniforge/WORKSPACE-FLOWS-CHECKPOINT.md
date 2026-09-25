# Workflows, terminal windows and memory controls

September 25, 2026. **Implementation in progress**, base `17230c093f933c8cd943216a80bc02eea4530079` after [PR #5](https://github.com/ymauhn/omniharness/pull/5); integration branch `codex/mvp-workspace-flows`. The previous reviewed implementation commit is `fcef707743aa03d24448a28364b1659a037afe0f`. Full MVP task approval covers these changes; no new plan decision or provider call is needed.

Frozen reference: [PLAN](PLAN.md) SHA-256 `d7904fee2050478681f9a8bd90da11c1a22c50487e9b3651974dddb1f238ab2f`; [release contract](V1-RELEASE-CONTRACT.md) `ceda9e8ee45ce06f30c99f673c84c9e387f381f98930ab3dedb6a19dc782eb23`. The owner permits unavailable visual/provider/human checks in the final validation round; this does not certify failed or unverified managed execution.

## Bounded acceptance before implementation

| Slice | Observable acceptance | Writer |
|---|---|---|
| Saved Workflows | Original suggested workflows can be reviewed and saved per project; dependency diagrams expose copy/compose/task actions. Cyclic graphs, stale versions and cross-project references fail. Task creation pins the chosen workflow version and dependencies atomically; duplicate requests do not duplicate tasks. No action silently runs a model or declares task success. | `/root/mvp_scope_audit`, `_intake/mvp-workflows` |
| Terminal grid | One to eight configurable panes, per-window/project layout, resizing and session selection; open another same-origin window without propagating the launch token. Pane removal does not kill the shell. Concurrent views reconcile bounded output by epoch/cursor and indicate missing history. | `/root/mvp_accounting_review_a`, `_intake/mvp-terminal-grid` |
| Output replay | Authenticated, explicitly project-bound HTTP replay agrees exactly with live SSE frames. Payload/frame/session caps hold; truncation and restart/eviction are visible. No terminal text is written to the state file. This is not durable scrollback or descendant cancellation. | `/root`, coordinator checkout |
| Memory controls | Selected-scope notes can be edited, inspected by revision and archived with retained history. A stale edit keeps the draft and reports conflict; delayed reads/mutations cannot populate another project's editor. Unsolicited state refresh does not discard a draft. | `/root`, coordinator checkout |

Visual applicability: **required**, deferred as V-01 under the owner's amendment. No browser or alternative backend has been attempted after the platform rejection. Node controller/DOM and HTTP behavior tests provide functional seams only. Independent source reviews and final integrated tests are pending, not inferred from the prior 282/69/7 battery. Default repair budget is two review cycles per slice; none consumed as this initial record is written.

Initial evidence: replay API red `404 !== 200` before route integration; then eight combined replay/server cases passed, zero skips. The initial replay unit run failed on the absent module before implementation. Memory controller's first four functional cases passed; no failing-test-first claim is made for that module. Final evidence and reviewer identities will replace this provisional status after integration.

Managed-agent admission, whole-tree cancellation, full usage accounting, JEV live access and clean-user packaging remain separate gates in [VALIDATION-PENDING](VALIDATION-PENDING.md). No claims about them are expanded by these workspace controls.
