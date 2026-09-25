"""The PreToolUse guard's standing contract.

The guard blocks the handful of commands no confirmation can rescue, and does
nothing else. Two properties are load-bearing and easy to lose in a refactor:

1. It never returns `ask`. A guard that asks on unclassified work turns every
   session into a prompt queue, which is what the ask-list in
   harness/settings.json already covers deliberately and selectively.
2. A guard that cannot reach a decision never blocks. Exit 2 is the blocking
   code; a guard whose policy or input is broken must not reach for it, or a
   bad deploy locks the shell instead of degrading to the native rules.

These are asserted through the process boundary, the way Claude Code calls it.
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "harness/guard_bash.py"
FRAGMENT = ROOT / "harness/settings.json"

BLOCKING_EXIT = 2

ORDINARY = ("npm run build", "pytest -q", "python scripts/validate.py", "git add -A", "ls -la")
DESTRUCTIVE = ("rm -rf /", "git push --force origin master", "mkfs.ext4 /dev/sda1")
MALFORMED = ("{broken", "", "[]", "null")


class GuardContract(unittest.TestCase):
    def guard(self, payload):
        return subprocess.run([sys.executable, str(GUARD)], input=payload, text=True,
                              capture_output=True, encoding="utf-8", cwd=ROOT)

    def decision(self, proc):
        if not proc.stdout.strip():
            return None
        try:
            return json.loads(proc.stdout)["hookSpecificOutput"]["permissionDecision"]
        except (ValueError, KeyError, TypeError):
            return None

    def request(self, command, tool="Bash"):
        return json.dumps({"tool_name": tool, "cwd": str(ROOT), "tool_input": {"command": command}})

    def test_ordinary_commands_are_not_gated(self):
        for command in ORDINARY:
            with self.subTest(command=command):
                proc = self.guard(self.request(command))
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertNotEqual(self.decision(proc), "ask",
                                    f"{command!r} would prompt; the ask-list, not the guard, decides that")

    def test_destructive_commands_still_block(self):
        for command in DESTRUCTIVE:
            with self.subTest(command=command):
                proc = self.guard(self.request(command))
                self.assertEqual(proc.returncode, BLOCKING_EXIT, f"{command!r} must not pass")
                self.assertTrue(proc.stderr.strip(), "a block states its reason")

    def test_malformed_input_degrades_instead_of_blocking(self):
        for payload in MALFORMED:
            with self.subTest(payload=payload):
                proc = self.guard(payload)
                self.assertNotEqual(proc.returncode, BLOCKING_EXIT,
                                    "a guard that cannot decide must not block the shell")
                self.assertNotIn(self.decision(proc), ("deny", "ask"))

    def test_fragment_registers_the_guard_for_bash_only(self):
        entries = json.loads(FRAGMENT.read_text(encoding="utf-8"))["hooks"]["PreToolUse"]
        matchers = [entry["matcher"] for entry in entries
                    if any(GUARD.name in item.get("command", "") for item in entry["hooks"])]
        self.assertEqual(matchers, ["Bash"],
                         "an all-tool matcher routes reads and edits through a command guard")


if __name__ == "__main__":
    unittest.main()
