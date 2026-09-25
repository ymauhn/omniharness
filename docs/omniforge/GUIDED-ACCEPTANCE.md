# OmniForge Lab: guided owner acceptance

Status: **procedure, not a test result**. Use this with a permitted interactive browser and the owner/Claude to evaluate the current Windows Lab and Companion Studio. The source and deterministic checks are recorded in [the latest checkpoint](LATEST-CHECKPOINT.md), [the Arsenal checkpoint](ARSENAL-UI-CHECKPOINT.md), and [pending validation](VALIDATION-PENDING.md). None of those checks substitutes for this visual and interaction round.

## Preparation and evidence boundary

1. From the repository root, read `AGENTS.md`, [the T13 handoff](../t13/TICKET-HANDOFF-CLAUDE.md), and the current Git status. Record `git rev-parse HEAD`, branch, dirty paths, Windows/browser versions, date, display scale, viewport dimensions and whether the browser supports reduced motion. Test the actual checked-out source; a result from an older SHA cannot certify later edits.
2. Launch the isolated fixture in a foreground PowerShell 7 terminal:

   ```powershell
   pwsh -NoProfile -File .\scripts\start_omniforge_demo.ps1
   ```

   The helper should print a **new** temporary `omniforge-demo-*` data directory and the exact loopback launch URL. Verify both before opening the browser. Do not point it at the owner's existing `.omniforge-lab` directory. Keep the terminal open for the round; Ctrl+C ends the demo. If the helper is missing, fails, or prints a non-loopback URL, record a blocker instead of reusing personal Lab data. Do not commit the temporary state, token URL, screenshots containing private text, or raw browser profile data.
3. Open the printed `http://127.0.0.1:<port>/?token=<random>` URL only through a **permitted** browser route. The first request should remove the token from the address bar and establish the local cookie. Do not capture or share the launch token. Native browser navigation has previously been denied by platform review despite the owner's approval; if that denial recurs, record the exact reason and stop browser actions. Do not retry with Playwright, CDP, a different backend, or another browser to evade that decision. Source, DOM seam and HTTP checks may continue, but mark visual scenarios **blocked**, not passed.
4. Confirm the fixture actually contains `OmniHarness · Demo` rooted at this checkout, three open tasks linked by dependencies, `Build` and `Pesquisa` sessions, one synthetic accepted decision and one rejected/quoted session note in `Build`, plus `Projeto isolado · Demo` with its own private project note. Record the **observed** project/session/task/note IDs from the UI or authenticated local API if needed; names alone are not identity proof. The seed is synthetic and does not launch a model. Do not mix it with an owner's private session.
5. Save evidence outside Git, for example in an operator-chosen temporary `omniforge-acceptance-<date>` folder. Use short screenshots or recordings with the address bar/token and sensitive prompts hidden; preserve the associated SHA and step ID in filenames. Observe DOM/keyboard behavior directly. A still image can prove layout, not animation, focus transitions, latency, CPU cost, execution containment or provider consumption. Do not fabricate a browser or human verdict from automated checks.

Use **pass / fail / blocked / not run** per scenario. A fail needs the reproducible input, expected versus observed behavior and evidence reference. A block needs the precise unavailable prerequisite or denied operation. Record owner preference separately from technical pass/fail; for example, choosing a skin is a design judgment.

## Guided scenarios

### A. Mascot and Prompt Copilot

1. In **Área de trabalho**, select `OmniHarness · Demo`. The composer is **Pedido ou decisão** under **Coordenação**, below the terminals. In **Preferências do companheiro**, inspect **Robô moderno** and **Robô pixel** in each top-level theme: **Mesa de operações**, **Ateliê de projetos** and **Ponte de comando**. Check compact and narrow layouts, readable labels/contrast, no clipping or horizontal overflow, visible focus and keyboard navigation. The same visual comparison can be opened directly in `docs/omniforge/mascot/index.html`; that page is a design prototype with illustrative recommendations, so distinguish it from the integrated Lab behavior.
2. Set **Assistência** to **Discreto · após pausa**. Type a safe draft such as `Revisar o grafo de tarefas do OmniHarness`, keep focus in the composer and pause for about two seconds. Observe a catalog-based suggestion or an honest no-match/fallback; no model should run. Change to **Ativo · pausa curta** and observe the shorter delay. Do not count a recommendation as proof that the suggested skill is installed, authorized or effective without inspecting its metadata. Laya is an explicit optional local worker; its abstentions and uncalibrated benefit are [recorded separately](LAYA-LOCAL-OBSERVATION.md). JEV is not a live provider pass here.
3. Select only `grafo de tarefas` with the mouse in the composer. Use **Clareza**, **Contexto**, **Pesquisa** and **Skills** on the selection, checking that the preview identifies the original span and leaves the rest of the draft intact. Apply one proposal with **Aplicar no rascunho**; verify only the selected span changes and nothing is sent to a terminal or model. Use **Desfazer última aplicação**; verify the prior draft returns. Repeat with a duplicate phrase, Portuguese accents and a multiline draft. Edit the draft after a proposal but before applying, and after applying but before undo: stale actions must refuse rather than overwrite the new text. Selecting text inside a terminal must **not** open Copilot actions.
4. Click **Dispensar** and observe that the draft remains and a concise follow-up appears at most once for the same draft revision. Set **Off · desligado** while a suggestion/timer is active: the panel should close, automatic suggestions should stop and the composer should remain editable. Set **Movimento** to **Sem animações** and repeat a suggestion; also test the operating system's reduced-motion preference. Check focus after dismissal, apply, undo and Escape; record any focus loss or motion that continues while hidden. Do not claim CPU/FPS savings without a real measurement.

### B. Shared, scoped memory and concurrency

1. In **Memória e grafos**, select **Conhecimento do projeto** and inspect the fixture notes. Choose session `Build` under **Contexto de uma sessão**, click **Consultar**, and confirm the accepted/rejected synthetic sources are visibly attributed to that session. The project/global note list and session-context result have different scopes; do not require a private session note to appear in the project/global list.
2. Create a new **Sessão** note in `Build` with a safe source and text, then inspect it in the session note controls, **Editar**, **Histórico**, and **Arquivar…**. A saved edit must increment its revision, history must retain the prior version, and archive must require explicit confirmation. Do not use a private real transcript as the test note.
3. Open the same Lab in a second permitted window. Open the same note for editing in both windows; save a change in the first, then try to save the stale draft in the second. Expect a visible conflict, no silent overwrite, and the unsaved second draft retained. Refresh/reopen deliberately before another write. Record the note ID and both observed revisions, without publishing note text.
4. Switch to `Projeto isolado · Demo`; its private note must be visible there, while `Build` session notes and the OmniHarness registry/task details must not leak across projects. Switch back and confirm the OmniHarness context returns. Record whether the view changes without showing stale content from the previous project.

### C. Terminals, windows, replay and cancellation claim

1. With `OmniHarness · Demo` selected, show `Build` and `Pesquisa` side by side. In the grid controls use **Adicionar painel** until eight panes exist, select existing project sessions in panes, then try the ninth add: it should be unavailable. Test one to four **Colunas**, **Dimensionar grade** sliders and a narrow viewport. A panel may share a session; eight panes do not imply eight running processes. Closing one panel should keep its session in the sidebar.
2. Use a harmless local command in each PTY (for example, a distinct `Write-Output` marker) and check output appears in the intended session. Test keyboard focus and that typing/resizing is accepted only by the focused pane/window. Use **Nova janela** or **Abrir em janela** and move it to a second monitor if available; confirm both windows share project state but retain their own layout. If a popup is blocked, record it and test the remaining same-window behavior.
3. Reload or reconnect an open window and check that bounded recent output replays in order, with visible status if some output is no longer retained. Do not infer durable full-screen terminal history. Avoid a deliberately huge output stream that could make the acceptance round unstable; deterministic replay bounds have separate tests.
4. Stop one disposable shell with **Parar shell**. Verify its shell status and the other shell's continued usability. **Do not** describe this as guaranteed cancellation of all descendant processes: the known Windows orphan-grandchild counterexample remains a managed-executor blocker. Do not run a model, privileged container or detached child from this PTY acceptance scenario. If any real child is observed, verify it separately before claiming it ended.

### D. Workflows, graph help and skills

1. Open **Workflows**. Inspect one suggested DAG, its node prompts and dependencies; copy or insert a node prompt into the composer and confirm this does not submit it. Save a deliberately small new workflow with two dependent steps, explicit source and reviewed prompts. Reopen the saved version, inspect history, and create tasks through the downstream node. Expect task snapshots with dependency links and frozen workflow version; **no model dispatch or automatic task completion**. Record the workflow/version and created task IDs. If an edit in another window produces a revision conflict, retain the draft rather than silently overriding the saved version.
2. Open **Memória e grafos**. Inspect **Conhecimento do projeto**, **Capacidades**, and **Tarefas**. Hover **and keyboard-focus** a skill/task node, click it, and use **Abrir item** if offered. Record which documentation/help appears on hover versus only in the detail pane. A plain title tooltip or click-only detail is **partial** against the requested rich hover/focus help; do not mark that requirement complete based on the graph merely rendering.
3. Open **Skills**, search a Portuguese term and an English synonym, inspect description, example and provenance, and note any catalog coverage gaps. A match is metadata, not permission to run or install the skill. **Assets** currently inventories local media paths; it does not verify broken code references, so record that as outside this round rather than claiming an asset repair pass.

### E. Agent Arsenal and Agent Forge dogfood

1. In **Agentes** with `OmniHarness · Demo` selected, inspect the five installed templates. **Importar rascunho** for one relevant template. Verify the project registry shows a draft, its immutable version/hash, inherited purpose/hosts/skills/tools and source-to-rule provenance. Attempt to activate before review: it should be unavailable. Inspect each rule and source, check **Confirmei esta regra e suas fontes** for every rule plus the inherited-settings review box, then **Registrar revisão desta versão** and **Ativar esta versão**. The review identity is a local caller attestation, not cryptographic proof of who reviewed it.
2. In **Criar perfil a partir de notas selecionadas**, mark only `Build`, load its notes, and explicitly choose the safe accepted decision. Review the actual text before checking its sanitization attestation. Optionally select the synthetic rejected/quoted note with its correct classification; its text may appear as provenance hash/reference but must **not** become a behavioral rule. Pick an installed template, a new valid profile ID and name, then **Gerar rascunho para revisão**. Verify selected source IDs, session IDs, note revisions and hashes in the preview; unselected or other-project notes must not appear. Review each generated rule and inherited setting, then activate the candidate. If the note is edited after loading but before derivation, the stale revision should be refused; reload and inspect before retrying.
3. Select one **open task of this project**, either from **Tarefas → Vincular agente** or the active profile's pin control. Choose an available host preference and **Vincular à tarefa**. Record task ID, profile ID, exact version/hash and visible `sem execução`/`executável: não` status. The pin is a project-scoped immutable metadata snapshot; it does **not** launch Codex/Claude, confer tool permission, consume model tokens, prove host login, or satisfy native isolation. Switch to `Projeto isolado · Demo` and verify no OmniHarness profile/pin is shown; return and verify the original remains.

## Result sheet to fill during the actual run

Do not prefill the outcome column from source code, prior fixtures or the helper's seed. Attach sanitized screenshots/short recordings only after observing the exact step. Store the result sheet or link in the handoff and update [V-01/V-07](VALIDATION-PENDING.md), including failures; never convert **blocked** to **pass** because an automated test passed.

| ID | Observable acceptance | Outcome: pass/fail/blocked/not run | Evidence reference and time | Browser/OS, SHA, reason or limitation |
|---|---|---|---|---|
| A1 | Two skins × three themes; narrow layout, contrast, keyboard focus | Not run | — | — |
| A2 | Focused pause suggestions, active mode, honest catalog/Laya status | Not run | — | — |
| A3 | Composer selection, apply/undo, stale rejection, terminal exclusion | Not run | — | — |
| A4 | Dismissal, Off, reduced motion, focus restoration | Not run | — | — |
| B1 | Session-note provenance and context scope | Not run | — | — |
| B2 | Edit/history/archive and revision | Not run | — | — |
| B3 | Two-window stale-write conflict without overwrite | Not run | — | — |
| B4 | Cross-project note/task/registry isolation in UI | Not run | — | — |
| C1 | One to eight panes, columns/size, close without stop | Not run | — | — |
| C2 | Separate PTY output and second-window focus/layout | Not run | — | — |
| C3 | Bounded replay and visible output-loss status | Not run | — | — |
| C4 | Shell stop honestly distinguished from descendant cancellation | Not run | — | — |
| D1 | Saved/versioned DAG, copy/insert, dependency-task snapshot | Not run | — | — |
| D2 | Graph hover/focus help and click-through, with partials named | Not run | — | — |
| D3 | PT/EN skill metadata/provenance and catalog gaps | Not run | — | — |
| E1 | Template draft → per-rule review → activation | Not run | — | — |
| E2 | Explicit sanitized session-note derivation and provenance | Not run | — | — |
| E3 | Active reviewed version pinned to same-project task, no dispatch | Not run | — | — |

The owner should add a short design verdict for the companion: preferred skin/material, expression intensity, whether it feels useful or intrusive during real prompting, and the highest-impact UI correction. A future low-effort experiment may offer **opt-in** pointer-follow or a mascot-shaped cursor in non-text surfaces. It is optional, not an acceptance blocker: preserve the normal text caret, keyboard focus, reduced-motion setting and a simple way to turn it off. Do not add a continuous animation/render loop merely for this effect.

This guided round establishes what a person can see and operate in the current Lab. Keep [managed execution, whole-tree token accounting, provider keys/credits, installer and full V1 pillar evidence](V1-RELEASE-CONTRACT.md) on their separate gates; a successful local demo does not certify them.
