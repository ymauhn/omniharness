"""Offline process-boundary checks: no agent or model is launched."""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from harness import native_process
from harness.native_process import recover_attempt, run_attempt


class NativeProcessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.worker = self.base / "worker"
        self.worker.mkdir()
        self.evidence = self.base / "evidence"

    def run_python(self, code, attempt="one", **options):
        return run_attempt(
            [sys.executable, "-u", "-c", code], cwd=self.worker,
            evidence_root=self.evidence, attempt_id=attempt,
            env=options.pop("env", dict(os.environ)), **options,
        )

    def test_success_captures_separate_streams_without_command_or_env(self):
        result = self.run_python(
            "import sys; print(sys.stdin.read()); print('warning', file=sys.stderr)",
            input_bytes=b"private prompt", identity={"provider": "fixture", "session_id": "session_1"},
        )
        self.assertEqual(result["state"], "finished")
        self.assertEqual(result["exit_code"], 0)
        self.assertTrue(result["process_ok"])
        self.assertEqual(result["identity"]["session_id"], "session_1")
        attempt = self.evidence / "one"
        self.assertEqual((attempt / "stdout.bin").read_bytes(), b"private prompt\r\n" if os.name == "nt" else b"private prompt\n")
        self.assertIn(b"warning", (attempt / "stderr.bin").read_bytes())
        manifest = (attempt / "state.json").read_text(encoding="utf-8")
        self.assertNotIn("private prompt", manifest)
        self.assertNotIn("-c", manifest)
        self.assertEqual(recover_attempt(self.evidence, "one"), result)

    def test_nonzero_or_empty_output_is_not_process_success(self):
        result = self.run_python("import sys; sys.exit(7)")
        self.assertEqual(result["state"], "finished")
        self.assertEqual(result["exit_code"], 7)
        self.assertFalse(result["process_ok"])
        self.assertEqual(result["stdout_bytes"], 0)

    def test_explicit_environment_does_not_inherit_parent_sentinel(self):
        name = "OMNIHARNESS_PRIVATE_SENTINEL"
        previous = os.environ.get(name)
        os.environ[name] = "must-not-reach-child"
        try:
            env = dict(os.environ)
            env.pop(name)
            result = self.run_python(
                f"import os; print(os.environ.get('{name}', 'absent'))", env=env,
            )
        finally:
            if previous is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = previous
        self.assertTrue(result["process_ok"])
        self.assertEqual((self.evidence / "one" / "stdout.bin").read_text().strip(), "absent")

    def test_launch_failure_has_evidence_and_unknown_usage(self):
        with patch.object(native_process.subprocess, "Popen", side_effect=OSError("fixture launch failure")):
            result = run_attempt([sys.executable], cwd=self.worker, evidence_root=self.evidence,
                                 attempt_id="failed", env=dict(os.environ))
        self.assertEqual(result["state"], "launch_failed")
        self.assertIsNone(result["usage_tokens"])
        self.assertFalse(result["process_ok"])
        self.assertTrue((self.evidence / "failed" / "state.json").is_file())

    def test_manifest_write_failure_after_spawn_stops_the_process(self):
        marker = self.base / "orphan-wrote.txt"
        real_write = native_process._write_state
        def fail_on_running(path, state):
            if state["state"] == "running":
                raise OSError("fixture persistence failure")
            return real_write(path, state)
        with patch.object(native_process, "_write_state", side_effect=fail_on_running):
            with self.assertRaises(OSError):
                self.run_python(f"import time; from pathlib import Path; time.sleep(0.7); Path({str(marker)!r}).write_text('orphan')")
        time.sleep(0.8)
        self.assertFalse(marker.exists(), "process continued after coordinator persistence failed")
        self.assertEqual(recover_attempt(self.evidence, "one")["state"], "unknown")

    def test_timeout_and_explicit_cancel_leave_unknown_usage(self):
        timed = self.run_python("import time; time.sleep(30)", timeout=0.2)
        self.assertIn(timed["state"], {"interrupted", "unknown"})
        if timed["state"] == "unknown":
            self.assertTrue(timed["issues"])
        self.assertEqual(timed["termination"], "timeout")
        self.assertFalse(timed["process_ok"])
        self.assertIsNone(timed["usage_tokens"])
        flag = threading.Event()
        threading.Timer(0.2, flag.set).start()
        cancelled = self.run_python("import time; time.sleep(30)", attempt="two", cancel_event=flag)
        self.assertIn(cancelled["state"], {"interrupted", "unknown"})
        if cancelled["state"] == "unknown":
            self.assertTrue(cancelled["issues"])
        self.assertEqual(cancelled["termination"], "cancel")
        self.assertIsNone(cancelled["usage_tokens"])

    def test_timeout_stops_a_spawned_child_before_it_writes(self):
        marker = self.base / "child-survived.txt"
        child = f"import time; from pathlib import Path; time.sleep(1); Path({str(marker)!r}).write_text('survived')"
        parent = ("import subprocess, sys, time; "
                  f"subprocess.Popen([sys.executable, '-c', {child!r}]); "
                  "print('spawned', flush=True); time.sleep(30)")
        result = self.run_python(parent, timeout=0.4)
        self.assertEqual(result["termination"], "timeout")
        self.assertIn(b"spawned", (self.evidence / "one" / "stdout.bin").read_bytes())
        time.sleep(1.2)
        if marker.exists():
            self.assertEqual(result["state"], "unknown", result)
            self.assertTrue(result["issues"], result)
        else:
            self.assertEqual(result["state"], "interrupted", result)

    def test_recovery_marks_inflight_unknown_without_relaunch(self):
        attempt = self.evidence / "old"
        attempt.mkdir(parents=True)
        (attempt / "state.json").write_text(json.dumps({"schema_version": 1, "attempt_id": "old", "state": "running", "pid": 999999}), encoding="utf-8")
        state = recover_attempt(self.evidence, "old")
        self.assertEqual(state["state"], "unknown")
        self.assertFalse(state["process_ok"])
        self.assertIsNone(state["usage_tokens"])
        self.assertIn("orphan", state["issues"][0])
        self.assertEqual(recover_attempt(self.evidence, "old"), state)
        with self.assertRaises(FileExistsError):
            self.run_python("print('must not run')", attempt="old")

    def test_recovery_after_partial_state_write_keeps_orphan_unknown(self):
        attempt = self.evidence / "partial"
        attempt.mkdir(parents=True)
        (attempt / "state.json.stale.tmp").write_text("{", encoding="utf-8")
        result = recover_attempt(self.evidence, "partial")
        self.assertEqual(result["state"], "unknown")
        self.assertIsNone(result["usage_tokens"])
        self.assertTrue((attempt / "state.json.stale.tmp").exists())

    def test_non_object_manifest_is_rejected_without_relaunch(self):
        attempt = self.evidence / "corrupt"
        attempt.mkdir(parents=True)
        (attempt / "state.json").write_text("[]", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "manifest must be a JSON object"):
            recover_attempt(self.evidence, "corrupt")

    def test_rejects_path_escape_and_worker_owned_evidence(self):
        with self.assertRaises(ValueError):
            self.run_python("print('no')", attempt="../escape")
        with self.assertRaises(ValueError):
            run_attempt([sys.executable], cwd=self.worker, evidence_root=self.worker / "evidence",
                        attempt_id="unsafe", env=dict(os.environ))
        if os.name == "nt":
            shim = self.base / "fake.cmd"
            shim.write_text("echo unsafe", encoding="utf-8")
            with self.assertRaises(ValueError):
                run_attempt([str(shim)], cwd=self.worker, evidence_root=self.evidence,
                            attempt_id="batch", env=dict(os.environ))


if __name__ == "__main__":
    unittest.main()
