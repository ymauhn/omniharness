"""Adversarial checks for the model-free real-MCP canary's acceptance gate."""
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from harness.claude_broker_probe import (_broker_process, _mcp_input, _parse_mcp_output,
                                         _preserve_fixture, _tool_result)


def responses():
    return [
        {"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-06-18"}},
        {"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "worker_command"}]}},
        {"jsonrpc": "2.0", "id": 3, "result": {"content": [{"type": "text", "text":
            json.dumps({"exit_code": 0, "stdout": "{}", "stderr": "", "task_pass": None})}],
            "isError": False}},
        {"jsonrpc": "2.0", "id": 4, "result": {"content": [{"type": "text", "text": "rejected"}],
                                               "isError": True}},
    ]


def stream(values):
    return ("\n".join(json.dumps(value) for value in values) + "\n").encode()


class ClaudeBrokerProbeTests(unittest.TestCase):
    def test_full_sequence_and_explicit_task_nonapproval(self):
        parsed = _parse_mcp_output(stream(responses()))
        self.assertEqual(len(parsed), 4)
        result = _tool_result(parsed[2])
        self.assertEqual(result["exit_code"], 0)
        self.assertIn("task_pass", result)
        self.assertIsNone(result["task_pass"])
        self.assertTrue(parsed[3]["isError"])

    def test_missing_duplicate_and_error_responses_cannot_pass(self):
        cases = [stream(responses()[:-1]),
                 stream(responses() + [responses()[0]]),
                 stream([*responses()[:2], {"jsonrpc": "2.0", "id": 3,
                                           "error": {"code": -32600}}, responses()[3]]),
                 b'{"jsonrpc":"2.0","id":1,"id":2,"result":{}}\n']
        for item in cases:
            with self.subTest(item=item[:60]), self.assertRaises(ValueError):
                _parse_mcp_output(item)

    def test_failed_or_malformed_worker_result_is_not_a_success(self):
        for value in ({"isError": True, "content": [{"type": "text", "text": "failure"}]},
                      {"isError": False, "content": []},
                      {"isError": False, "content": ["not-a-block"]},
                      {"isError": False, "content": [{"type": "text", "text": "broken"}]}):
            with self.subTest(value=value), self.assertRaises((ValueError, TypeError)):
                _tool_result(value)

    def test_request_uses_one_worker_tool_and_negative_host_tool(self):
        messages = [json.loads(line) for line in _mcp_input({"read": [], "write": []}).splitlines()]
        self.assertEqual(messages[2]["method"], "tools/list")
        self.assertEqual(messages[3]["params"]["name"], "worker_command")
        self.assertEqual(messages[4]["params"]["name"], "host_shell")
        self.assertEqual(messages[3]["params"]["arguments"]["argv"][:3],
                         ["python", "-I", "-c"])

    def test_broker_process_stops_on_any_communication_error(self):
        for error in (OSError("pipe failed"), subprocess.TimeoutExpired("broker", 90)):
            with self.subTest(error=type(error).__name__):
                child = Mock()
                child.communicate.side_effect = error
                with patch("harness.claude_broker_probe.subprocess.Popen", return_value=child), \
                     patch("harness.claude_broker_probe._terminate_tree", return_value=[]) as stop:
                    with self.assertRaises(type(error)):
                        _broker_process(Path("binding"), "a" * 64, b"{}\n", Path("."))
                    stop.assert_called_once_with(child)

    def test_unknown_worker_stop_preserves_probe_fixture(self):
        self.assertTrue(_preserve_fixture(create_uncertain=False, state_exists=True,
                                          cid_exists=True, stop_confirmed=False))
        self.assertFalse(_preserve_fixture(create_uncertain=False, state_exists=True,
                                           cid_exists=True, stop_confirmed=True))


if __name__ == "__main__":
    unittest.main()
