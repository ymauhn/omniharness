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

    def test_gauntlet_waits_for_a_diff_suggests_on_a_signal_and_runs_only_after_a_confirming_click(self):
        context, page = self.open()
        project = self.scratch_repo(page, "Gauntlet E2E")
        task = self.finished_task(page, project, "Mexer na autenticação")
        agent = self.wait_run(page, project, task, "done")
        panel = self.open_review(page, project, task)
        start = panel.get_by_role("button", name="Rodar Gauntlet (revisão adversarial)")
        self.assertTrue(start.is_enabled(), "the agent's file is a diff to review")
        self.assertEqual(panel.locator(".review-suggestion").count(), 0, "no signal, no suggestion")

        # An empty diff: the fake agent's only file leaves the worktree (a scratch repository this test owns).
        worktree = agent["worktree"]
        os.replace(os.path.join(worktree, "agent-call.json"), os.path.join(self.demo.temp, f"agent-call-{task['id']}.json"))
        panel.get_by_role("button", name="Atualizar").click()
        panel.get_by_text("Nenhuma mudança na worktree em relação à base.").wait_for()
        self.assertTrue(start.is_disabled(), "nothing to review")

        # A security-sensitive path is a deterministic signal: the suggestion names it and the unknown cost.
        os.makedirs(os.path.join(worktree, "auth"))
        with open(os.path.join(worktree, "auth", "token.txt"), "w", encoding="utf-8") as handle:
            handle.write("rotacionar\n")
        panel.get_by_role("button", name="Atualizar").click()
        suggestion = panel.locator(".review-suggestion")
        suggestion.wait_for()
        self.assertIn("mexe em caminho sensível (auth/token.txt)", suggestion.inner_text())
        self.assertIn("custo: desconhecido até terminar; roda na sua sessão Claude", suggestion.inner_text())
        self.assertTrue(start.is_enabled())

        gauntlets = lambda: [r for r in self.api(page, f"/api/agents?projectId={project['id']}")["runs"] if r.get("kind") == "gauntlet"]
        posts = []
        page.on("request", lambda request: posts.append(request.url) if request.method == "POST" and request.url.endswith("/gauntlet") else None)
        # A double-click's second click, or a held Enter's repeats, land on the relabelled button: neither confirms.
        start.dblclick()
        confirm = panel.get_by_role("button", name="Confirmar: rodar Gauntlet (rápido)")
        self.assertTrue(confirm.is_visible(), "a double-click only asks for confirmation")
        panel.get_by_role("button", name="Cancelar").click()
        start.focus()
        page.keyboard.down("Enter")
        confirm.wait_for()
        page.keyboard.down("Enter")
        page.keyboard.down("Enter")
        page.keyboard.up("Enter")
        self.assertTrue(confirm.is_visible(), "a held Enter only asks for confirmation")
        self.assertEqual(posts, [])
        self.assertEqual(gauntlets(), [], "the first click only asks for confirmation")
        # The agent exited on its own, so its session is uncertain: the Lab refuses until the owner checks it.
        confirm.click()
        panel.get_by_text("Gauntlet não iniciado: Há uma sessão incerta nesta pasta do projeto").wait_for()
        self.assertEqual(len(posts), 1, "the deliberate confirmation posts once")
        self.assertEqual(gauntlets(), [])
        self.api(page, f"/api/sessions/{agent['sessionId']}/acknowledge", {"verification": "Processo do agente encerrado (E2E)"})
        start.click()
        panel.get_by_role("button", name="Confirmar: rodar Gauntlet (rápido)").click()

        # Its state comes from the agent SSE: the fake Claude waits on a permission prompt, then saves its report and exits.
        panel.get_by_text("Gauntlet: Aguardando você · pedido de permissão").wait_for(timeout=30000)
        self.assertTrue(start.is_disabled(), "one Gauntlet at a time")
        [review] = gauntlets()
        self.assertEqual(review["worktree"], worktree)
        self.api(page, f"/api/sessions/{review['sessionId']}/write", {"data": "\r"})
        entry = panel.locator(".review-attempt[data-kind=gauntlet]")
        entry.wait_for(timeout=30000)
        self.assertIn("Gauntlet rápido: alta 1 · média 0 · baixa 2 · sem verificação 0", entry.inner_text())
        self.assertIn(os.path.join(worktree, ".gauntlet", "relatorio-fake.md"), entry.inner_text())
        self.assertIn("Uso: observado", entry.inner_text())
        panel.get_by_text("Gauntlet: Concluído").wait_for()
        recorded = self.api(page, f"/api/tasks/{task['id']}/evidence")
        self.assertEqual([g["runId"] for g in recorded["gauntlet"]], [review["id"]])
        self.assertEqual(recorded["attempts"], [], "no merge was attempted")
        self.assertNotIn(".gauntlet", panel.locator(".review-files").inner_text(), "the report never enters the diff")
        self.assertFalse(SENTINEL in page.content(), "the runner's environment is shown in the review")
        evidence(page, "review-gauntlet")
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
