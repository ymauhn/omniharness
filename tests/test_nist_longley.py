"""V1 pillar 3: NIST StRD Longley rerun, certified-claim check, retained failure and facts gate (no network)."""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXP = ROOT / "experiments/nist-longley"
FACTS = ROOT / ".agents/skills/thesis-review/scripts/thesis_checks.py"


def py(*args, cwd=ROOT):
    return subprocess.run([sys.executable, *map(str, args)], cwd=cwd, capture_output=True, encoding="utf-8")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def facts(tex):
    r = py(FACTS, "facts", "--csv", EXP / "results/results.csv", "--tex", tex, "--decimal", "point")
    return r.returncode, json.loads(r.stdout)


class NistLongley(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.work = cls.tmp / "nist-longley"
        # A second operator's rerun: committed inputs and scripts only, fresh results.
        shutil.copytree(EXP, cls.work, ignore=shutil.ignore_patterns("results", "draft"))
        cls.ran = py("run.py", cwd=cls.work)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def check(self, method):
        r = py("check.py", "--method", method, cwd=self.work)
        return r.returncode, json.loads(r.stdout)

    def test_rerun_records_inputs_and_outputs(self):
        self.assertEqual(self.ran.returncode, 0, self.ran.stderr)
        run = load(self.work / "results/run.json")
        pinned = {i["path"]: i["sha256"] for i in load(EXP / "manifest.json")["inputs"]}
        self.assertEqual(run["inputs"], {"data/Longley.dat": pinned["data/Longley.dat"]})
        self.assertEqual(run["outputs"], {"results/results.csv": sha256(self.work / "results/results.csv")})
        for key in ("python", "numpy", "platform", "command"):
            self.assertTrue(run[key], key)

    def test_qr_svd_solution_passes_the_certified_claim(self):
        code, out = self.check("lstsq")
        self.assertEqual((code, out["verdict"]), (0, "PASS"), out)
        self.assertEqual(len(out["lre"]), 16)
        self.assertGreaterEqual(out["min_lre"], out["threshold_lre"])
        self.assertEqual(load(EXP / "results/check-lstsq.json")["verdict"], "PASS")

    def test_normal_equations_control_loses_digits_and_is_retained(self):
        # Expected to fail, it clears the declared threshold (min LRE 7.41); the manifest records that verdict.
        code, out = self.check("normal-equations")
        expected = load(EXP / "manifest.json")["expected_verdicts"]["normal-equations"]
        self.assertEqual((code, out["verdict"]), (0 if expected == "PASS" else 1, expected), out)
        self.assertLess(out["min_lre"], self.check("lstsq")[1]["min_lre"] - 2)
        retained = load(EXP / "results/check-normal-equations.json")
        self.assertEqual((retained["verdict"], len(retained["lre"])), (out["verdict"], 16))

    def test_check_fails_a_planted_four_digit_result(self):
        planted = self.tmp / "planted"
        shutil.copytree(self.work, planted, dirs_exist_ok=True)
        rows = ["method,name,value"] + [f"lstsq,{k},{float(v) * (1 + 1e-4)!r}"
                                        for k, v in load(EXP / "certified.json")["values"].items()]
        (planted / "results/results.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
        r = py("check.py", cwd=planted)
        out = json.loads(r.stdout)
        self.assertEqual((r.returncode, out["verdict"]), (1, "FAIL"), out)
        self.assertLess(out["min_lre"], out["threshold_lre"])

    def test_manifest_hashes_match_committed_files(self):
        manifest = load(EXP / "manifest.json")
        for item in manifest["inputs"]:
            self.assertEqual(sha256(EXP / item["path"]), item["sha256"], item["path"])
            self.assertTrue(item["url"].startswith("https://www.itl.nist.gov/"), item["url"])
        source = load(EXP / "certified.json")["source"]
        self.assertEqual(sha256(EXP / source["path"]), source["sha256"])
        for method, verdict in manifest["expected_verdicts"].items():
            self.assertEqual(load(EXP / f"results/check-{method}.json")["verdict"], verdict, method)
        self.assertEqual(manifest["expected_verdicts"]["lstsq"], "PASS")

    def test_certified_values_are_verbatim_from_both_nist_sources(self):
        cert = load(EXP / "certified.json")
        values, page = cert["values"], (EXP / cert["source"]["path"]).read_text(encoding="ascii")
        dat = (EXP / "data/Longley.dat").read_text(encoding="ascii")
        for i in range(7):
            row = re.search(rf"^\s*B{i}\s+(\S+)\s+(\S+)\s*$", dat, re.M).groups()
            self.assertEqual((values[f"B{i}"], values[f"B{i}_sd"]), row)
        self.assertEqual(values["residual_sd"], re.search(r"Standard Deviation\s+(\S+)\s*$", dat, re.M)[1])
        self.assertEqual(values["r_squared"], re.search(r"R-Squared\s+(\S+)", dat)[1])
        self.assertEqual(len(values), 16)
        for text in values.values():
            self.assertRegex(page, rf"(?m)^{re.escape(text)}\s*$")

    def test_facts_gate_passes_the_draft_and_rejects_one_altered_digit(self):
        tex = EXP / "draft/section.tex"
        code, out = facts(tex)
        self.assertEqual((code, out["unmatched"]), (0, []), out)
        # The gate skips a numeral followed by "," or "."; every decimal of the prose must still be counted.
        prose = "\n".join(l for l in tex.read_text(encoding="utf-8").splitlines() if not l.startswith("%"))
        self.assertEqual(out["checked"], len(re.findall(r"\d+\.\d+", prose)))
        code, out = facts(EXP / "draft/section-mutated.tex")
        self.assertEqual(code, 1)
        self.assertEqual(len(out["unmatched"]), 1, out)


if __name__ == "__main__":
    unittest.main()
