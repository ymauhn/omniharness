"""Failure-path check for the legacy disposable Docker process probe."""
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from harness import sandbox_probe


class SandboxProbeRecovery(unittest.TestCase):
    def test_cold_create_timeout_preserves_exact_id_triage_fixture(self):
        image = "python@sha256:" + "a" * 64
        original_run = subprocess.run
        created = []

        def fake_run(command, **kwargs):
            if command[0] != "fake-docker":
                return original_run(command, **kwargs)
            if "version" in command:
                return subprocess.CompletedProcess(command, 0, json.dumps({"Os": "linux", "Version": "fake"}), "")
            if "create" in command:
                cidfile = Path(command[command.index("--cidfile") + 1])
                cidfile.write_text("a" * 64, encoding="utf-8")
                created.append(cidfile.parent)
                raise subprocess.TimeoutExpired(command, 30)
            return subprocess.CompletedProcess(command, 0, "", "")

        try:
            with patch.object(sandbox_probe.subprocess, "run", side_effect=fake_run):
                with self.assertRaises(subprocess.TimeoutExpired):
                    sandbox_probe.probe(image, "fake-docker", None)
            self.assertEqual(len(created), 1)
            root = created[0].resolve(strict=True)
            self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve(strict=True)))
            self.assertTrue(root.name.startswith("omni-containment-"))
            self.assertEqual((root / "cid").read_text(encoding="utf-8"), "a" * 64)
            intent = json.loads((root / "create-intent.json").read_text(encoding="utf-8"))
            self.assertEqual(intent["name"], "omni-probe-" + intent["nonce"])
        finally:
            for root in created:
                root = root.resolve(strict=True)
                if not root.is_relative_to(Path(tempfile.gettempdir()).resolve(strict=True)) or not root.name.startswith("omni-containment-"):
                    raise ValueError("refusing to clean an unexpected test fixture")

                def retry_readonly(function, path, error):
                    target = Path(path)
                    if not isinstance(error, PermissionError) or target.is_symlink() or not target.resolve(strict=True).is_relative_to(root):
                        raise error
                    os.chmod(target, stat.S_IWRITE)
                    function(path)

                shutil.rmtree(root, onexc=retry_readonly)


if __name__ == "__main__":
    unittest.main()
