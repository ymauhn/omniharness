"""Seen-store CLI: temporary projects, no network/model calls."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "harness/seen.py"


class Seen(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def call(self, command, *args, data=None, consumer="scout", context="a" * 64):
        proc = subprocess.run([sys.executable, str(SCRIPT), command, "--root", str(self.root),
            "--consumer", consumer, "--scope", "task-one", "--context", context, *args],
            input=json.dumps(data) if data is not None else None, text=True, capture_output=True)
        return proc.returncode, json.loads(proc.stdout)

    def test_record_snapshot_idempotence_and_context_separation(self):
        updates = [{"id": "https://example.test/page?id=1#x", "verdict": "reviewed", "evidence": "dossier.md"}]
        self.assertEqual(self.call("record", data=updates)[1]["appended"], 1)
        self.assertEqual(self.call("record", data=updates)[1]["appended"], 0)
        snapshot = self.call("snapshot")[1]
        self.assertEqual(snapshot["records"][0]["id"], "https://example.test/page?id=1")
        self.assertEqual(self.call("snapshot", context="b" * 64)[1]["records"], [])
        self.assertEqual(self.call("snapshot", consumer="gauntlet")[1]["records"], [])
        self.assertEqual(self.call("snapshot", "--fresh")[1]["records"], [])
        updates[0]["id"] = "https://example.test/page?id=2"
        self.assertEqual(self.call("record", data=updates)[1]["appended"], 1)
        self.assertEqual(len(self.call("snapshot")[1]["records"]), 2)

    def test_unverified_malformed_and_secret_urls_cannot_enter_history(self):
        for row in ({"id": "mod.py:2 — issue", "verdict": "unverified", "evidence": "none"},
                    {"id": "https://user:password@example.test/x", "verdict": "reviewed", "evidence": "x"},
                    {"id": "https://example.test/x?token=private", "verdict": "reviewed", "evidence": "x"}):
            self.assertNotEqual(self.call("record", data=[row])[0], 0)
        self.assertFalse((self.root / ".omniharness/seen.jsonl").exists())
        self.call("record", data=[{"id": "mod.py:2 — issue", "verdict": "refuted", "evidence": "reproducer"}], consumer="gauntlet")
        path = self.root / ".omniharness/seen.jsonl"
        before = path.read_bytes() + b'{"truncated":'
        path.write_bytes(before)
        self.assertNotEqual(self.call("snapshot")[0], 0)
        self.assertNotEqual(self.call("record", data=[])[0], 0)
        self.assertEqual(path.read_bytes(), before)
        path.write_text(json.dumps({"version": 1}), encoding="utf-8")
        self.assertNotEqual(self.call("record", data=[])[0], 0)
        self.assertNotEqual(self.call("snapshot", "--max-age-days", "nan")[0], 0)

    def test_expiry_and_fingerprint_include_dirty_file_content(self):
        self.call("record", data=[{"id": "mod.py:2 — issue", "verdict": "confirmed", "evidence": "reproducer"}], consumer="gauntlet")
        path = self.root / ".omniharness/seen.jsonl"
        row = json.loads(path.read_text())
        row["date"] = "2000-01-01T00:00:00+00:00"
        path.write_text(json.dumps(row) + "\n")
        self.assertEqual(self.call("snapshot", consumer="gauntlet")[1]["records"], [])
        source = self.root / "source.py"
        source.write_text("before")
        first = self.call("fingerprint", "--file", "source.py")[1]["context"]
        source.write_text("after")
        self.assertNotEqual(first, self.call("fingerprint", "--file", "source.py")[1]["context"])
        self.assertNotEqual(self.call("fingerprint", "--file", "../outside")[0], 0)
