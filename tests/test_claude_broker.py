"""Offline MCP protocol and worker-dispatch checks; no model or Docker call."""
import io
import json
import tempfile
import unittest
from pathlib import Path

from harness.claude_broker import Broker, serve


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


if __name__ == "__main__":
    unittest.main()
