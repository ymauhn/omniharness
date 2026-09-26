"""Pillar 4 library (scripts/library.py): verify, install and uninstall each entry into a temp fake home.

Like test_layout.Install, the junctions point at a throwaway COPY of the repo, and cleanup never descends into a link.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from test_layout import is_link, rm_home

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
KINDS = {"skill", "template", "tutorial"}


def read(p):
    with open(p, "rb") as f:
        return f.read()


def manifest(root=REPO):
    with open(root + "/library/manifest.json", encoding="utf-8") as f:
        return json.load(f)["entries"]


class RealManifest(unittest.TestCase):
    def test_every_entry_is_pinned_and_verifies(self):
        entries = manifest()
        self.assertTrue(KINDS <= {e["kind"] for e in entries}, "need at least one skill, template and tutorial")
        for e in entries:
            self.assertTrue({"id", "kind", "source", "sha256", "installs", "review"} <= set(e), e)
            self.assertTrue(os.path.exists(REPO + "/" + e["source"]), e["source"])
        r = subprocess.run([sys.executable, REPO + "/scripts/library.py", "verify"], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for e in entries:
            self.assertIn(f"OK    {e['id']}", r.stdout)

    def test_template_is_the_lab_engineering_preset(self):
        entry = next(e for e in manifest() if e["kind"] == "template")
        script = ("import {workflowPresets} from './omniforge-lab/workflows.mjs';"
                  "process.stdout.write(JSON.stringify(workflowPresets().find(p => p.id === 'engineering-checkpoint')))")
        r = subprocess.run(["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(read(REPO + "/" + entry["source"])), json.loads(r.stdout))

    def test_skill_entry_is_the_reviewed_skill_md(self):
        # docs/skills-graph/skill-metadata.json records reviewed_at for this exact SKILL.md hash
        skill = next(e for e in manifest() if e["kind"] == "skill")
        with open(REPO + "/docs/skills-graph/skill-metadata.json", encoding="utf-8") as f:
            text = f.read()
        self.assertIn(hashlib.sha256(read(f"{REPO}/{skill['source']}/SKILL.md")).hexdigest(), text)


class InstallIntoTempHome(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="omni-lib-").replace("\\", "/")
        self.repo = self.tmp + "/repo"
        for d in ("scripts", "library"):
            shutil.copytree(f"{REPO}/{d}", f"{self.repo}/{d}", ignore=shutil.ignore_patterns("__pycache__"))
        self.entries = manifest(self.repo)
        for e in self.entries:
            src, dst = f"{REPO}/{e['source']}", f"{self.repo}/{e['source']}"
            if os.path.isdir(src):
                shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__"))
            elif not os.path.exists(dst):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(src, dst)
        self.home = self.tmp + "/home"
        os.makedirs(self.home + "/.claude")
        self.settings = self.home + "/.claude/settings.json"
        with open(self.settings, "w", encoding="utf-8") as f:
            json.dump({"model": "x", "permissions": {"ask": ["Bash(foo:*)"]}}, f)
        self.settings_bytes = read(self.settings)

    def tearDown(self):
        rm_home(self.tmp)
        for e in manifest():
            self.assertTrue(os.path.exists(REPO + "/" + e["source"]), "cleanup deleted a repo source: " + e["source"])

    def lib(self, *args):
        return subprocess.run([sys.executable, self.repo + "/scripts/library.py", "--home", self.home, *args],
                              capture_output=True, text=True, encoding="utf-8")

    def entry(self, kind):
        return next(e for e in self.entries if e["kind"] == kind)

    def assert_settings_untouched(self):
        self.assertEqual(read(self.settings), self.settings_bytes)
        self.assertEqual([n for n in os.listdir(self.home + "/.claude") if n.startswith("settings")], ["settings.json"])

    def test_install_list_uninstall_each_entry(self):
        for e in self.entries:
            targets = [f"{self.home}/{t}" for t in e["installs"]]
            r = self.lib("install", e["id"], "--dry-run")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertFalse(any(os.path.lexists(t) for t in targets), "dry run wrote " + e["id"])
            r = self.lib("install", e["id"])
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            for t in targets:
                if e["kind"] == "skill":
                    self.assertTrue(is_link(t), t)
                    self.assertEqual(read(t + "/SKILL.md"), read(f"{self.repo}/{e['source']}/SKILL.md"))
                else:
                    self.assertFalse(is_link(t), t)
                    self.assertEqual(hashlib.sha256(read(t)).hexdigest(), e["sha256"], t)
            again = self.lib("install", e["id"])
            self.assertEqual(again.returncode, 0, again.stdout)
            self.assertIn("Nothing to do", again.stdout)
            self.assertRegex(self.lib("list").stdout, rf"{e['id']}\s+{e['kind']}\s+installed")
            r = self.lib("uninstall", e["id"])
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertFalse(any(os.path.lexists(t) for t in targets), "uninstall left " + e["id"])
            self.assertTrue(os.path.exists(f"{self.repo}/{e['source']}"), "uninstall removed the source of " + e["id"])
        self.assert_settings_untouched()

    def test_replaced_targets_keep_a_backup(self):
        skill, tutorial = self.entry("skill"), self.entry("tutorial")
        own_dir = f"{self.home}/{skill['installs'][0]}"
        own_file = f"{self.home}/{tutorial['installs'][0]}"
        os.makedirs(own_dir)
        with open(own_dir + "/SKILL.md", "w", encoding="utf-8") as f:
            f.write("mine")
        os.makedirs(os.path.dirname(own_file), exist_ok=True)
        with open(own_file, "w", encoding="utf-8") as f:
            f.write("my notes")
        for e in (skill, tutorial):
            r = self.lib("install", e["id"])
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(read(own_dir + ".pre-omniharness/SKILL.md"), b"mine")
        self.assertEqual(read(own_file + ".pre-omniharness"), b"my notes")
        for e in (skill, tutorial):
            self.assertEqual(self.lib("uninstall", e["id"]).returncode, 0)
        self.assertEqual(read(own_file + ".pre-omniharness"), b"my notes")  # uninstall never removes a backup
        self.assertTrue(os.path.isdir(own_dir + ".pre-omniharness"))
        self.assert_settings_untouched()

    def test_uninstall_triages_a_target_that_is_no_longer_ours(self):
        tutorial = self.entry("tutorial")
        self.assertEqual(self.lib("install", tutorial["id"]).returncode, 0)
        target = f"{self.home}/{tutorial['installs'][0]}"
        with open(target, "a", encoding="utf-8") as f:
            f.write("\nmy edit\n")
        edited = read(target)
        r = self.lib("uninstall", tutorial["id"])
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("1. " + target, r.stdout)
        self.assertEqual(read(target), edited)

    def test_tampered_source_fails_verify_and_install(self):
        for e in (self.entry("tutorial"), self.entry("skill")):
            src = f"{self.repo}/{e['source']}"
            with open(src + "/SKILL.md" if os.path.isdir(src) else src, "a", encoding="utf-8") as f:
                f.write("\ninjected line\n")
            r = self.lib("verify")
            self.assertEqual(r.returncode, 1, r.stdout)
            self.assertIn(f"FAIL  {e['id']}", r.stdout)
            r = self.lib("install", e["id"])
            self.assertEqual(r.returncode, 1, r.stdout)
            self.assertFalse(any(os.path.lexists(f"{self.home}/{t}") for t in e["installs"]))
        self.assert_settings_untouched()

    def test_manifest_cannot_target_settings_or_leave_the_repo(self):
        path = self.repo + "/library/manifest.json"
        good = read(path)
        for field, value in (("installs", [".claude/settings.json"]), ("installs", [".omniharness/library/../../x"]),
                             ("source", "../outside.md")):
            data = json.loads(good)
            next(e for e in data["entries"] if e["kind"] == "template")[field] = value
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            r = self.lib("install", "engineering-checkpoint-template")
            self.assertNotEqual(r.returncode, 0, (field, value, r.stdout))
            self.assertIn("invalid manifest entry", r.stdout + r.stderr)
        self.assert_settings_untouched()

    def test_unknown_entry_is_a_usage_error(self):
        self.assertEqual(self.lib("install", "no-such-entry").returncode, 2)


if __name__ == "__main__":
    unittest.main()
