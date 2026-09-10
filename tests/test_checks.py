"""B1 l3-gates: thesis_checks.py discriminates on the planted fixture (0 tokens)."""
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/thesis-review/scripts/thesis_checks.py"
CASE = ROOT / "evals/cases/l3-gates"
EXP = json.loads((CASE / "expected.json").read_text(encoding="utf-8"))
CSV, FIX, GOOD = CASE / "fixture.csv", CASE / "fixture.tex", CASE / "good.tex"


def run(*args):
    r = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, encoding="utf-8")
    return r.returncode, (json.loads(r.stdout) if r.stdout.strip() else {}), r.stderr


def facts(tex, csv=CSV):
    return run("facts", "--csv", csv, "--tex", tex)


def style(tex):
    return run("style", "--tex", tex, "--chapter", "cap:resultados", "--prefix", "res_")


def integrity(orig, new, out):
    return run("integrity", "--orig", orig, "--new", new, "--chapter", "cap:resultados", "--out", out)


class Gates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.t0 = time.time()
        cls.tmp = Path(tempfile.mkdtemp())

    @classmethod
    def tearDownClass(cls):
        assert time.time() - cls.t0 < 5, "suite must run under 5 s"

    def test_facts_fixture(self):
        code, out, _ = facts(FIX)
        self.assertEqual(code, 1)
        self.assertEqual(sorted(out["unmatched"]), ["0.58690", "0.5871"])
        for honest in ("0.5869", "0.4123", "0,4123", "3.21", "9,221"):
            self.assertNotIn(honest, out["unmatched"])
        self.assertEqual(out["checked"], EXP["facts_fixture"]["checked"])

    def test_style_fixture(self):
        code, out, _ = style(FIX)
        self.assertEqual(code, 1)
        self.assertEqual(out["dash"], [EXP["dash_line"]])
        self.assertEqual(out["decimal_comma"], ["0,4123"])
        self.assertEqual(out["labels"], ["sec:met_c"])
        text = json.dumps(out)
        for never in ("10--20", "skip-if-done", "lstlisting"):
            self.assertNotIn(never, text)

    def test_good_all_clean(self):
        code, out, _ = facts(GOOD)
        self.assertEqual((code, out["unmatched"]), (0, []))
        code, out, _ = style(GOOD)
        self.assertEqual((code, out), (0, {"dash": [], "decimal_comma": [], "labels": []}))
        reg = self.tmp / "same.md"
        code, out, _ = integrity(GOOD, GOOD, reg)
        self.assertEqual(code, 0)
        self.assertEqual((out["outside"], out["blocks"], out["missing_labels"], out["dangling_refs"]), ([], [], [], []))
        self.assertTrue(reg.exists())

    def test_integrity_one_word_inside(self):
        src = GOOD.read_text(encoding="utf-8")
        self.assertEqual(src.count("summarises"), 1)
        new = self.tmp / "inside.tex"
        new.write_text(src.replace("summarises", "summarizes"), encoding="utf-8")
        reg = self.tmp / "inside.md"
        code, out, _ = integrity(GOOD, new, reg)
        self.assertEqual(code, 0)
        self.assertEqual(out["outside"], [])
        log = reg.read_text(encoding="utf-8")
        blocks = [l for l in log.splitlines() if l[:1].isdigit() and ". " in l]
        self.assertEqual(len(blocks), 1)
        self.assertIn("Main Comparison", blocks[0])
        self.assertIn("BEFORE: summarises", log)
        self.assertIn("AFTER: summarizes", log)

    def test_integrity_word_outside(self):
        src = GOOD.read_text(encoding="utf-8")
        self.assertEqual(src.count("describes"), 1)
        new = self.tmp / "outside.tex"
        new.write_text(src.replace("summarises", "summarizes").replace("describes", "presents"), encoding="utf-8")
        reg = self.tmp / "outside.md"
        code, out, _ = integrity(GOOD, new, reg)
        self.assertEqual(code, 1)
        self.assertEqual(len(out["outside"]), 1)
        self.assertIn("presents", out["outside"][0]["after"])
        self.assertEqual(out["outside"][0]["orig_lines"], [3, 3])
        self.assertFalse(reg.exists())

    def test_flip_csv_makes_0_5871_pass(self):
        flip = self.tmp / "flip.csv"
        flip.write_text(CSV.read_text(encoding="utf-8") + EXP["flip_csv_row"] + "\n", encoding="utf-8")
        good_row = self.tmp / "flip.tex"  # fixture minus the five-decimal defect
        good_row.write_text(FIX.read_text(encoding="utf-8").replace("0.58690", "0.5869"), encoding="utf-8")
        code, out, _ = facts(good_row, flip)
        self.assertEqual((code, out["unmatched"]), (0, []))
        code, out, _ = facts(FIX, flip)
        self.assertEqual((code, out["unmatched"]), (1, ["0.58690"]))

    def test_score(self):
        code, out, _ = run("score", "--scores", "90,80,70,60", "--facts-unmatched", "2")
        self.assertEqual((code, out["df"], out["composite"]), (0, 59, 67.7))
        code, out, _ = run("score", "--scores", "90,80,70,60")
        self.assertEqual(out["composite"], 77.0)

    def test_usage_error(self):
        code, _, err = run("style", "--tex", FIX, "--chapter", "cap:nope")
        self.assertEqual(code, 2)
        code, _, _ = run("facts", "--tex", FIX)
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
