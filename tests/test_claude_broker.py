"""Offline MCP protocol and worker-dispatch checks; no model or Docker call."""
import hashlib
import io
import json
import os
import py_compile
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from harness.claude_broker import (PACKAGE_INIT, SOURCE_FILES, Broker, broker_bootstrap, main,
                                   serve, source_hashes)


class FakeWorker:
    def __init__(self):
        self.calls = []
        self.fail = False

    def execute(self, attempt_id, argv, *, timeout):
        self.calls.append((attempt_id, argv, timeout))
        if self.fail:
            raise RuntimeError("simulated worker uncertainty")
        return {"number": len(self.calls), "exit_code": 0,
                "stdout": b"from container\n", "stderr": b"", "task_pass": None}


class ClaudeBrokerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.worker = FakeWorker()
        self.events = Path(self.temp.name) / "events.jsonl"
        self.broker = Broker(self.worker, attempt_id="attempt_1", session_id="session_1",
                             events_path=self.events)

    def request(self, method, params=None, request_id=1):
        value = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            value["params"] = params
        return self.broker.handle(value)

    def initialize(self):
        self.request("initialize", {"protocolVersion": "2025-06-18",
                                    "clientInfo": {"name": "fixture", "version": "1"}})
        self.request("notifications/initialized", request_id=None)

    def test_one_tool_only_dispatches_bounded_argv_into_fixed_attempt(self):
        self.initialize()
        tools = self.request("tools/list")["result"]["tools"]
        self.assertEqual([tool["name"] for tool in tools], ["worker_command"])
        response = self.request("tools/call", {"name": "worker_command",
                                               "arguments": {"argv": ["python", "-V"],
                                                             "timeout_seconds": 5}})
        self.assertFalse(response["result"]["isError"])
        self.assertEqual(self.worker.calls, [("attempt_1", ["python", "-V"], 5)])
        result = json.loads(response["result"]["content"][0]["text"])
        self.assertEqual(result["exit_code"], 0)
        self.assertIsNone(result["task_pass"])
        events = [json.loads(line) for line in self.events.read_text().splitlines()]
        self.assertEqual([item["event"] for item in events], ["server_started", "tool_completed"])
        self.assertEqual(events[1]["command_number"], 1)

    def test_unknown_method_tool_or_host_controls_never_dispatch(self):
        with self.assertRaises(ValueError):
            self.request("tools/list")
        self.initialize()
        self.assertEqual(self.request("resources/list")["error"]["code"], -32601)
        for args in ({"name": "host_shell", "arguments": {"argv": ["whoami"]}},
                     {"name": "worker_command", "arguments": {"argv": ["python", "-V"],
                                                                 "cwd": "C:/Users"}},
                     {"name": "worker_command", "arguments": {"argv": ["python", "-V"],
                                                                 "timeout_seconds": True}},
                     {"name": "worker_command", "arguments": {"argv": []}}):
            with self.subTest(args=args):
                self.assertTrue(self.request("tools/call", args)["result"]["isError"])
        self.assertIsNone(self.request("tools/call", {"name": "worker_command",
                                                       "arguments": {"argv": ["python", "-V"]}},
                                       request_id=None))
        self.assertEqual(self.worker.calls, [])

    def test_worker_failure_is_reported_not_retried(self):
        self.initialize()
        self.worker.fail = True
        result = self.request("tools/call", {"name": "worker_command",
                                                  "arguments": {"argv": ["python", "-V"]}})
        self.assertTrue(result["result"]["isError"])
        self.assertEqual(len(self.worker.calls), 1)
        events = [json.loads(line) for line in self.events.read_text().splitlines()]
        self.assertEqual(events[-1]["event"], "tool_failed")

    def test_stdio_handshake_and_duplicate_json_reject(self):
        request = (b'{"jsonrpc":"2.0","id":1,"method":"initialize",'
                   b'"params":{"protocolVersion":"2025-06-18"}}\n'
                   b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n'
                   b'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'
                   b'{"jsonrpc":"2.0","id":3,"id":4,"method":"tools/call"}\n')
        output = io.BytesIO()
        serve(self.broker, io.BytesIO(request), output)
        responses = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(responses), 3)
        self.assertEqual(responses[1]["result"]["tools"][0]["name"], "worker_command")
        self.assertEqual(responses[2]["error"]["code"], -32600)
        self.assertEqual(self.worker.calls, [])

    def test_source_tampering_or_missing_file_blocks_broker_before_service(self):
        root = Path(self.temp.name) / "checkout"
        for relative in SOURCE_FILES:
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# pinned fixture: " + relative + "\n", encoding="utf-8")
        pins = source_hashes(root)
        binding = root / "binding.json"
        binding.write_text(json.dumps({"schema_version": 1, "source_sha256": pins}), encoding="utf-8")
        digest = hashlib.sha256(binding.read_bytes()).hexdigest()
        changed = root / "harness/container_worker.py"
        for mutation in ("different", "missing"):
            with self.subTest(mutation=mutation):
                changed.write_text("# pinned fixture: harness/container_worker.py\n", encoding="utf-8")
                if mutation == "different":
                    changed.write_text("# changed worker code\n", encoding="utf-8")
                else:
                    changed.unlink()
                with patch("harness.claude_broker.__file__", str(root / "harness/claude_broker.py")), \
                     patch("harness.claude_broker.Worktrees") as worktrees, \
                     patch("harness.claude_broker.serve") as service:
                    with self.assertRaisesRegex(ValueError, "broker executable source"):
                        main(["--binding", str(binding), "--sha256", digest])
                    worktrees.assert_not_called()
                    service.assert_not_called()
                code = broker_bootstrap(root, binding, digest, pins)
                child = subprocess.run([sys.executable, "-I", "-u", "-c", code,
                                        "--binding", str(binding), "--sha256", digest],
                                       capture_output=True, text=True, check=False)
                self.assertNotEqual(child.returncode, 0)
                self.assertIn("broker executable source missing or changed", child.stderr)

    def test_created_package_initializer_cannot_execute_before_broker_check(self):
        root = Path(self.temp.name) / "checkout"
        for relative in SOURCE_FILES:
            if relative == PACKAGE_INIT:
                continue
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# pinned fixture: " + relative + "\n", encoding="utf-8")
        pins = source_hashes(root)
        self.assertIsNone(pins[PACKAGE_INIT])
        binding = root / "binding.json"
        binding.write_text(json.dumps({"schema_version": 1, "source_sha256": pins}), encoding="utf-8")
        digest = hashlib.sha256(binding.read_bytes()).hexdigest()
        marker = root / "initializer-executed"
        (root / PACKAGE_INIT).write_text(
            f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')\n", encoding="utf-8")
        code = broker_bootstrap(root, binding, digest, pins)
        child = subprocess.run([sys.executable, "-I", "-u", "-c", code,
                                "--binding", str(binding), "--sha256", digest],
                               capture_output=True, text=True, check=False)
        self.assertNotEqual(child.returncode, 0)
        self.assertIn("broker package initializer appeared", child.stderr)
        self.assertFalse(marker.exists())

    def test_timestamp_valid_malicious_pyc_is_ignored_for_pinned_source(self):
        root = Path(self.temp.name) / "checkout"
        project = Path(__file__).resolve().parent.parent
        for relative in SOURCE_FILES:
            source = project / relative
            if source.is_file():
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
        worker = root / "harness/container_worker.py"
        original = worker.read_bytes()
        marker = root / "malicious-cache-executed"
        malicious = ("from pathlib import Path\n"
                     f"Path({str(marker)!r}).write_text('executed')\n"
                     "class ContainerWorker: pass\n").encode()
        self.assertLess(len(malicious), len(original))
        stamp = int(time.time()) - 10
        worker.write_bytes(malicious + b"#" * (len(original) - len(malicious)))
        os.utime(worker, (stamp, stamp))
        py_compile.compile(str(worker), doraise=True,
                           invalidation_mode=py_compile.PycInvalidationMode.TIMESTAMP)
        worker.write_bytes(original)
        os.utime(worker, (stamp, stamp))
        unsafe = ("import sys, types; "
                  f"p=types.ModuleType('harness'); p.__path__=[{str(root / 'harness')!r}]; "
                  "sys.modules['harness']=p; from harness.container_worker import ContainerWorker")
        child = subprocess.run([sys.executable, "-I", "-c", unsafe],
                               capture_output=True, text=True, check=False)
        self.assertEqual(child.returncode, 0, child.stderr)
        self.assertTrue(marker.is_file())  # prove the planted cache was executable
        marker.unlink()
        pins = source_hashes(root)
        binding = root / "binding.json"
        binding.write_text(json.dumps({"schema_version": 1, "source_sha256": pins}), encoding="utf-8")
        digest = hashlib.sha256(binding.read_bytes()).hexdigest()
        code = broker_bootstrap(root, binding, digest, pins)
        child = subprocess.run([sys.executable, "-I", "-u", "-c", code,
                                "--binding", str(binding), "--sha256", digest],
                               capture_output=True, text=True, check=False)
        self.assertNotEqual(child.returncode, 0)
        self.assertIn("KeyError: 'source'", child.stderr)  # source modules loaded; fixture has no worker binding
        self.assertFalse(marker.exists())
        self.assertFalse(list(root.glob("_broker_pycache_*")))

    def test_old_binding_without_source_pins_is_rejected(self):
        binding = Path(self.temp.name) / "binding.json"
        binding.write_text('{"schema_version":1}', encoding="utf-8")
        digest = hashlib.sha256(binding.read_bytes()).hexdigest()
        with patch("harness.claude_broker.Worktrees") as worktrees:
            with self.assertRaisesRegex(ValueError, "source pins missing"):
                main(["--binding", str(binding), "--sha256", digest])
            worktrees.assert_not_called()


if __name__ == "__main__":
    unittest.main()
