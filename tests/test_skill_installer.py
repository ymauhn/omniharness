"""Zero-token tests for .agents/skills/skill-installer/scripts/skill_installer.py: a synthetic home and manifest."""
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents" / "skills" / "skill-installer" / "scripts" / "skill_installer.py"
spec = importlib.util.spec_from_file_location("skill_installer", SCRIPT)
si = importlib.util.module_from_spec(spec); spec.loader.exec_module(si)

PY = sys.executable.replace("\\", "/")
MANIFEST = f'''
[demo]
kind = "test"
url = "https://example.invalid/demo"
license = "MIT"
steps = [
  {{ id = "have", check = "env:SI_TEST_SET", run = "{PY} -c \\"print('never')\\"" }},
  {{ id = "run", check = "file:{{marker}}", run = "{PY} -c \\"open(r'{{marker}}','w').write('x')\\"", gate = "Bash(demo:*)" }},
  {{ id = "key", check = "env:SI_TEST_KEY", owner_only = true, note = "owner creates it" }},
  {{ id = "wait", check = "mcp:demo", run = "{PY} -c \\"print('blocked')\\"", requires_env = ["SI_TEST_KEY"] }},
]
'''


class Installer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="si-")
        self.home = Path(self.tmp) / "home"; (self.home / ".claude" / "plugins").mkdir(parents=True)
        (self.home / ".claude" / "plugins" / "installed_plugins.json").write_text(json.dumps({"plugins": {"ponytail@ponytail": []}}), encoding="utf-8")
        (self.home / ".claude.json").write_text(json.dumps({"mcpServers": {"21st": {}}}), encoding="utf-8")
        self.marker = (Path(self.tmp) / "marker.txt").as_posix()
        self.manifest = Path(self.tmp) / "installers.toml"
        self.manifest.write_text(MANIFEST.replace("{marker}", self.marker), encoding="utf-8")
        self.graph = Path(self.tmp) / "graph.toml"; self.graph.write_text("# curated\n", encoding="utf-8")
        self.log = Path(self.tmp) / "log.jsonl"
        os.environ["SI_TEST_SET"] = "1"; os.environ.pop("SI_TEST_KEY", None)

    def tearDown(self):
        import shutil; shutil.rmtree(self.tmp, ignore_errors=True)

    def cli(self, *args):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = si.main(["--home", str(self.home), "--manifest", str(self.manifest), "--graph", str(self.graph), "--log", str(self.log), *args])
        return code, buf.getvalue()

    def test_probes(self):
        env = dict(os.environ)
        self.assertTrue(si.check("plugin:ponytail", str(self.home), env))
        self.assertFalse(si.check("plugin:impeccable", str(self.home), env))
        self.assertTrue(si.check("mcp:21st", str(self.home), env))
        self.assertTrue(si.check("env:SI_TEST_SET", str(self.home), env))
        self.assertFalse(si.check("env:SI_TEST_KEY", str(self.home), env))
        self.assertTrue(si.check("path:python", str(self.home), env) or si.check("path:python3", str(self.home), env))
        self.assertFalse(si.check("manual", str(self.home), env))

    def test_plan_apply_register(self):
        code, out = self.cli("plan", "demo")
        self.assertEqual(code, 0)
        self.assertIn("OK   have", out); self.assertIn("TODO run", out); self.assertIn("STOP: confirm: Bash(demo:*)", out)
        self.assertIn("YOU  key", out); self.assertIn("WAIT wait", out); self.assertIn("needs SI_TEST_KEY", out)
        code, out = self.cli("apply", "demo")                      # no --yes: refuses, runs nothing
        self.assertEqual(code, 1); self.assertFalse(Path(self.marker).exists())
        code, out = self.cli("apply", "demo", "--yes")
        self.assertEqual(code, 0, out)
        self.assertTrue(Path(self.marker).exists())                 # the TODO step ran
        self.assertNotIn("never", out); self.assertNotIn("blocked", out)  # done and blocked steps did not run
        self.assertEqual([json.loads(l)["step"] for l in self.log.read_text(encoding="utf-8").splitlines()], ["run"])
        code, out = self.cli("plan", "demo"); self.assertIn("OK   run", out)
        code, out = self.cli("register", "demo")
        self.assertEqual(code, 0)
        toml = self.graph.read_text(encoding="utf-8")
        self.assertIn('id = "demo"', toml); self.assertIn('ring = "catalog"', toml); self.assertIn("partial", toml)  # 'wait' still blocked
        code, out = self.cli("env"); self.assertIn("set     SI_TEST_SET", out); self.assertIn("missing SI_TEST_KEY", out)

    def test_real_manifest_parses(self):
        m = si.load_manifest(str(ROOT / ".agents" / "skills" / "skill-installer" / "installers.toml"))
        self.assertTrue({"impeccable", "magic-mcp"} <= set(m))
        for name, t in m.items():
            for s in t["steps"]:
                self.assertIn("id", s, name); self.assertIn("check", s, name)


if __name__ == "__main__":
    unittest.main()
