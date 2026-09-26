"""Unit checks for the shared durable/atomic write helpers."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from harness import fsutil
from harness.fsutil import flush_durable, write_atomic, write_exclusive


class WriteExclusiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def test_creates_and_fsyncs_text(self):
        path = self.base / "receipt.json"
        with patch.object(fsutil.os, "fsync", wraps=fsutil.os.fsync) as synced:
            write_exclusive(path, '{"ok": true}\n')
            self.assertGreaterEqual(synced.call_count, 1)
        self.assertEqual(path.read_text(encoding="utf-8"), '{"ok": true}\n')

    def test_never_overwrites_an_existing_file(self):
        path = self.base / "receipt.json"
        write_exclusive(path, "first")
        with self.assertRaises(FileExistsError):
            write_exclusive(path, "second")
        self.assertEqual(path.read_text(encoding="utf-8"), "first")

    def test_writes_bytes_in_binary_mode(self):
        path = self.base / "registry.bin"
        write_exclusive(path, b"\x00\x01raw")
        self.assertEqual(path.read_bytes(), b"\x00\x01raw")


class WriteAtomicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def test_replaces_content_and_leaves_no_temp_file(self):
        path = self.base / "state.json"
        write_atomic(path, "one")
        write_atomic(path, "two")
        self.assertEqual(path.read_text(encoding="utf-8"), "two")
        self.assertEqual(list(self.base.glob("state.json.*.tmp")), [])

    def test_failure_cleans_up_the_temp_file_and_keeps_the_previous_content(self):
        path = self.base / "state.json"
        write_atomic(path, "original")
        with patch.object(fsutil.os, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                write_atomic(path, "new")
        self.assertEqual(path.read_text(encoding="utf-8"), "original")
        self.assertEqual(list(self.base.glob("state.json.*.tmp")), [])

    def test_retries_a_windows_style_permission_error_on_replace(self):
        path = self.base / "state.json"
        write_atomic(path, "original")
        calls = {"n": 0}
        real_replace = fsutil.os.replace

        def flaky(src, dst):
            calls["n"] += 1
            if calls["n"] < 3:
                raise PermissionError("target still open")
            return real_replace(src, dst)

        with patch.object(fsutil.os, "replace", side_effect=flaky):
            write_atomic(path, "new", max_replace_attempts=5, retry_delay=0)
        self.assertEqual(calls["n"], 3)
        self.assertEqual(path.read_text(encoding="utf-8"), "new")

    def test_newline_is_preserved_verbatim_when_requested(self):
        path = self.base / "snapshot.json"
        write_atomic(path, "a\nb\n", newline="\n")
        with open(path, "rb") as stream:
            self.assertEqual(stream.read(), b"a\nb\n")


class FlushDurableTests(unittest.TestCase):
    def test_writes_flushes_and_fsyncs_an_open_stream(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "events.jsonl"
        with patch.object(fsutil.os, "fsync", wraps=fsutil.os.fsync) as synced, path.open("a", encoding="utf-8") as stream:
            flush_durable(stream, "line one\n")
            flush_durable(stream, "line two\n")
            self.assertEqual(synced.call_count, 2)
        self.assertEqual(path.read_text(encoding="utf-8"), "line one\nline two\n")


if __name__ == "__main__":
    unittest.main()
