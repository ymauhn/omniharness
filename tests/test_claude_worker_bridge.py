"""Fail-closed Claude/container binding fixtures; no authenticated model calls."""
import hashlib
import json
import subprocess
import sys
import tempfile
import time
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from harness.claude_broker import PACKAGE_INIT, SOURCE_FILES
from harness.claude_worker_bridge import (
    _verify_events, cancel_prepared_claude_worker_attempt,
    prepare_claude_worker_attempt, run_claude_worker_attempt,
    run_prepared_claude_worker_attempt,
)


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
        self.container_removed = True
        self.started = []
        self.stopped = []
        self.state = None

    def start(self, attempt_id):
        self.started.append(attempt_id)
        self.state = {"attempt_id": attempt_id, "phase": "running", "cid": "b" * 64,
                      "nonce": "c" * 32, "name": "omni-worker-" + "c" * 32,
                      "deadline_unix": time.time() + self.lifetime_seconds}
        return dict(self.state)

    def _load(self, attempt_id):
        if self.state is None or self.state["attempt_id"] != attempt_id:
            raise ValueError("missing fake worker state")
        return dict(self.state), self.root / "empty-docker-config", self.root / "state.json"

    def _audit(self):
        return None

    def _inspect(self, config, state, *, running):
        if not running or state != self.state:
            raise ValueError("fake worker identity changed")

    def cancel(self, attempt_id):
        self.stopped.append(attempt_id)
        if self.state["phase"] == "cancelled":
            return {**self.state, "commands": self.commands}
        self.state["phase"] = self.phase
        self.state["container_removed"] = self.container_removed
        return {**self.state, "commands": self.commands}


class ClaudeWorkerBridgeTests(unittest.TestCase):
    def setUp(self):
        # Canonical: the harness works on resolved paths, and TEMP may be an 8.3 or junction spelling of one.
        self.temp = tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.worker = FakeContainer(self.base)
        self.process_root = self.base / "process-evidence"

    def prepare(self):
        return prepare_claude_worker_attempt(
            container_worker=self.worker, process_evidence_root=self.process_root,
            attempt_id="one", role="implementer", timeout=60)

    def attempt(self, *, prepared=None, init_tools=None, broker_events=True, usage=True,
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
            args = {"container_worker": self.worker,
                    "process_evidence_root": self.process_root,
                    "attempt_id": "one", "role": "implementer", "timeout": 60}
            if prepared is not None:
                return run_prepared_claude_worker_attempt(
                    prepared, sys.executable, "fixture task", **args)
            return run_claude_worker_attempt(sys.executable, "fixture task", **args)

    def test_prepare_pins_exact_worker_before_model_launch(self):
        with patch("harness.claude_worker_bridge.run_claude_attempt") as native:
            prepared = self.prepare()
        native.assert_not_called()
        self.assertEqual(self.worker.started, ["one"])
        self.assertEqual(self.worker.stopped, [])
        self.assertEqual(prepared.cid, "b" * 64)
        self.assertEqual(prepared.nonce, "c" * 32)
        binding = json.loads(prepared.binding_path.read_text())
        self.assertEqual((binding["attempt_id"], binding["session_id"],
                          binding["cid"], binding["nonce"]),
                         ("one", prepared.session_id, prepared.cid, prepared.nonce))
        self.assertEqual(prepared.mcp_config_path.parent, prepared.binding_path.parent)
        with self.assertRaises(FrozenInstanceError):
            prepared.cid = "d" * 64
        stopped = cancel_prepared_claude_worker_attempt(prepared)
        self.assertEqual(stopped["phase"], "cancelled")
        self.assertEqual(self.worker.stopped, ["one"])

    def test_prepared_worker_runs_once_with_pinned_session(self):
        prepared = self.prepare()
        result = self.attempt(prepared=prepared)
        self.assertTrue(result["bridge_verified"])
        self.assertEqual(self.worker.started, ["one"])
        self.assertEqual(self.worker.stopped, ["one"])
        with self.assertRaisesRegex(ValueError, "already used"):
            self.attempt(prepared=prepared)
        self.assertEqual(self.worker.stopped, ["one"])

    def test_misbound_or_stale_preparation_cancels_owned_worker(self):
        for changed in ("attempt_id", "worker", "record", "deadline", "mcp"):
            with self.subTest(changed=changed):
                self.setUp()
                prepared = self.prepare()
                args = {"container_worker": self.worker,
                        "process_evidence_root": self.process_root,
                        "attempt_id": "one", "role": "implementer", "timeout": 60}
                if changed == "attempt_id":
                    args["attempt_id"] = "other"
                elif changed == "worker":
                    other_root = self.base / "other"
                    other_root.mkdir()
                    args["container_worker"] = FakeContainer(other_root)
                elif changed == "record":
                    self.worker.record["task"] = "other"
                elif changed == "deadline":
                    self.worker.state["deadline_unix"] = time.time() + 1
                else:
                    prepared.mcp_config_path.write_text("{}")
                with patch("harness.claude_worker_bridge.run_claude_attempt") as native:
                    with self.assertRaises(ValueError):
                        run_prepared_claude_worker_attempt(
                            prepared, sys.executable, "fixture task", **args)
                native.assert_not_called()
                self.assertEqual(self.worker.stopped, ["one"])

    def test_changed_durable_cid_never_stops_a_different_container(self):
        prepared = self.prepare()
        self.worker.state["cid"] = "d" * 64
        with patch("harness.claude_worker_bridge.run_claude_attempt") as native:
            with self.assertRaises(BaseExceptionGroup) as caught:
                run_prepared_claude_worker_attempt(
                    prepared, sys.executable, "fixture task", container_worker=self.worker,
                    process_evidence_root=self.process_root, attempt_id="one",
                    role="implementer", timeout=60)
        native.assert_not_called()
        self.assertIn("stop unconfirmed", str(caught.exception))
        self.assertEqual(self.worker.stopped, [])

    def test_prepare_refuses_changed_durable_identity_without_wrong_stop(self):
        original_load = self.worker._load

        def changed_load(attempt_id):
            state, config, path = original_load(attempt_id)
            state["cid"] = "d" * 64
            return state, config, path

        with patch.object(self.worker, "_load", side_effect=changed_load):
            with self.assertRaises(BaseExceptionGroup) as caught:
                self.prepare()
        self.assertIn("stop unconfirmed", str(caught.exception))
        self.assertEqual(self.worker.started, ["one"])
        self.assertEqual(self.worker.stopped, [])

    def test_prepared_stop_unknown_is_not_reported_as_cancelled(self):
        prepared = self.prepare()
        self.worker.phase = "unknown"
        stopped = cancel_prepared_claude_worker_attempt(prepared)
        self.assertEqual(stopped["phase"], "unknown")
        self.assertEqual(self.worker.stopped, ["one"])

    def test_pre_marked_cancelled_without_removal_is_unconfirmed(self):
        prepared = self.prepare()
        self.worker.state["phase"] = "cancelled"
        with self.assertRaisesRegex(RuntimeError, "exact worker stop unconfirmed"):
            cancel_prepared_claude_worker_attempt(prepared)
        self.assertEqual(self.worker.stopped, ["one"])

    def test_prepared_timeout_stops_exact_worker(self):
        prepared = self.prepare()
        with patch("harness.claude_worker_bridge.run_claude_attempt",
                   side_effect=subprocess.TimeoutExpired(["claude"], 60)):
            with self.assertRaises(subprocess.TimeoutExpired):
                run_prepared_claude_worker_attempt(
                    prepared, sys.executable, "fixture task", container_worker=self.worker,
                    process_evidence_root=self.process_root, attempt_id="one",
                    role="implementer", timeout=60)
        self.assertEqual(self.worker.stopped, ["one"])

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
