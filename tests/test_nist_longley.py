"""V1 pillar 3: NIST StRD Longley rerun, certified-claim check, control, retained failed check and facts gate (no network)."""
import hashlib
import json
import re
import shlex
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


def facts(tex, csv):
    r = py(FACTS, "facts", "--csv", csv, "--tex", tex, "--decimal", "point")
    return r.returncode, json.loads(r.stdout)


def manifest_command(key):
    """Run a manifest command exactly as written, from its declared cwd, with this interpreter."""
    commands = load(EXP / "manifest.json")["commands"]
    args = shlex.split(commands[key])
    assert args[0] == "python", args
    r = py(*args[1:], cwd=ROOT / commands["cwd"])
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
        outputs = ("results/lstsq.csv", "results/normal-equations.csv")
        self.assertEqual(run["outputs"], {p: sha256(self.work / p) for p in outputs})
        for key in ("python", "numpy", "platform", "command"):
            self.assertTrue(run[key], key)

    def test_qr_svd_solution_passes_the_certified_claim(self):
        code, out = self.check("lstsq")
        self.assertEqual((code, out["verdict"]), (0, "PASS"), out)
        self.assertEqual(len(out["lre"]), 16)
        self.assertGreaterEqual(out["min_lre"], out["threshold_lre"])
        self.assertEqual(load(EXP / "results/check-lstsq.json")["verdict"], "PASS")

    def test_normal_equations_control_is_informational_and_retained(self):
        # PILLAR-3-SCIENCE.md: the control is not an acceptance verdict; a FAIL on another BLAS/LAPACK
        # is an environment difference as long as lstsq passes, so either verdict is accepted here.
        code, out = self.check("normal-equations")
        self.assertIn((code, out["verdict"]), [(0, "PASS"), (1, "FAIL")], out)
        self.assertEqual(len(out["lre"]), 16)
        self.assertLess(out["min_lre"], self.check("lstsq")[1]["min_lre"])
        self.assertEqual(load(self.work / "results/check-normal-equations.json"), out)
        manifest = load(EXP / "manifest.json")
        self.assertEqual(manifest["expected_verdicts"], {"lstsq": "PASS"})
        self.assertIn("--method normal-equations", manifest["commands"]["control"])
        self.assertNotIn("normal-equations", manifest["commands"]["failed_check"])

    def test_check_fails_a_planted_four_digit_result(self):
        planted = self.tmp / "planted"
        shutil.copytree(self.work, planted, dirs_exist_ok=True)
        rows = ["name,value"] + [f"{k},{float(v) * (1 + 1e-4)!r}"
                                 for k, v in load(EXP / "certified.json")["values"].items()]
        (planted / "results/lstsq.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
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
        self.assertEqual(load(EXP / "results/check-lstsq.json")["verdict"], manifest["expected_verdicts"]["lstsq"])
        # numpy is a declared dependency with a lower bound; another operator's version is an explained
        # environment difference (PILLAR-3-SCIENCE.md), so only the bound is checked, not equality.
        spec = [line.strip() for line in (EXP / "requirements.txt").read_text(encoding="utf-8").splitlines()
                if line.strip().startswith("numpy")]
        self.assertEqual(spec, ["numpy>=1.26"])
        numpy = tuple(int(part) for part in load(EXP / "results/run.json")["numpy"].split(".")[:2])
        self.assertGreaterEqual(numpy, (1, 26))

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

    def test_facts_gate_passes_the_draft_on_the_fresh_lstsq_results(self):
        tex, csv = EXP / "draft/section.tex", self.work / "results/lstsq.csv"
        code, out = facts(tex, csv)
        self.assertEqual((code, out["unmatched"]), (0, []), out)
        prose = "\n".join(l for l in tex.read_text(encoding="utf-8").splitlines() if not l.startswith("%"))
        self.assertEqual(out["checked"], len(re.findall(r"\d+\.\d+", prose)))  # every decimal is checked
        self.assertIn("-3482258.6346", prose)  # a negative estimate, matched with its sign
        self.assertEqual(manifest_command("facts_gate")[0], 0)

    def test_facts_gate_rejects_sign_flips_and_control_values(self):
        text = (EXP / "draft/section.tex").read_text(encoding="utf-8")
        mutated = self.tmp / "flipped.tex"
        mutated.write_text(text.replace("15.0619", "-15.0619").replace("-3482258.6346", "3482258.6346")
                           .replace("890420.3836", "890420.3862"), encoding="utf-8")  # the control's B0 SD
        code, out = facts(mutated, self.work / "results/lstsq.csv")
        self.assertEqual((code, out["unmatched"]), (1, ["-15.0619", "3482258.6346", "890420.3862"]), out)

    def test_retained_failed_check_is_the_rejected_mutated_claim(self):
        failed = load(EXP / "manifest.json")["retained_failed_check"]
        self.assertEqual(failed["command"], "commands.failed_check")
        code, out = manifest_command("failed_check")
        self.assertEqual((code, out["unmatched"]), (1, ["304.8542"]), out)
        original = (EXP / "draft/section.tex").read_text(encoding="utf-8").splitlines()
        mutated = (EXP / "draft/section-mutated.tex").read_text(encoding="utf-8").splitlines()
        self.assertEqual(mutated[1:], [l.replace("304.8541", "304.8542") for l in original])


if __name__ == "__main__":
    unittest.main()
