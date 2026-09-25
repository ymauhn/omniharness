"""Claude auxiliary hook contracts. No models, network or arbitrary project commands."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("verify_hooks", ROOT / "harness/hooks/verify.py")
hook = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(hook)


class Hooks(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(ROOT), "OMNIHARNESS_SANDBOX": "0"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_session_start_uses_only_fixed_local_checks_and_reports_insufficient(self):
        result = subprocess.CompletedProcess([], 0, "INSUFFICIENT: no comparable baseline", "")
        with patch.object(hook.subprocess, "run", return_value=result) as run:
            out = hook.handle({"hook_event_name": "SessionStart", "cwd": str(ROOT)})
        calls = [c.args[0] for c in run.call_args_list]
        self.assertEqual(calls, [[sys.executable, str(ROOT / "scripts/install.py"), "--check"],
                                 [sys.executable, str(ROOT / "evals/run.py"), "regress"]])
        self.assertIn("INSUFFICIENT", out["hookSpecificOutput"]["additionalContext"])
        self.assertNotIn("regress: OK", out["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "SessionStart")
        for call in run.call_args_list:
            self.assertEqual(call.kwargs["cwd"], ROOT)
            self.assertLessEqual(call.kwargs["timeout"], 20)
            self.assertFalse(call.kwargs.get("shell", False))

    def test_post_edit_filters_actual_skill_paths_and_keeps_failures_visible(self):
        request = {"hook_event_name": "PostToolUse", "tool_name": "Edit", "tool_input": {"file_path": str(ROOT / ".agents/skills/scout/SKILL.md")}}
        result = subprocess.CompletedProcess([], 1, "layout invalid", "")
        with patch.object(hook.subprocess, "run", return_value=result) as run:
            out = hook.handle(request)
            self.assertEqual(run.call_count, 2)
            self.assertIn("tests.test_layout.Skills", run.call_args_list[0].args[0])
            self.assertIn("FAIL", out["systemMessage"])
        for tool, file in (("Read", ".agents/skills/scout/SKILL.md"), ("Edit", "AGENTS.md"), ("Edit", "../outside/.agents/skills/x/SKILL.md")):
            with patch.object(hook.subprocess, "run") as run:
                self.assertEqual(hook.handle({**request, "tool_name": tool, "tool_input": {"file_path": str(ROOT / file)}}), {})
                run.assert_not_called()

    def test_sandbox_and_non_opted_in_project_are_quiet(self):
        request = {"hook_event_name": "SessionStart", "session_id": "foreign"}
        with patch.dict(os.environ, {"OMNIHARNESS_SANDBOX": "1"}), patch.object(hook.subprocess, "run") as run:
            self.assertEqual(hook.handle(request), {})
            run.assert_not_called()
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": tmp}), patch.object(hook.subprocess, "run") as run:
            self.assertEqual(hook.handle({**request, "cwd": tmp}), {})
            run.assert_not_called()

    def test_timeout_and_malformed_input_are_visible_without_retries(self):
        with patch.object(hook.subprocess, "run", side_effect=subprocess.TimeoutExpired("fixture", 20)) as run:
            out = hook.handle({"hook_event_name": "SessionStart"})
            self.assertEqual(run.call_count, 2)
            self.assertIn("FAIL", out["systemMessage"])
        proc = subprocess.run([sys.executable, str(ROOT / "harness/hooks/verify.py")], input="{broken", text=True, capture_output=True)
        self.assertEqual(proc.returncode, 0) # advisory hook; does not undo a successful edit
        self.assertIn("invalid", json.loads(proc.stdout)["systemMessage"])
