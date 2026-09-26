"""End-to-end Lab checks in real Chromium (Playwright), against a fresh synthetic demo server.

Each run starts `omniforge-lab/demo.mjs` in a new temporary directory (two real PTYs, no model), drives the
served page and stops the server through its own shutdown path. These are behaviour checks in a real browser;
they are not a visual verdict. Set OMNIFORGE_E2E_EVIDENCE=<dir> to keep viewport captures named by source SHA.
Missing Playwright/Chromium or Node dependencies are errors, never skipped coverage.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAUNCHER = r"""
import { pathToFileURL } from 'node:url';
const { startDemo } = await import(pathToFileURL(process.argv[1] + '/omniforge-lab/demo.mjs'));
const demo = await startDemo({ tempRoot: process.env.OMNIFORGE_E2E_TEMP });
const { main, isolated, tasks, sessions } = demo.fixture;
console.log(JSON.stringify({ url: demo.url, token: demo.app.token, main: main.id, isolated: isolated.id, isolatedRoot: isolated.root,
  tasks: tasks.map(t => t.id), sessions: sessions.map(s => s.id) }));
process.stdin.once('data', async () => {
  try { await demo.app.close(); console.log('CLOSED'); } catch (error) { console.log('CLOSE_FAILED ' + error.message); }
  process.exit(0);
});
"""


class Demo:
    """A fresh demo server in its own temp dir; stop() uses the app's own shutdown and reports it."""

    def __init__(self):
        self.temp = tempfile.mkdtemp(prefix="omniforge-e2e-")
        env = dict(os.environ, OMNIFORGE_E2E_TEMP=self.temp)
        self.proc = subprocess.Popen(["node", "--input-type=module", "-e", LAUNCHER, ROOT], cwd=ROOT, env=env,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                     encoding="utf-8")
        line = self.proc.stdout.readline()
        if not line.startswith("{"):
            self.proc.kill()
            raise RuntimeError(f"demo did not start: {line!r} {self.proc.stderr.read()[-2000:]}")
        self.info = json.loads(line)
        self.url = self.info["url"]
        self.origin = self.url.split("/?")[0]

    def stop(self):
        self.proc.stdin.write("close\n")
        self.proc.stdin.flush()
        closed = self.proc.stdout.readline().strip()
        self.proc.wait(timeout=30)
        shutil.rmtree(self.temp, ignore_errors=True)
        return closed


def evidence(page, name):
    target = os.environ.get("OMNIFORGE_E2E_EVIDENCE")
    if not target:
        return
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    os.makedirs(target, exist_ok=True)
    page.screenshot(path=os.path.join(target, f"{sha}-{name}.png"), full_page=True)


class LabE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.demo = Demo()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        closed = cls.demo.stop()
        assert closed == "CLOSED", f"demo shutdown not confirmed: {closed}"

    def open(self, context=None, url=None, viewport=(1440, 900)):
        context = context or self.browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url or self.demo.url)
        page.wait_for_selector("#connection[data-state=connected]")
        self.addCleanup(lambda: self.assertEqual(errors, [], "uncaught page errors"))
        return context, page

    def select_project(self, page, name):
        page.locator("#project-list .rail-item", has_text=name).click()
        page.wait_for_function("name => document.querySelector('#workspace-scope').textContent.startsWith(name)", arg=name)

    def api(self, page, route, body=None):
        """Call the local API with the token the page keeps in its own storage."""
        return page.evaluate("""async ([route, body]) => {
            const options = { headers: { 'X-OmniForge-Token': localStorage.getItem('omniforge-token'), 'content-type': 'application/json' } };
            if (body !== null) Object.assign(options, { method: 'POST', body: JSON.stringify(body) });
            return (await fetch(route, options)).json();
        }""", [route, body])

    def view(self, page, name):
        page.locator(f"[data-view={name}]").click()
        page.wait_for_selector(f"#view-{name}:not([hidden])")

    def pane_text(self, page, index):
        return page.locator("#terminal-grid > .terminal-pane").nth(index).locator(".xterm-rows").inner_text()

    def type_in_pane(self, page, index, text):
        page.locator("#terminal-grid > .terminal-pane").nth(index).locator(".terminal-xterm").click()
        page.keyboard.type(text)
        page.keyboard.press("Enter")

    def test_launch_token_leaves_the_url_sets_no_cookie_and_opens_a_second_window(self):
        context, page = self.open()
        self.assertNotIn("token", page.url)
        self.assertEqual(context.cookies(), [])
        second = context.new_page()
        second.goto(self.demo.origin + "/")
        second.wait_for_selector("#connection[data-state=connected]")
        self.assertEqual(second.locator("#project-list .rail-item").count(), 2)
        stranger = self.browser.new_context().new_page()
        stranger.goto(self.demo.origin + "/")
        stranger.wait_for_selector("#connection[data-state=error]")
        self.assertIn("Novo URL", stranger.locator("#connection").inner_text())
        evidence(page, "auth-workspace")
        context.close()

    def test_terminals_keep_output_per_session_replay_after_reload_and_stop_only_the_chosen_shell(self):
        context, page = self.open()
        self.select_project(page, "OmniHarness")
        page.wait_for_function("() => document.querySelectorAll('#terminal-grid .xterm-rows').length === 2")
        page.wait_for_function("() => [...document.querySelectorAll('#terminal-grid .xterm-rows')].every(r => r.textContent.includes('PS '))")
        self.type_in_pane(page, 0, "Write-Output ('E2E_' + 'PANE_ONE')")
        page.wait_for_function("() => document.querySelectorAll('#terminal-grid .xterm-rows')[0].textContent.includes('E2E_PANE_ONE')")
        self.assertNotIn("E2E_PANE_ONE", self.pane_text(page, 1))
        page.reload()
        page.wait_for_selector("#connection[data-state=connected]")
        page.wait_for_function("() => document.querySelectorAll('#terminal-grid .xterm-rows')[0]?.textContent.includes('E2E_PANE_ONE')")
        self.assertIn("mem", page.locator("#terminal-grid .terminal-replay-status").first.inner_text().lower())
        evidence(page, "terminals-replay")
        page.get_by_role("button", name="Parar shell do terminal 2").click()
        page.wait_for_function("() => document.querySelectorAll('#terminal-grid > .terminal-pane')[1].dataset.status === 'stopped'")
        self.assertEqual(page.locator("#terminal-grid > .terminal-pane").nth(0).get_attribute("data-status"), "running")
        self.type_in_pane(page, 0, "Write-Output ('STILL_' + 'ALIVE')")
        page.wait_for_function("() => document.querySelectorAll('#terminal-grid .xterm-rows')[0].textContent.includes('STILL_ALIVE')")
        context.close()

    def test_grid_allows_eight_panes_and_closing_a_pane_keeps_its_session(self):
        context, page = self.open()
        self.select_project(page, "OmniHarness")
        add = page.get_by_role("button", name="Adicionar painel")
        while add.is_enabled():
            add.click()
        self.assertEqual(page.locator("#terminal-grid > .terminal-pane").count(), 8)
        self.assertTrue(add.is_disabled())
        page.get_by_role("button", name="Fechar painel 8 sem parar a sessão").click()
        self.assertEqual(page.locator("#terminal-grid > .terminal-pane").count(), 7)
        self.assertEqual(page.locator("#session-list .rail-item").count(), 2)
        slider = page.locator(".grid-sizes input[type=range]").first.evaluate(
            "el => { const s = getComputedStyle(el); return [s.paddingLeft, s.borderTopStyle]; }")
        self.assertEqual(slider, ["0px", "none"], "the global form-control rule must not restyle range sliders")
        evidence(page, "grid-seven-panes")
        context.close()

    def test_switching_projects_never_shows_the_other_projects_private_context(self):
        context, page = self.open()
        self.select_project(page, "Projeto isolado")
        page.locator("[data-view=graphs]").click()
        page.wait_for_function("() => document.querySelector('#memory-list').textContent.includes('MARCADOR_ISOLADO_DEMO')")
        self.assertEqual(page.locator("#session-list .rail-item").count(), 0)
        self.select_project(page, "OmniHarness")
        page.wait_for_function("() => document.querySelector('#memory-list').textContent.includes('dados sintéticos')")
        page.get_by_role("button", name="Consultar").click()
        page.wait_for_function("() => document.querySelector('#context-list').textContent.includes('Decisão aceita')")
        for area in ("#memory-list", "#context-list", "#graph-canvas", "#session-list"):
            self.assertNotIn("MARCADOR_ISOLADO_DEMO", page.locator(area).inner_text())
        context.close()

    def test_task_graph_help_follows_hover_and_keyboard_focus_and_escape_hides_it(self):
        context, page = self.open()
        self.select_project(page, "OmniHarness")
        page.locator("[data-view=tasks]").click()
        page.locator("#show-task-graph").click()
        nodes = page.locator("#graph-canvas .graph-node[data-kind=task]")
        expected = min(15, len([t for t in self.api(page, "/api/state")["tasks"] if t["projectId"] == self.demo.info["main"]]))
        self.assertEqual(nodes.count(), expected)
        nodes.nth(0).hover()
        page.wait_for_selector("#graph-help:not([hidden])")
        self.assertEqual(page.locator("#graph-help-title").inner_text(), nodes.nth(0).inner_text())
        nodes.nth(1).focus()
        page.wait_for_function("t => document.querySelector('#graph-help-title').textContent === t", arg=nodes.nth(1).inner_text())
        self.assertEqual(nodes.nth(1).get_attribute("aria-describedby"), "graph-help")
        evidence(page, "graph-help-focus")
        page.keyboard.press("Escape")
        page.wait_for_selector("#graph-help[hidden]", state="attached")
        context.close()


    def test_copilot_pause_escape_selection_apply_undo_stale_and_off(self):
        context, page = self.open()
        self.select_project(page, "OmniHarness")
        draft = page.locator("#coord-text")
        original = "Revisar o grafo de tarefas do OmniHarness"
        draft.click()
        draft.type(original)
        panel = page.locator("#prompt-copilot .cp-panel")
        panel.wait_for(state="visible", timeout=6000)
        self.assertIn("Pausa boa", panel.inner_text())
        evidence(page, "copilot-pause")
        draft.press("Escape")
        panel.wait_for(state="hidden")
        self.assertEqual(page.evaluate("document.activeElement.id"), "coord-text")
        start = original.index("grafo de tarefas")
        page.evaluate("([s, e]) => { const d = document.querySelector('#coord-text'); d.focus(); d.setSelectionRange(s, e); d.dispatchEvent(new Event('select')); }", [start, start + len("grafo de tarefas")])
        self.assertIn("Trecho selecionado", page.locator("#prompt-copilot").inner_text())
        page.get_by_role("button", name="Clareza", exact=True).click()
        preview = page.locator("#prompt-copilot pre.cp-preview")
        preview.wait_for()
        expected = preview.inner_text()
        self.assertTrue(expected.startswith(original) and "grafo de tarefas" in expected[len(original):], expected)
        page.get_by_role("button", name="Aplicar no rascunho").click()
        self.assertEqual(draft.input_value().replace("\r\n", "\n"), expected.replace("\r\n", "\n"))
        page.get_by_role("button", name="Desfazer última aplicação").click()
        self.assertEqual(draft.input_value(), original)
        page.get_by_role("button", name="Clareza", exact=True).click()
        preview.wait_for()
        draft.press("End")
        draft.type(" agora")
        apply = page.get_by_role("button", name="Aplicar no rascunho")
        if apply.is_visible():
            apply.click()
        self.assertEqual(draft.input_value(), original + " agora")
        page.locator("#prompt-copilot details.cp-settings > summary").click()
        page.locator("#prompt-copilot label.cp-field", has_text="Assistência").locator("select").select_option("off")
        draft.click()
        draft.type(" sem assistente")
        page.wait_for_timeout(2500)
        self.assertFalse(panel.is_visible())
        context.close()

    def test_copilot_respects_reduced_motion(self):
        context = self.browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
        context, page = self.open(context)
        self.select_project(page, "OmniHarness")
        page.locator("#coord-text").click()
        page.locator("#coord-text").type("Planejar a revisão das skills")
        page.locator("#prompt-copilot .cp-panel").wait_for(state="visible", timeout=6000)
        self.assertFalse(page.evaluate("[...document.querySelectorAll('#prompt-copilot .cp-pop')].length > 0"))
        context.close()

    def test_workflow_saved_version_creates_dependent_tasks_and_insert_does_not_submit(self):
        context, page = self.open()
        self.select_project(page, "OmniHarness")
        before = self.api(page, "/api/state")
        self.view(page, "workflows")
        page.locator(".wf-group").nth(1).locator(".wf-library-item").first.click()
        page.locator(".wf-canvas .wf-node").first.click()
        page.get_by_role("button", name="Inserir no chat").click()
        self.assertTrue(page.locator("#coord-text").input_value().strip())
        self.assertEqual(len(self.api(page, "/api/state")["tasks"]), len(before["tasks"]))
        self.view(page, "workflows")
        page.locator(".wf-check input").check()
        page.get_by_role("button", name="Salvar no projeto").click()
        page.wait_for_function("() => document.querySelector('.wf-panel').textContent.includes('v1')")
        page.locator(".wf-canvas .wf-node").last.click()
        page.get_by_role("button", name=__import__("re").compile("^Criar .* até este nó")).click()
        page.wait_for_function("n => document.querySelectorAll('#task-list .list-item').length > n || true", arg=0)
        page.wait_for_timeout(500)
        after = self.api(page, "/api/state")
        created = [t for t in after["tasks"] if t["id"] not in {x["id"] for x in before["tasks"]}]
        self.assertGreaterEqual(len(created), 2)
        self.assertTrue(any(t["dependsOn"] for t in created))
        self.assertTrue(all(t["status"] == "open" for t in created))
        self.assertEqual(len(after["sessions"]), len(before["sessions"]))
        evidence(page, "workflow-tasks")
        context.close()

    def test_memory_edit_history_and_two_window_conflict_keeps_the_draft(self):
        context, page = self.open()
        self.select_project(page, "OmniHarness")
        self.view(page, "graphs")
        build = self.demo.info["sessions"][0]
        page.locator("#memory-scope").select_option("session")
        page.locator("#memory-session").select_option(build)
        page.locator("#memory-source").fill("E2E")
        page.locator("#memory-text").fill("Nota E2E revisão inicial")
        page.get_by_role("button", name="Guardar nota").click()
        page.wait_for_timeout(300)
        notes = self.api(page, f"/api/memory?projectId={self.demo.info['main']}&sessionId={build}")["notes"]
        note = next(n for n in notes if n["text"] == "Nota E2E revisão inicial")
        second = context.new_page()
        second.goto(self.demo.origin + "/")
        second.wait_for_selector("#connection[data-state=connected]")
        for p in (page, second):
            if p is second:
                self.select_project(p, "OmniHarness")
                self.view(p, "graphs")
            p.locator("#memory-list label", has_text="Notas de uma sessão").locator("select").select_option(label="Build")
            p.locator(f"[data-memory-action='{note['id']}:edit']").click()
        page.locator("form.memory-editor textarea").fill("Nota E2E revisão da janela 1")
        page.locator("form.memory-editor input").last.fill("E2E janela 1")
        page.get_by_role("button", name="Salvar revisão").click()
        page.wait_for_function("() => document.querySelector('#memory-list').textContent.includes('revisão 2')")
        second.locator("form.memory-editor textarea").fill("Rascunho da janela 2")
        second.locator("form.memory-editor input").last.fill("E2E janela 2")
        second.get_by_role("button", name="Salvar revisão").click()
        second.wait_for_function("() => /Conflito/i.test(document.querySelector('#memory-list').textContent)")
        self.assertEqual(second.locator("form.memory-editor textarea").input_value(), "Rascunho da janela 2")
        page.locator(f"[data-memory-action='{note['id']}:history']").click()
        page.wait_for_function("() => document.querySelector('#memory-list').textContent.includes('Histórico preservado')")
        evidence(second, "memory-conflict")
        context.close()

    def test_accessibility_names_keyboard_navigation_and_no_overflow_in_every_theme(self):
        for width, height in ((390, 844), (1024, 768), (1440, 900)):
            context, page = self.open(viewport=(width, height))
            self.select_project(page, "OmniHarness")
            for theme in ("operations", "atelier", "bridge"):
                page.locator("#theme").select_option(theme)
                for name in ("workspace", "tasks", "workflows", "arsenal", "graphs", "assets", "usage"):
                    page.locator(f"[data-view={name}]").click()
                    page.wait_for_timeout(250)
                    boxes = page.evaluate("() => [...document.querySelectorAll('input[type=checkbox]')].filter(b => b.offsetParent !== null).map(b => b.getBoundingClientRect().width)")
                    self.assertTrue(all(w <= 24 for w in boxes), f"{theme}/{name}@{width}: stretched checkboxes {boxes}")
                    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                    self.assertLessEqual(overflow, 1, f"{theme}/{name}@{width}: horizontal overflow {overflow}px")
                    unnamed = page.evaluate("""() => [...document.querySelectorAll('button, select, input, textarea, [role=tab]')]
                        .filter(e => e.offsetParent !== null && e.type !== 'hidden')
                        .filter(e => !((e.getAttribute('aria-label') || '').trim() || (e.textContent || '').trim() || (e.labels && [...e.labels].some(l => l.textContent.trim())) || e.getAttribute('aria-labelledby') || e.title))
                        .map(e => e.outerHTML.slice(0, 120))""")
                    self.assertEqual(unnamed, [], f"{theme}/{name}@{width}: controls without an accessible name")
                if width == 1440:
                    evidence(page, f"theme-{theme}")
            nav = page.get_by_role("button", name="Tarefas")
            nav.focus()
            page.keyboard.press("Enter")
            page.wait_for_selector("#view-tasks:not([hidden])")
            context.close()

    def test_recovery_from_a_network_failure_keeps_the_draft_and_the_next_action_succeeds(self):
        # Chromium's offline mode fails new requests but keeps an open event stream, so this checks request failure
        # handling and recovery; stream replay after a reload is covered by the terminal test.
        context, page = self.open()
        self.select_project(page, "OmniHarness")
        before = len(self.api(page, "/api/state")["tasks"])
        page.locator("#coord-form select[name=action]").select_option("task")
        page.locator("#coord-text").fill("Tarefa criada depois da queda de rede")
        context.set_offline(True)
        page.locator("#coord-form button[type=submit]").click()
        page.locator("#toast").get_by_text("Servidor local indisponível").wait_for()
        self.assertEqual(page.locator("#coord-text").input_value(), "Tarefa criada depois da queda de rede")
        context.set_offline(False)
        page.locator("#coord-form button[type=submit]").click()
        page.wait_for_function("() => document.querySelector('#coord-text').value === ''")
        self.assertEqual(len(self.api(page, "/api/state")["tasks"]), before + 1)
        context.close()

    def test_minitool_is_generated_from_the_composer_reviewed_enabled_run_and_disabled(self):
        root = self.demo.info["isolatedRoot"]
        os.makedirs(os.path.join(root, "img"), exist_ok=True)
        with open(os.path.join(root, "README.md"), "w", encoding="utf-8") as handle:
            handle.write("![ok](img/ok.png)\n![quebrado](img/falta.png)\n")
        with open(os.path.join(root, "img", "ok.png"), "wb") as handle:
            handle.write(b"x")
        context, page = self.open()
        self.select_project(page, "Projeto isolado")
        page.locator("#coord-form select[name=action]").select_option("minitool")
        page.locator("#coord-text").fill("Verificar links quebrados nos assets")
        page.locator("#coord-form button[type=submit]").click()
        page.wait_for_selector("#view-assets:not([hidden])")
        self.assertIn("template revisado", page.locator("#coord-log").text_content())
        panel = page.locator("#extensions-panel")
        panel.get_by_text("Versão 1", exact=True).wait_for()
        panel.get_by_text("Ver código e manifesto da versão 1").click()
        panel.locator("pre.ext-code").wait_for()
        self.assertIn("function check(input)", panel.locator("pre.ext-code").inner_text())
        enable = panel.get_by_role("button", name="Ativar versão 1")
        self.assertTrue(enable.is_disabled())
        panel.locator(".ext-check input").check()
        panel.get_by_role("button", name="Pré-visualizar versão 1 nos fixtures").focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.activeElement?.dataset.focusKey === 'preview:1'")
        panel.get_by_text("pré-visualização aprovada").first.wait_for()
        self.assertTrue(panel.locator(".ext-check input").is_checked(), "the review tick survives the render")
        self.assertTrue(panel.locator("pre.ext-code").is_visible(), "the open code viewer survives the render")
        panel.locator(".ext-check input").uncheck()
        panel.get_by_role("button", name="Ativar versão 1").click()
        panel.get_by_text("Marque a revisão").wait_for()
        panel.locator(".ext-check input").check()
        panel.get_by_role("button", name="Ativar versão 1").click()
        panel.get_by_text("Ativa: versão 1.").wait_for()
        panel.get_by_role("button", name="Verificar links agora").click()
        panel.locator(".ext-missing").wait_for()
        self.assertIn("README.md:2 → img/falta.png", panel.locator(".ext-missing").inner_text())
        self.assertNotIn("img/ok.png", panel.locator(".ext-missing").inner_text())
        evidence(page, "minitool-report")
        # Another project selected outside Assets must not inherit this project's report or status.
        self.view(page, "workspace")
        self.select_project(page, "OmniHarness")
        self.view(page, "assets")
        panel.get_by_text("Nenhuma versão ativa").wait_for()
        self.assertEqual(panel.locator(".ext-report").count(), 0)
        self.assertNotIn("img/falta.png", panel.inner_text())
        self.assertNotIn("Versão 1 ativada", panel.inner_text())
        self.view(page, "workspace")
        self.select_project(page, "Projeto isolado")
        self.view(page, "assets")
        panel.get_by_text("Ativa: versão 1.").wait_for()
        panel.get_by_role("button", name="Desativar").click()
        panel.get_by_text("Nenhuma versão ativa").wait_for()
        self.assertEqual(self.api(page, "/api/extensions/run", {"projectId": self.demo.info["isolated"]})["reason"], "disabled")
        context.close()

    def test_usage_keeps_four_figures_and_keys_show_only_a_masked_suffix(self):
        context, page = self.open()
        self.view(page, "usage")
        cards = page.locator(".usage-figure")
        cards.first.wait_for()
        self.assertEqual(cards.count(), 4)
        self.assertIn("não consultado", cards.nth(0).inner_text())
        for index in (1, 2, 3):
            self.assertIn("Desconhecido", cards.nth(index).inner_text())
        dummy = "dummy-e2e-not-a-real-key-7Q2Z"
        try:
            page.locator(".usage-keys input[type=password]").fill(dummy)
            page.get_by_role("button", name="Guardar no cofre do Windows").click()
            page.get_by_text("••••7Q2Z").wait_for(timeout=20000)
            self.assertNotIn(dummy, page.content())
            evidence(page, "usage-keys")
            page.get_by_role("button", name="Remover chave jev terminada em 7Q2Z").click()
            page.get_by_role("button", name="Confirmar remoção da chave jev terminada em 7Q2Z").click()
            page.get_by_text("Nenhuma chave guardada.").wait_for(timeout=20000)
        finally:
            # The demo writes to the real Windows vault: never leave the dummy credential behind if the UI path fails.
            for key in self.api(page, "/api/keys").get("keys", []):
                if key["suffix"] == "7Q2Z":
                    self.api(page, "/api/keys/remove", {"ref": key["ref"]})
            context.close()

    def test_tasks_show_the_owner_session_replan_after_a_blocked_prerequisite_and_record_a_handoff(self):
        context, page = self.open()
        self.select_project(page, "OmniHarness")
        self.view(page, "tasks")
        define, build, review = self.demo.info["tasks"]
        titles = {t["id"]: t["title"] for t in self.api(page, "/api/state")["tasks"]}
        item = page.locator(f"select[aria-label='Estado de {titles[build]}']").locator("xpath=ancestor::article[1]")
        owner = item.locator("select[aria-label^='Sessão responsável']")
        owner.focus()
        owner.select_option(self.demo.info["sessions"][0])
        item.get_by_text("Em Build").wait_for()
        page.wait_for_function("k => document.activeElement?.dataset.focusKey === k", arg=f"task:{build}:owner")
        page.locator(f"select[aria-label='Estado de {titles[define]}']").select_option("blocked")
        page.locator(f"select[aria-label='Estado de {titles[review]}']").locator("xpath=ancestor::article[1]").get_by_text("Bloqueada automaticamente").wait_for()
        item = page.locator(f"select[aria-label='Estado de {titles[build]}']").locator("xpath=ancestor::article[1]")
        item.locator("summary", has_text="Registrar handoff").click()
        item.locator(".task-handoff-form select").select_option("claude")
        note = "Teste vermelho pronto; falta a correção."
        item.locator(".task-handoff-form input").fill(note)
        # A task created by another client broadcasts a state event that rebuilds the task list.
        self.api(page, "/api/tasks", {"projectId": self.demo.info["main"], "title": "Tarefa criada por outra janela"})
        page.locator("#task-list").get_by_text("Tarefa criada por outra janela").wait_for()
        self.assertTrue(item.locator("details.task-handoff").evaluate("d => d.open"), "the handoff form stays open")
        self.assertEqual(item.locator(".task-handoff-form input").input_value(), note)
        self.assertEqual(item.locator(".task-handoff-form select").input_value(), "claude")
        self.assertEqual(page.evaluate("document.activeElement.dataset.focusKey"), f"task:{build}:handoff-note")
        page.keyboard.press("Enter")
        item.get_by_text("Último handoff → claude").wait_for()
        page.wait_for_function("k => document.activeElement?.dataset.focusKey === k", arg=f"task:{build}:handoff")
        page.locator(f"select[aria-label='Estado de {titles[define]}']").select_option("open")
        page.wait_for_function("t => ![...document.querySelectorAll('#task-list .list-item')].some(i => i.textContent.includes(t) && i.textContent.includes('Bloqueada automaticamente'))", arg=titles[review])
        evidence(page, "tasks-owner-handoff")
        context.close()

    def test_agent_template_needs_rule_review_before_activation_and_its_pin_never_executes(self):
        context, page = self.open()
        self.select_project(page, "OmniHarness")
        self.view(page, "arsenal")
        page.get_by_role("button", name="Importar rascunho").first.click()
        page.get_by_role("button", name="Registrar revisão desta versão").wait_for()
        activate = page.get_by_role("button", name="Ativar esta versão")
        self.assertTrue(activate.count() == 0 or activate.is_disabled(), "a draft must not be activatable before its rules are reviewed")
        boxes = page.locator(".ars-review input[type=checkbox]")
        widths = page.evaluate("() => [...document.querySelectorAll('.ars-review input[type=checkbox]')].map(b => b.getBoundingClientRect().width)")
        self.assertTrue(widths and max(widths) <= 24, f"review checkboxes must keep their intrinsic size: {widths}")
        evidence(page, "arsenal-review")
        for box in boxes.all():
            box.check()
        page.get_by_role("button", name="Registrar revisão desta versão").click()
        page.wait_for_function("() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Ativar esta versão'); return b && !b.disabled; }")
        activate.click()
        page.locator(".ars-pin label", has_text="Tarefa deste projeto").locator("select").select_option(index=1)
        page.get_by_role("button", name="Vincular à tarefa").click()
        page.get_by_text("sem execução").first.wait_for()
        evidence(page, "arsenal-pin")
        self.select_project(page, "Projeto isolado")
        page.wait_for_timeout(500)
        self.assertEqual(page.locator("button.ars-profile").count(), 0)
        context.close()


if __name__ == "__main__":
    unittest.main()
