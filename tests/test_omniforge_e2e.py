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
console.log(JSON.stringify({ url: demo.url, token: demo.app.token, main: main.id, isolated: isolated.id,
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
    page.screenshot(path=os.path.join(target, f"{sha}-{name}.png"))


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
        self.assertEqual(nodes.count(), 3)
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


if __name__ == "__main__":
    unittest.main()
