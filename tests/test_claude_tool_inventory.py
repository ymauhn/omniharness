"""Offline adversarial fixtures for the Claude restricted-tool inventory gate."""
import json
import unittest

from harness.claude_tool_inventory import inspect_init


SESSION = "00000000-0000-4000-8000-000000000001"
TOOL = "mcp__omni_worker__worker_command"


def event(**changes):
    value = {"type": "system", "subtype": "init", "session_id": SESSION,
             "tools": [TOOL], "mcp_servers": [{"name": "omni-worker", "status": "connected"}]}
    value.update(changes)
    return json.dumps(value).encode() + b"\n"


def inspect(stream):
    return inspect_init(stream, session_id=SESSION, expected_tools={TOOL},
                        server_name="omni-worker")


class ClaudeToolInventoryTests(unittest.TestCase):
    def test_exact_inventory_only(self):
        self.assertEqual(inspect(event() + b'{"type":"result"}\n'),
                         {"verified": True, "issues": []})

    def test_hidden_builtin_or_other_mcp_tool_blocks_claim(self):
        for name in ("Bash", "Read", "Agent", "WebFetch", "mcp__other__tool"):
            with self.subTest(name=name):
                self.assertFalse(inspect(event(tools=[TOOL, name]))["verified"])

    def test_wrong_session_server_or_pending_connection_blocks_claim(self):
        for fixture in (event(session_id="other"),
                        event(mcp_servers=[{"name": "other", "status": "connected"}]),
                        event(mcp_servers=[{"name": "omni-worker", "status": "pending"}]),
                        event(mcp_servers=[])):
            with self.subTest(fixture=fixture):
                self.assertFalse(inspect(fixture)["verified"])

    def test_skipped_server_plugin_or_preinit_side_effect_blocks_claim(self):
        for fixture in (event(mcp_server_errors=[{"name": "other"}]),
                        event(plugin_errors=[{"plugin": "other"}]),
                        event(plugins=[{"name": "other"}]),
                        b'{"type":"system","subtype":"hook_started"}\n' + event()):
            with self.subTest(fixture=fixture):
                self.assertFalse(inspect(fixture)["verified"])

    def test_missing_malformed_or_duplicate_inventory_blocks_claim(self):
        for fixture in (b"", b"broken\n", event(tools=[TOOL, TOOL]),
                        event(tools=None), event(mcp_servers=None),
                        b'{"type":"system","type":"system","subtype":"init"}\n'):
            with self.subTest(fixture=fixture):
                self.assertFalse(inspect(fixture)["verified"])


if __name__ == "__main__":
    unittest.main()
