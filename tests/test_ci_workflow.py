"""Regression: CI must install every experiment requirements.txt a manifest declares the repository test
run also needs (tests/test_nist_longley.py imports numpy via experiments/nist-longley/run.py; CI installing
only tests/visual/requirements.txt left numpy missing on a clean runner)."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CI = ROOT / ".github/workflows/ci.yml"


class CiPythonDependencies(unittest.TestCase):
    def test_ci_installs_requirements_the_repository_test_run_declares(self):
        ci_text = CI.read_text(encoding="utf-8")
        manifests = list(ROOT.glob("experiments/*/manifest.json"))
        self.assertTrue(manifests, "expected at least one experiment manifest")
        checked = 0
        for manifest_path in manifests:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            declared_in = manifest.get("environment", {}).get("declared_in", "")
            if "repository test run" not in declared_in:
                continue
            checked += 1
            req = manifest_path.parent / "requirements.txt"
            self.assertTrue(req.exists(), req)
            rel = req.relative_to(ROOT).as_posix()
            self.assertIn(rel, ci_text, f"{CI} must install {rel} (declared in {manifest_path.relative_to(ROOT)})")
        self.assertGreater(checked, 0, "expected at least one manifest to declare a repository test run dependency")


if __name__ == "__main__":
    unittest.main()
