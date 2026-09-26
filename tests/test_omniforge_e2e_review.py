"""E2E: a task run by the fake Claude is reviewed and merged from the Tarefas view (app/review-panel.mjs).

Each test runs the agent on its own throwaway git repository (LabCase.scratch_repo), never on the demo's main
project, whose root is the real repository. A behaviour check in real Chromium, not a visual verdict.
"""
import os
import subprocess
import time
import unittest
from unittest import mock

from test_omniforge_e2e import LabCase, evidence

# Stands in for a real credential in the runner's environment, which must never reach the page, a capture or the repo.
SENTINEL = "sk-ant-e2e-sentinel-not-a-key"


class ReviewE2E(LabCase):
    @classmethod
    def setUpClass(cls):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": SENTINEL}):
            super().setUpClass()

    def finished_task(self, page, project, title):
        """Create a task, run it with the fake Claude, answer its permission prompt and wait for it to finish."""
        task = self.api(page, "/api/tasks", {"projectId": project["id"], "title": title})
        run = self.api(page, f"/api/tasks/{task['id']}/run", {"host": "claude", "expectedRevision": task["revision"]})
        self.assertEqual(run.get("state"), "working", run)
        self.wait_run(page, project, task, "blocked")
        self.api(page, f"/api/sessions/{run['sessionId']}/write", {"data": "\r"})
        self.wait_run(page, project, task, "done")
        return task

    def wait_run(self, page, project, task, state, timeout=30):
        deadline = time.monotonic() + timeout
        while True:
            runs = [r for r in self.api(page, f"/api/agents?projectId={project['id']}")["runs"] if r["taskId"] == task["id"]]
            if runs and runs[0]["state"] == state:
                return runs[0]
            self.assertLess(time.monotonic(), deadline, f"run never reached {state}: {runs[:1]}")
            time.sleep(0.2)

    def open_review(self, page, project, task):
        self.select_project(page, project["name"])
        self.view(page, "tasks")
        button = page.get_by_role("button", name=f"Revisar {task['title']}")
        button.focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.activeElement?.id === 'review-title'")
        panel = page.locator("#review-panel")
        panel.locator(".review-files").get_by_text("agent-call.json").wait_for()
        return panel

    def test_diff_refused_merge_then_merge_into_the_scratch_main(self):
        context, page = self.open()
        project = self.scratch_repo(page, "Revisão E2E")
        task = self.finished_task(page, project, "Gerar agent-call")
        panel = self.open_review(page, project, task)
        self.assertIn("adicionado", panel.locator(".review-files").inner_text())
        self.assertIn('+{"args"', panel.locator(".review-patch [data-kind=add]").first.inner_text())

        panel.get_by_label("Comando de teste (opcional)").fill("exit 3")
        panel.get_by_label("Nota do revisor (opcional)").fill("Recusa esperada")
        panel.get_by_role("button", name="Aprovar e fazer merge").click()
        refusal = "O comando de teste falhou (código 3)"
        panel.locator(".review-outcome[data-kind=refused]").get_by_text(f"Merge recusado: {refusal}").wait_for(timeout=60000)
        self.assertEqual(panel.get_by_label("Comando de teste (opcional)").input_value(), "exit 3", "the refusal keeps the inputs")
        self.assertEqual(panel.get_by_label("Nota do revisor (opcional)").input_value(), "Recusa esperada")
        attempt = panel.locator(".review-attempt").first
        attempt.get_by_text(f"Recusado: {refusal}").wait_for()
        self.assertIn("Teste: exit 3 · código 3", attempt.inner_text())
        self.assertIn("Nota: Recusa esperada", attempt.inner_text())
        recorded = self.api(page, f"/api/tasks/{task['id']}/evidence")["attempts"]
        self.assertEqual([a["refused"]["reason"] for a in recorded], [refusal])
        # assertFalse, not assertNotIn: a failure must not print the page, and with it the environment, into the log.
        self.assertFalse(SENTINEL in page.content(), "the runner's environment is shown in the review")
        evidence(page, "review-refused")

        panel.get_by_label("Comando de teste (opcional)").fill("exit 0")
        panel.get_by_label("Nota do revisor (opcional)").fill("Diff conferido")
        panel.get_by_role("button", name="Aprovar e fazer merge").click()
        merged = panel.locator(".review-outcome[data-kind=merged]")
        merged.wait_for(timeout=60000)
        root = project["root"]
        git = lambda *args: subprocess.run(["git", "-C", root, *args], check=True, capture_output=True, text=True).stdout.strip()
        head = git("rev-parse", "main")
        self.assertEqual(merged.inner_text(), f"Merge concluído: {head}")
        self.assertEqual(len(git("rev-list", "--parents", "-n", "1", head).split()), 3, "main's head is a merge commit")
        self.assertTrue(os.path.isfile(os.path.join(root, "agent-call.json")), "the agent's file reached the root")
        self.assertFalse(SENTINEL in git("show", "main:agent-call.json"), "the runner's environment was merged")
        page.wait_for_function("id => document.querySelector(`#task-list [data-focus-key='task:${id}:status']`)?.value === 'done'", arg=task["id"])
        self.assertEqual(next(t for t in self.api(page, "/api/state")["tasks"] if t["id"] == task["id"])["status"], "done")
        panel.locator(".review-attempt").nth(1).wait_for()
        self.assertIn(f"Merge {head}", panel.locator(".review-attempt").first.inner_text(), "attempts are listed newest first")
        self.assertIn("Uso: observado", panel.locator(".review-attempt").first.inner_text())
        evidence(page, "review-merged")
        context.close()

    def test_narrow_panel_is_keyboard_reachable_named_and_closes_on_a_project_switch(self):
        context, page = self.open(viewport=(390, 844))
        project = self.scratch_repo(page, "Revisão estreita")
        task = self.finished_task(page, project, "Conferir layout")
        panel = self.open_review(page, project, task)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        self.assertLessEqual(overflow, 1, f"review panel at 390px: horizontal overflow {overflow}px")
        unnamed = page.evaluate("""() => [...document.querySelectorAll('#review-panel button, #review-panel input, #review-panel textarea')]
            .filter(e => !((e.getAttribute('aria-label') || '').trim() || (e.textContent || '').trim() || (e.labels && [...e.labels].some(l => l.textContent.trim()))))
            .map(e => e.outerHTML.slice(0, 120))""")
        self.assertEqual(unnamed, [])
        panel.get_by_role("button", name="Fechar revisão").click()
        self.assertTrue(panel.is_hidden())
        page.wait_for_function("k => document.activeElement?.dataset.focusKey === k", arg=f"task:{task['id']}:review")
        page.keyboard.press("Enter")
        panel.locator(".review-files").wait_for()
        self.view(page, "workspace")
        self.select_project(page, "OmniHarness")
        self.view(page, "tasks")
        self.assertTrue(panel.is_hidden(), "a project switch closes the panel")
        self.assertEqual(panel.inner_text(), "")
        context.close()


if __name__ == "__main__":
    unittest.main()
