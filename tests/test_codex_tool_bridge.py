"""Model-free App Server dynamic-tool bridge contract tests."""

import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from harness.codex_tool_bridge import (
    TOOL_NAME, CodexToolBridge, dynamic_tool_spec, initialize_request,
    probe_app_server, validate_app_server_initialize,
)


class Worker:
    def __init__(self):
        self.calls = []
        self.cancels = []
        self.failure = False

    def execute(self, attempt, argv, *, timeout):
        self.calls.append((attempt, argv, timeout))
        if self.failure:
            raise RuntimeError("private worker detail")
        return {"exit_code": 0 if argv[0] == "python" else 7,
                "stdout": b"hello\n", "stderr": b"", "number": len(self.calls),
                "task_pass": None}

    def cancel(self, attempt):
        self.cancels.append(attempt)
        return {"phase": "cancelled"}


def initialize_result():
    return {"userAgent": "codex", "codexHome": "C:/codex-home",
            "platformFamily": "windows", "platformOs": "windows"}


def call(*, call_id="call_1", thread="thread_1", turn="turn_1", tool=TOOL_NAME,
         namespace=None, arguments=None):
    return {"id": 5, "method": "item/tool/call",
            "params": {"threadId": thread, "turnId": turn, "callId": call_id,
                       "tool": tool, "namespace": namespace,
                       "arguments": arguments or {"argv": ["python", "-V"], "timeoutSeconds": 10}}}


class CodexToolBridgeTests(unittest.TestCase):
    def setUp(self):
        self.worker = Worker()
        self.bridge = CodexToolBridge(self.worker, attempt_id="attempt_1",
                                      thread_id="thread_1", turn_id="turn_1")

    def test_schema_and_handshake_advertise_one_bounded_tool_without_admitting_turn(self):
        spec = dynamic_tool_spec()
        self.assertEqual(spec["name"], TOOL_NAME)
        self.assertEqual(spec["type"], "function")
        self.assertEqual(spec["inputSchema"]["additionalProperties"], False)
        self.assertEqual(initialize_request()["params"]["capabilities"], {"experimentalApi": True})
        self.assertNotIn("jsonrpc", initialize_request())
        self.assertFalse(self.bridge.turn_admission["admitted"])
        self.assertFalse(self.bridge.observation()["host_tool_isolation_certified"])

    def test_one_bound_tool_call_runs_inside_worker_and_never_approves_task(self):
        response = self.bridge.handle_tool_call(call())
        self.assertEqual(self.worker.calls, [("attempt_1", ["python", "-V"], 10)])
        self.assertEqual(response["id"], 5)
        self.assertNotIn("jsonrpc", response)
        self.assertTrue(response["result"]["success"])
        output = json.loads(response["result"]["contentItems"][0]["text"])
        self.assertEqual(output["worker_command"], 1)
        self.assertIsNone(output["task_pass"])
        self.assertEqual(len(self.bridge.observation()["worker_tool_calls"]), 1)
        self.assertFalse(self.bridge.handle_tool_call(call())["result"]["success"])
        self.assertEqual(len(self.worker.calls), 1)

    def test_nonzero_exit_is_tool_failure_without_task_pass(self):
        response = self.bridge.handle_tool_call(call(arguments={"argv": ["false"], "timeoutSeconds": 1}))
        self.assertFalse(response["result"]["success"])
        output = json.loads(response["result"]["contentItems"][0]["text"])
        self.assertEqual(output["exit_code"], 7)
        self.assertIsNone(output["task_pass"])

    def test_foreign_id_unknown_tool_and_malformed_arguments_never_dispatch(self):
        invalid = [call(thread="other"), call(turn="other"), call(tool="shell"),
                   call(namespace="functions"),
                   call(arguments={"argv": ["python"], "timeoutSeconds": 1, "extra": True}),
                   call(arguments={"argv": ["python"], "timeoutSeconds": True}),
                   call(arguments={"argv": ["python", "bad\0arg"], "timeoutSeconds": 1})]
        missing_namespace = call()
        del missing_namespace["params"]["namespace"]
        invalid.append(missing_namespace)
        for number, request in enumerate(invalid):
            with self.subTest(number=number):
                request["params"]["callId"] = f"call_{number}"
                self.assertFalse(self.bridge.handle_tool_call(request)["result"]["success"])
        self.assertEqual(self.worker.calls, [])

    def test_worker_failure_is_redacted_and_cancellation_targets_exact_attempt(self):
        self.worker.failure = True
        response = self.bridge.handle_tool_call(call())
        self.assertFalse(response["result"]["success"])
        self.assertNotIn("private worker detail", json.dumps(response))
        self.assertEqual(self.bridge.cancel_worker(), {"phase": "cancelled"})
        self.assertEqual(self.worker.cancels, ["attempt_1"])

    def test_observed_host_tool_forces_unverified_record_and_interrupt_request(self):
        self.bridge.observe_notification({"method": "item/started",
                                          "params": {"threadId": "thread_1", "turnId": "turn_1",
                                                     "item": {"type": "commandExecution"}}})
        obs = self.bridge.observation()
        self.assertEqual(obs["unsafe_native_events"],
                         [{"method": "item/started", "type": "commandExecution"}])
        self.assertFalse(obs["host_tool_isolation_certified"])
        self.assertEqual(self.bridge.interrupt_request()["params"],
                         {"threadId": "thread_1", "turnId": "turn_1"})
        self.assertNotIn("jsonrpc", self.bridge.interrupt_request())

    def test_foreign_dynamic_and_function_output_events_are_never_classed_safe(self):
        items = [
            {"type": "dynamicToolCall", "id": "item_1", "tool": "foreign_tool",
             "namespace": None},
            {"type": "dynamicToolCall", "id": "item_2", "tool": TOOL_NAME,
             "namespace": "foreign"},
            {"type": "dynamicToolCall", "id": "item_3", "namespace": None},
            {"type": "dynamicToolCall", "id": "item_5", "tool": TOOL_NAME},
            {"type": "functionCallOutput", "id": "item_4", "name": "host_shell",
             "namespace": None},
        ]
        for item in items:
            self.bridge.observe_notification({"method": "item/started", "params": {
                "threadId": "thread_1", "turnId": "turn_1", "item": item}})
        unsafe = self.bridge.observation()["unsafe_native_events"]
        self.assertEqual([event["type"] for event in unsafe],
                         [item["type"] for item in items])
        self.assertEqual(unsafe[0]["tool"], "foreign_tool")
        self.assertEqual(unsafe[-1]["name"], "host_shell")
        self.assertFalse(self.bridge.turn_admission["admitted"])

    def test_exact_worker_dynamic_event_is_observed_without_claiming_isolation(self):
        self.bridge.observe_notification({"method": "item/started", "params": {
            "threadId": "thread_1", "turnId": "turn_1",
            "item": {"type": "dynamicToolCall", "id": "item_1", "tool": TOOL_NAME,
                     "namespace": None}}})
        self.assertEqual(self.bridge.observation()["unsafe_native_events"], [])
        self.assertFalse(self.bridge.observation()["host_tool_isolation_certified"])

    def test_handshake_parser_rejects_error_duplicate_and_non_json(self):
        good = json.dumps({"id": 1, "result": initialize_result()}).encode()
        self.assertTrue(validate_app_server_initialize(good)["app_server_handshake"])
        self.assertFalse(validate_app_server_initialize(good)["exclusive_tool_inventory_verified"])
        for bad in (b"", b"not json", b'{"id":1,"id":1,"result":{}}',
                    b'{"id":1}', b'{"id":1,"result":{}}',
                    b'{"jsonrpc":"1.0","id":1,"result":{}}',
                    b'{"id":1,"error":{"code":-1}}', good + b"\n" + good):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    validate_app_server_initialize(bad)

    def test_model_free_probe_uses_stdio_and_never_sends_thread_start(self):
        class CapturedInput(io.BytesIO):
            def close(self):
                self.sent = self.getvalue()
                super().close()

        class FakeProcess:
            def __init__(self):
                self.stdin = CapturedInput()
                self.stdout = io.BytesIO(
                    (json.dumps({"id": 1, "result": initialize_result()}) + "\n").encode())

            def wait(self, timeout=None):
                return 0

        process = FakeProcess()
        with patch("harness.codex_tool_bridge.subprocess.Popen", return_value=process) as launch:
            with patch("harness.codex_tool_bridge.Path.is_file", return_value=True):
                result = probe_app_server("C:/codex.exe")
        self.assertTrue(result["app_server_handshake"])
        self.assertEqual(launch.call_args.args[0], [str(Path("C:/codex.exe")), "app-server", "--stdio"])
        sent = process.stdin.sent
        self.assertEqual(json.loads(sent), initialize_request())
        self.assertNotIn(b"thread/start", sent)
        self.assertNotIn(b"turn/start", sent)

    def test_model_free_probe_fails_cleanly_when_server_closes_early(self):
        class BrokenInput:
            def write(self, _):
                raise BrokenPipeError("server exited")

            def close(self):
                pass

        class EarlyProcess:
            stdin = BrokenInput()
            stdout = io.BytesIO()

            def wait(self, timeout=None):
                return 1

        with patch("harness.codex_tool_bridge.subprocess.Popen", return_value=EarlyProcess()):
            with patch("harness.codex_tool_bridge.Path.is_file", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "did not complete"):
                    probe_app_server("C:/codex.exe")


if __name__ == "__main__":
    unittest.main()
