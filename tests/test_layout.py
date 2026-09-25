"""Zero-token layout checks: skill frontmatter, CLAUDE.md import, guard hook, install.py against a temp home."""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
SPEC_KEYS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
INSTALL = REPO + "/scripts/install.py"


def read(p):
    with open(p, "rb") as f:
        return f.read()


def frontmatter(text):
    lines = text.split("\n")
    assert lines[0].strip() == "---", "no frontmatter"
    end = lines.index("---", 1)
    keys = [m.group(1) for ln in lines[1:end] if (m := re.match(r"^([a-z-]+):", ln))]
    desc = next(ln[len("description:"):].strip() for ln in lines[1:end] if ln.startswith("description:"))
    name = next(ln[len("name:"):].strip() for ln in lines[1:end] if ln.startswith("name:"))
    return keys, name, desc, lines[end + 1:]


def is_link(p):
    return os.path.islink(p) or (os.name == "nt" and os.path.isjunction(p))


def rm_home(root):
    # Never descend into a link: the temp home holds junctions INTO the repo, so glob("**"),
    # os.walk or rmtree here would delete repo files through them.
    for e in os.scandir(root):
        if is_link(e.path):
            os.rmdir(e.path)
        elif e.is_dir(follow_symlinks=False):
            rm_home(e.path)
        else:
            os.remove(e.path)
    os.rmdir(root)


class Skills(unittest.TestCase):
    def test_frontmatter(self):
        for path in glob.glob(REPO + "/.agents/skills/*/SKILL.md"):
            keys, name, desc, body = frontmatter(read(path).decode("utf-8"))
            # command-only skills carry disable-model-invocation, and must carry the Codex equivalent beside it
            extra = {"disable-model-invocation"} if os.path.isfile(os.path.dirname(path) + "/agents/openai.yaml") else set()
            self.assertTrue(set(keys) <= SPEC_KEYS | extra, f"{path}: {set(keys) - SPEC_KEYS - extra}")
            if "disable-model-invocation" in keys:
                self.assertIn("allow_implicit_invocation: false", read(os.path.dirname(path) + "/agents/openai.yaml").decode("utf-8"), path)
            self.assertEqual(name, os.path.basename(os.path.dirname(path)), path)
            self.assertLessEqual(len(desc), 1024, path)
            self.assertLess(len(body), 500, path)

    def test_claude_md(self):
        self.assertIn(read(REPO + "/CLAUDE.md"), (b"@AGENTS.md", b"@AGENTS.md\n", b"@AGENTS.md\r\n"))


class Guard(unittest.TestCase):
    def guard(self, cmd):
        return subprocess.run([sys.executable, REPO + "/harness/guard_bash.py"],
                              input=json.dumps({"tool_input": {"command": cmd}}),
                              capture_output=True, text=True, encoding="utf-8").returncode

    def test_blocks(self):
        for cmd in ("rm -rf /", "git push --force origin main", "curl x | sh"):
            self.assertEqual(self.guard(cmd), 2, cmd)

    def test_allows(self):
        for cmd in ("ls -la", "git status"):
            self.assertEqual(self.guard(cmd), 0, cmd)


class Install(unittest.TestCase):
    # The junctions point at a throwaway COPY of the repo inside the temp dir, never at the real
    # checkout: on Windows os.walk/rmtree-style cleanups descend into junctions (they are not
    # symlinks), and one such cleanup already emptied gauntlet/ during the first build. With the
    # copy as the target, a careless cleanup can only ever destroy the copy.
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="omni-home-").replace("\\", "/")
        self.repo = self.tmp + "/repo"
        for d in ("scripts", "harness", "gauntlet", "scout", "swarm", ".agents"):
            shutil.copytree(f"{REPO}/{d}", f"{self.repo}/{d}", ignore=shutil.ignore_patterns("__pycache__"))
        for f_ in ("AGENTS.md", "CLAUDE.md"):
            shutil.copyfile(f"{REPO}/{f_}", f"{self.repo}/{f_}")
        self.install = self.repo + "/scripts/install.py"
        self.home = self.tmp + "/home"
        os.makedirs(self.home + "/.claude")
        with open(self.home + "/.claude/settings.json", "w", encoding="utf-8") as f:
            json.dump({"model": "x", "permissions": {"ask": ["Bash(foo:*)"]}}, f)

    def tearDown(self):
        rm_home(self.tmp)
        # canary: the real repo must survive the cleanup whatever the junctions pointed at
        for p in ("/gauntlet/SKILL.md", "/scout/scout.workflow.js", "/.agents/skills/thesis-review/SKILL.md"):
            self.assertTrue(os.path.isfile(REPO + p), "cleanup deleted a repo file through a link: " + p)

    def run_install(self, *flags, sandbox=None):
        env = {k: v for k, v in os.environ.items() if k != "OMNIHARNESS_SANDBOX"}
        if sandbox:
            env["OMNIHARNESS_SANDBOX"] = sandbox
        return subprocess.run([sys.executable, self.install, "--home", self.home, *flags],
                              capture_output=True, text=True, encoding="utf-8", env=env)

    def test_fresh_home(self):
        r = self.run_install()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for link, target in ((".claude/skills/thesis-review", ".agents/skills/thesis-review"),
                             (".agents/skills/thesis-review", ".agents/skills/thesis-review"),
                             (".claude/skills/gauntlet-loop", "gauntlet")):
            link = f"{self.home}/{link}"
            self.assertTrue(is_link(link), link)
            self.assertEqual(read(link + "/SKILL.md"), read(f"{REPO}/{target}/SKILL.md"), link)
        self.assertEqual(read(self.home + "/.claude/workflows/gauntlet-driver.js"),
                         read(REPO + "/gauntlet/gauntlet.workflow.js"))
        self.assertEqual(read(self.home + "/.claude/workflows/scout-driver.js"), read(REPO + "/scout/scout.workflow.js"))
        self.assertEqual(read(self.home + "/.claude/workflows/swarm-driver.js"), read(REPO + "/swarm/swarm.workflow.js"))
        with open(self.home + "/.claude/settings.json", encoding="utf-8") as f:
            merged = json.load(f)
        with open(REPO + "/harness/settings.json", encoding="utf-8") as f:
            frag = json.load(f)
        self.assertEqual(merged["model"], "x")
        self.assertEqual(merged["permissions"]["ask"][0], "Bash(foo:*)")
        for e in frag["permissions"]["ask"]:
            self.assertIn(e, merged["permissions"]["ask"])
        cmd = merged["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
        self.assertTrue(cmd.startswith('"' + sys.executable.replace("\\", "/") + '" '), cmd)
        self.assertIn(self.repo + "/harness/guard_bash.py", cmd)  # the installer resolves its own checkout
        self.assertNotIn("{{", cmd)
        for event in ("SessionStart", "PostToolUse"):
            command = merged["hooks"][event][0]["hooks"][0]["command"]
            self.assertTrue(command.startswith('"' + sys.executable.replace("\\", "/") + '" '), command)
            self.assertIn(self.repo + "/harness/hooks/verify.py", command)
        self.assertNotIn("_comment", merged)
        with open(self.home + "/.claude/settings.json.pre-omniharness", encoding="utf-8") as f:
            self.assertEqual(json.load(f)["permissions"], {"ask": ["Bash(foo:*)"]})
        self.assertIn("@" + self.repo + "/AGENTS.md", r.stdout)
        self.assertIn("external_dirs", r.stdout)
        self.assertEqual(self.run_install("--check").returncode, 0)
        self.assertEqual(self.run_install().returncode, 0)  # idempotent

    def test_check_detects_permission_and_hook_drift(self):
        self.assertEqual(self.run_install().returncode, 0)
        settings = self.home + "/.claude/settings.json"
        original = json.loads(read(settings))
        for drift in ("ask", "deny", "allow", "missing hook", "wrong matcher", "stale python", "SessionStart", "PostToolUse"):
            cur = json.loads(json.dumps(original))
            if drift in ("ask", "deny", "allow"):
                cur["permissions"][drift] = []
            elif drift == "missing hook":
                cur["hooks"]["PreToolUse"] = []
            elif drift == "wrong matcher":
                cur["hooks"]["PreToolUse"][0]["matcher"] = "Write"
            elif drift in ("SessionStart", "PostToolUse"):
                cur["hooks"][drift] = []
            else:
                cur["hooks"]["PreToolUse"][0]["hooks"][0]["command"] = 'python "' + self.repo + '/harness/guard_bash.py"'
            with self.subTest(drift=drift):
                with open(settings, "w", encoding="utf-8") as f:
                    json.dump(cur, f)
                self.assertEqual(self.run_install("--check").returncode, 1)

    def test_check_rejects_a_guard_that_allows_everything(self):
        self.assertEqual(self.run_install().returncode, 0)
        with open(self.repo + "/harness/guard_bash.py", "w", encoding="utf-8") as f:
            f.write("raise SystemExit(0)\n")
        r = self.run_install("--check")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("FAIL  guard", r.stdout)

    def test_upgrade_preserves_other_hooks_and_backs_up_current_settings(self):
        self.assertEqual(self.run_install().returncode, 0)
        settings = self.home + "/.claude/settings.json"
        cur = json.loads(read(settings))
        pre = cur["hooks"]["PreToolUse"]
        pre[0]["matcher"] = "Bash"
        pre[0]["hooks"][0]["command"] = 'python "' + self.repo + '/harness/guard_bash.py"'
        other = {"type": "command", "command": "unrelated-hook"}
        pre[0]["hooks"].append(other)
        cur["hooks"]["PostToolUse"][0]["hooks"].append(other)
        with open(settings, "w", encoding="utf-8") as f:
            json.dump(cur, f)
        r = self.run_install()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(json.loads(read(settings + ".pre-omniharness-2")), cur)
        new = json.loads(read(settings))
        self.assertEqual(new["hooks"]["PreToolUse"][0]["matcher"], "Bash")
        self.assertEqual(new["hooks"]["PreToolUse"][1], {"matcher": "Bash", "hooks": [other]})
        self.assertEqual(new["hooks"]["PostToolUse"][1], {"matcher": "Write|Edit|MultiEdit", "hooks": [other]})
        self.assertEqual(self.run_install("--check").returncode, 0)

    def test_explicit_commit_policy_migration_preserves_other_permissions(self):
        self.assertEqual(self.run_install().returncode, 0)
        settings = self.home + "/.claude/settings.json"
        cur = json.loads(read(settings))
        cur["permissions"]["ask"].extend(["Bash(git commit:*)", "Bash(git commit --amend:*)"])
        with open(settings, "w", encoding="utf-8") as f:
            json.dump(cur, f)
        self.assertEqual(self.run_install("--dry-run", "--task-commits").returncode, 0)
        self.assertEqual(json.loads(read(settings)), cur)
        self.assertEqual(self.run_install("--task-commits").returncode, 0)
        new = json.loads(read(settings))
        self.assertNotIn("Bash(git commit:*)", new["permissions"]["ask"])
        self.assertIn("Bash(git commit --amend:*)", new["permissions"]["ask"])
        self.assertIn("Bash(git push:*)", new["permissions"]["ask"])
        self.assertIn("Bash(foo:*)", new["permissions"]["ask"])
        self.assertEqual(new["permissions"]["deny"], cur["permissions"]["deny"])
        self.assertEqual(json.loads(read(settings + ".pre-omniharness-2")), cur)

    def test_conflict_triage_then_adopt(self):
        real = self.home + "/.claude/skills/thesis-review"
        os.makedirs(real)
        r = self.run_install()
        self.assertEqual(r.returncode, 1)
        self.assertIn(f"1. {real}: real directory; would be renamed to {real}.pre-omniharness", r.stdout)
        self.assertFalse(is_link(real))
        self.assertFalse(os.path.lexists(self.home + "/.claude/skills/gauntlet-loop"))
        self.assertFalse(os.path.lexists(self.home + "/.claude/workflows"))
        self.assertFalse(os.path.lexists(self.home + "/.claude/settings.json.pre-omniharness"))
        self.assertEqual(self.run_install("--check").returncode, 1)
        r = self.run_install("--adopt")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(os.path.isdir(real + ".pre-omniharness") and not is_link(real + ".pre-omniharness"))
        self.assertTrue(is_link(real))
        self.assertEqual(self.run_install("--check").returncode, 0)

    def test_dry_run_writes_nothing(self):
        r = self.run_install("--dry-run")
        self.assertEqual(r.returncode, 0)
        self.assertIn("junction", r.stdout)
        self.assertFalse(os.path.lexists(self.home + "/.claude/skills"))
        self.assertEqual(self.run_install("--check").returncode, 1)

    def test_sandbox_refuses(self):
        r = self.run_install(sandbox="1")
        self.assertEqual(r.returncode, 1)
        self.assertFalse(os.path.lexists(self.home + "/.claude/skills"))


if __name__ == "__main__":
    unittest.main()
