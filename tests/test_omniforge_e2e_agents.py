"""Agent runs and the Agentes view in real Chromium, against the demo server's fake Claude/Codex (no model).

Every run happens in a throwaway git repository project (LabCase.scratch_repo), never in the demo's main project,
whose root is the real repository. The fake Claude reports PreToolUse, then a permission prompt (blocked), waits for
one line of terminal input, reports Stop and exits 0 with a session file; the fake Codex waits for one line, reports
turn-complete and exits 0 with a rollout. These are behaviour checks; captures are kept only with OMNIFORGE_E2E_EVIDENCE.
"""
import unittest

from test_omniforge_e2e import LabCase, evidence

# Records every state a run card showed, per task title, so a state that lasts only a moment is still seen.
RECORD_STATES = """() => {
    window.__runStates = {};
    new MutationObserver(() => {
        for (const card of document.querySelectorAll('#fleet-runs .fleet-run')) {
            const list = window.__runStates[card.querySelector('.fleet-task').textContent] ||= [];
            if (list.at(-1) !== card.dataset.state) list.push(card.dataset.state);
        }
    }).observe(document.querySelector('#fleet-runs'), { childList: true, subtree: true });
}"""
COLUMNS = {"open": "Aberta", "running": "Em execução", "blocked": "Bloqueada", "done": "Concluída"}


class AgentsE2E(LabCase):
    def states(self, page, title):
        return page.evaluate("t => window.__runStates[t] || []", title)

    def wait_state(self, page, title, state):
        page.wait_for_function("([t, s]) => (window.__runStates[t] || []).includes(s)", arg=[title, state], timeout=30000)

    def column_of(self, page, title):
        return page.evaluate("""t => [...document.querySelectorAll('#fleet-board .kanban-column')]
            .find(c => [...c.querySelectorAll('.kanban-title')].some(n => n.textContent === t))?.dataset.status""", title)

    def add_task(self, page, title):
        self.tasks[title] = self.api(page, "/api/tasks", {"projectId": self.project["id"], "title": title})["id"]

    def start(self, page, title, host):
        """Clicks "Rodar com <host>" on the task card; returns the card and the run's Lab session id."""
        from playwright.sync_api import expect
        self.view(page, "tasks")
        # By its own status control: a run's session name ("Claude · <title>") appears in every card's owner list.
        item = page.locator(f"select[aria-label='Estado de {title}']").locator("xpath=ancestor::article[1]")
        item.get_by_role("button", name=f"Rodar com {host}").click()
        for name in ("Claude", "Codex"):
            expect(item.get_by_role("button", name=f"Rodar com {name}")).to_be_disabled()
        # Both run buttons are disabled now; focus lands on the new run's badge instead of the page.
        page.wait_for_function("() => document.activeElement?.classList.contains('run-badge')")
        run = next(r for r in self.api(page, f"/api/agents?projectId={self.project['id']}")["runs"] if r["taskId"] == self.tasks[title])
        return item, run["sessionId"]

    def answer_in_terminal(self, page, title, session):
        """"Abrir terminal" on the run's card shows its Lab session in a pane; Enter there answers the waiting agent."""
        self.view(page, "fleet")
        page.locator("#fleet-runs .fleet-run", has_text=title).get_by_role("button", name="Abrir terminal").click()
        page.wait_for_selector("#view-workspace:not([hidden])")
        pane = page.locator(f"#terminal-grid > .terminal-pane[data-session-id='{session}']")
        self.assertTrue(pane.locator(".pane-select").evaluate("s => s === document.activeElement"), "focus lands on the opened pane")
        page.wait_for_function("s => document.querySelector(`#terminal-grid > .terminal-pane[data-session-id='${s}']`)?.dataset.status === 'running'", arg=session)
        pane.locator(".xterm-rows").wait_for()
        self.type_in_pane(page, pane.evaluate("p => [...p.parentNode.children].indexOf(p)"), "")

    def test_claude_and_codex_runs_drive_the_fleet_board_terminal_and_kanban(self):
        context = self.browser.new_context(viewport={"width": 1440, "height": 900}, permissions=["notifications"])
        context, page = self.open(context)
        self.project, self.tasks = self.scratch_repo(page, "Repo agentes"), {}
        claude, codex = "Ajustar o README", "Revisar o README"
        for title in (claude, codex):
            self.add_task(page, title)
        self.select_project(page, "Repo agentes")
        page.evaluate(RECORD_STATES)
        self.view(page, "fleet")
        page.get_by_text("Nenhum agente rodou neste projeto").wait_for()
        self.assertEqual(self.column_of(page, claude), "open")
        # Notifications are asked for only from this click; this browser context has already granted them.
        page.get_by_role("button", name="Ativar notificações").click()
        page.get_by_role("button", name="Desativar notificações").wait_for()

        # Claude: working, then blocked on the permission prompt, as text on the task card and on the fleet card.
        item, session = self.start(page, claude, "Claude")
        self.wait_state(page, claude, "blocked")
        item.get_by_text("Claude · Aguardando você · pedido de permissão").wait_for()
        states = self.states(page, claude)
        self.assertLess(states.index("working"), states.index("blocked"), states)
        self.view(page, "fleet")
        card = page.locator("#fleet-runs .fleet-run", has_text=claude)
        self.assertIn("Aguardando você · pedido de permissão", card.inner_text())
        self.assertIn("Uso desconhecido: Execução em andamento", card.inner_text())
        self.assertEqual(self.column_of(page, claude), "running", "a started run moves its open task to running")
        evidence(page, "fleet-blocked")

        self.answer_in_terminal(page, claude, session)
        self.wait_state(page, claude, "done")
        states = self.states(page, claude)
        self.assertLess(states.index("blocked"), states.index("idle"), states)
        self.assertLess(states.index("idle"), states.index("done"), states)
        self.view(page, "fleet")
        card.get_by_text("Tokens observados: 6.011 entrada · 6.007 saída · 103 cache lido · 24 cache criado").wait_for()
        self.assertIn("Durou", card.inner_text())

        # Codex: another task, answered the same way, with its own observed usage; active runs sort first.
        item, session = self.start(page, codex, "Codex")
        self.wait_state(page, codex, "working")
        self.view(page, "fleet")
        self.assertEqual(page.evaluate("() => [...document.querySelectorAll('#fleet-runs .fleet-run')].map(c => c.dataset.state)"), ["working", "done"])
        self.answer_in_terminal(page, codex, session)
        self.wait_state(page, codex, "done")
        self.assertLess(self.states(page, codex).index("idle"), self.states(page, codex).index("done"))
        self.view(page, "fleet")
        page.locator("#fleet-runs .fleet-run", has_text=codex).get_by_text("Tokens observados: 80 entrada · 9 saída · 40 cache lido · 2 cache criado").wait_for()
        self.view(page, "tasks")
        self.assertTrue(item.get_by_role("button", name="Rodar com Codex").is_enabled(), "a finished run frees the task for another run")

        # The kanban follows the task status set in the Tarefas view.
        for status in ("blocked", "done"):
            self.view(page, "tasks")
            page.locator(f"select[aria-label='Estado de {claude}']").select_option(status)
            self.view(page, "fleet")
            page.wait_for_function("([t, s]) => [...document.querySelectorAll(`#fleet-board .kanban-column[data-status=${s}] .kanban-title`)]"
                                   ".some(n => n.textContent === t)", arg=[claude, status])
            self.assertTrue(page.locator(f"#fleet-board .kanban-column[data-status={status}] h3").text_content().startswith(COLUMNS[status]))
        evidence(page, "fleet-done")

        # Another project never shows these runs.
        self.select_project(page, "Projeto isolado")
        self.view(page, "fleet")
        page.get_by_text("Nenhum agente rodou neste projeto").wait_for()
        self.assertEqual(page.locator("#fleet-runs .fleet-run").count(), 0)
        context.close()

    def test_the_agents_view_fits_a_phone_in_every_theme(self):
        context, page = self.open(viewport=(390, 844))
        self.project, self.tasks = self.scratch_repo(page, "Repo telefone"), {}
        title = "Tarefa com um título longo o bastante para quebrar em duas linhas no telefone"
        self.add_task(page, title)
        self.select_project(page, "Repo telefone")
        page.evaluate(RECORD_STATES)
        self.start(page, title, "Claude")
        self.wait_state(page, title, "blocked")
        for theme in ("operations", "atelier", "bridge"):
            page.locator("#theme").select_option(theme)
            for name in ("tasks", "fleet"):
                self.view(page, name)
                overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                self.assertLessEqual(overflow, 1, f"{theme}/{name}@390: horizontal overflow {overflow}px")
        # The waiting fake agent is stopped by the demo's own shutdown, like every other PTY.
        context.close()


if __name__ == "__main__":
    unittest.main()
