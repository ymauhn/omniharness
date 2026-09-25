"""Fail-closed Claude/container binding fixtures; no authenticated model calls."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from harness.claude_broker import PACKAGE_INIT, SOURCE_FILES
from harness.claude_worker_bridge import _verify_events, run_claude_worker_attempt


class FakeContainer:
    def __init__(self, root):
        self.worker = root / "worker"
        self.worker.mkdir()
        source = root / "source"
        source.mkdir()
        workers = root / "workers"
        workers.mkdir()
        self.worktrees = SimpleNamespace(source=source, workers=workers)
        self.record = {"path": str(self.worker), "run": "fixture", "task": "one"}
        self.root = root / "container-evidence"
        self.root.mkdir()
        self.docker = root / ("docker.exe" if sys.platform == "win32" else "docker")
        self.docker.write_text("fixture")
        self.image = "python@sha256:" + "a" * 64
        self.endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine"
        self.lifetime_seconds = 120
        self.commands = [{"number": 1, "state": "completed", "argv_sha256":
                          hashlib.sha256(json.dumps(["python", "-V"]).encode()).hexdigest(),
                          "exit_code": 0}]
        self.phase = "cancelled"
        self.started = []
        self.stopped = []

    def start(self, attempt_id):
        self.started.append(attempt_id)
        return {"phase": "running"}

    def cancel(self, attempt_id):
        self.stopped.append(attempt_id)
        return {"phase": self.phase, "commands": self.commands}


class ClaudeWorkerBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.worker = FakeContainer(self.base)
        self.process_root = self.base / "process-evidence"

    def attempt(self, *, init_tools=None, broker_events=True, usage=True,
                process_ok=True, tamper_stream=False, claude_tool_events=True,
                tool_name="mcp__omni_worker__worker_command", tool_result=True):
        def native(cli, prompt, **args):
            self.assertEqual(cli, sys.executable)
            self.assertEqual(prompt, "fixture task")
            self.assertEqual(args["cwd"], self.worker.worker)
            self.assertEqual(args["billing_channel"], "native-allowance")
            self.assertEqual(args["timeout"], 60)
            config = Path(args["restricted_mcp_config"])
            self.assertFalse(config.is_relative_to(self.worker.worker))
            mcp = json.loads(config.read_text())
            self.assertEqual(set(mcp["mcpServers"]), {"omni_worker"})
            server = mcp["mcpServers"]["omni_worker"]
            self.assertEqual(server["command"], sys.executable)
            binding_path = Path(server["args"][server["args"].index("--binding") + 1])
            binding = json.loads(binding_path.read_text())
            self.assertEqual(binding["attempt_id"], "one")
            self.assertEqual(binding["session_id"], args["session_id"])
            self.assertEqual(set(binding["source_sha256"]), set(SOURCE_FILES))
            code_root = Path(__file__).resolve().parent.parent
            for relative, digest in binding["source_sha256"].items():
                if relative == PACKAGE_INIT and digest is None:
                    self.assertFalse((code_root / relative).exists())
                else:
                    self.assertEqual(digest, hashlib.sha256((code_root / relative).read_bytes()).hexdigest())
            if broker_events:
                events = Path(binding["events_path"])
                stream = [{"event": "server_started", "attempt_id": "one",
                           "session_id": args["session_id"]}]
                if self.worker.commands:
                    stream.append({"event": "tool_completed", "number": 1,
                                   "attempt_id": "one", "session_id": args["session_id"],
                                   "command_number": 1,
                                   "argv_sha256": self.worker.commands[0]["argv_sha256"],
                                   "exit_code": 0})
                events.write_text("\n".join(json.dumps(event) for event in stream) + "\n")
            messages = [{"type": "system", "subtype": "init",
                                  "session_id": args["session_id"],
                                  "tools": init_tools if init_tools is not None else
                                           ["mcp__omni_worker__worker_command"],
                                  "mcp_servers": [{"name": "omni_worker", "status": "connected"}]}]
            if claude_tool_events:
                messages.append({"type": "assistant", "session_id": args["session_id"],
                                 "message": {"content": [{"type": "tool_use", "id": "tool-1",
                                                          "name": tool_name,
                                                          "input": {"argv": ["python", "-V"]}}]}})
                if tool_result:
                    messages.append({"type": "user", "session_id": args["session_id"],
                                     "message": {"content": [{"type": "tool_result",
                                                              "tool_use_id": "tool-1",
                                                              "content": "Python 3.12"}]}})
            stdout = ("\n".join(json.dumps(message) for message in messages) + "\n").encode()
            process_dir = self.process_root / "one"
            process_dir.mkdir(parents=True)
            (process_dir / "stdout.bin").write_bytes(stdout)
            return {"process": {"state": "finished" if process_ok else "unknown",
                                "process_ok": process_ok, "stdout_bytes": len(stdout),
                                "stdout_sha256": "bad" if tamper_stream else hashlib.sha256(stdout).hexdigest()},
                    "receipt": {"usage_complete": usage,
                                "session_id": args["session_id"],
                                "total_tokens": 19 if usage else None}}
        with patch("harness.claude_worker_bridge.run_claude_attempt", side_effect=native):
            return run_claude_worker_attempt(sys.executable, "fixture task",
                    container_worker=self.worker, process_evidence_root=self.process_root,
                    attempt_id="one", role="implementer", timeout=60)

    def test_one_bound_tool_call_and_complete_receipt(self):
        result = self.attempt()
        self.assertTrue(result["bridge_verified"])
        self.assertIsNone(result["task_pass"])
        self.assertEqual(result["broker"]["calls"], 1)
        self.assertEqual(result["claude_tools"]["calls"], 1)
        self.assertEqual(result["claude_tools"]["results"], 1)
        self.assertEqual(self.worker.started, ["one"])
        self.assertEqual(self.worker.stopped, ["one"])

    def test_hidden_host_tool_missing_event_or_unknown_usage_fails_closed(self):
        for options in ({"init_tools": ["mcp__omni_worker__worker_command", "Read"]},
                        {"broker_events": False}, {"usage": False},
                        {"process_ok": False}, {"tamper_stream": True}):
            with self.subTest(options=options):
                self.setUp()
                self.assertFalse(self.attempt(**options)["bridge_verified"])

    def test_missing_or_wrong_claude_tool_events_fail_closed(self):
        for options in ({"claude_tool_events": False}, {"tool_result": False},
                        {"tool_name": "Bash"}):
            with self.subTest(options=options):
                self.setUp()
                self.assertFalse(self.attempt(**options)["bridge_verified"])

    def test_broker_command_identity_mismatch_fails_closed(self):
        events = self.base / "events.jsonl"
        session = "expected-session"
        events.write_text("\n".join(json.dumps(event) for event in [
            {"event": "server_started", "attempt_id": "one", "session_id": session},
            {"event": "tool_completed", "attempt_id": "other", "session_id": "other-session",
             "number": 1, "command_number": 1,
             "argv_sha256": self.worker.commands[0]["argv_sha256"], "exit_code": 0}]) + "\n")
        result = _verify_events(events, attempt_id="one", session_id=session,
                                worker_state={"commands": self.worker.commands})
        self.assertFalse(result["verified"])

    def test_missing_worker_command_or_stop_refuses_bridge(self):
        self.worker.commands = []
        self.assertFalse(self.attempt()["bridge_verified"])
        self.setUp()
        self.worker.phase = "unknown"
        self.assertFalse(self.attempt()["bridge_verified"])

    def test_invalid_evidence_root_or_excess_timeout_precedes_worker_start(self):
        with self.assertRaises(ValueError):
            run_claude_worker_attempt(sys.executable, "task", container_worker=self.worker,
                process_evidence_root=self.worker.worker, attempt_id="blocked", role="reviewer", timeout=60)
        with self.assertRaises(ValueError):
            run_claude_worker_attempt(sys.executable, "task", container_worker=self.worker,
                process_evidence_root=self.process_root, attempt_id="blocked", role="reviewer", timeout=120)
        self.assertEqual(self.worker.started, [])

    def test_native_launch_exception_still_stops_exact_worker(self):
        with patch("harness.claude_worker_bridge.run_claude_attempt",
                   side_effect=RuntimeError("fixture launch failed")):
            with self.assertRaises(RuntimeError):
                run_claude_worker_attempt(sys.executable, "fixture task",
                    container_worker=self.worker, process_evidence_root=self.process_root,
                    attempt_id="one", role="implementer", timeout=60)
        self.assertEqual(self.worker.started, ["one"])
        self.assertEqual(self.worker.stopped, ["one"])

    def test_native_failure_and_unconfirmed_stop_are_both_reported(self):
        def fail_cancel(attempt_id):
            raise RuntimeError("STOP UNCONFIRMED")
        with patch("harness.claude_worker_bridge.run_claude_attempt",
                   side_effect=RuntimeError("NATIVE FAILED")), \
             patch.object(self.worker, "cancel", side_effect=fail_cancel):
            with self.assertRaises(BaseExceptionGroup) as caught:
                run_claude_worker_attempt(sys.executable, "fixture task",
                    container_worker=self.worker, process_evidence_root=self.process_root,
                    attempt_id="one", role="implementer", timeout=60)
        self.assertEqual([str(item) for item in caught.exception.exceptions],
                         ["NATIVE FAILED", "STOP UNCONFIRMED"])

    def test_native_failure_and_unknown_stop_phase_are_both_reported(self):
        self.worker.phase = "unknown"
        with patch("harness.claude_worker_bridge.run_claude_attempt",
                   side_effect=RuntimeError("NATIVE FAILED")):
            with self.assertRaises(BaseExceptionGroup) as caught:
                run_claude_worker_attempt(sys.executable, "fixture task",
                    container_worker=self.worker, process_evidence_root=self.process_root,
                    attempt_id="one", role="implementer", timeout=60)
        self.assertIn("exact worker stop unconfirmed", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
