"""Real Git worktrees in disposable repositories; no user-repo commits or cleanup."""
import subprocess
import tempfile
import unittest
from pathlib import Path

from harness.swarm_worktrees import Worktrees


class WorktreeIsolation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init")
        (self.repo / "src").mkdir()
        (self.repo / "src/a.txt").write_text("original\n")
        (self.repo / "src/b.txt").write_text("other\n")
        self.git("add", "src")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.host = Worktrees(self.repo, self.root / "workers")

    def git(self, *args, cwd=None):
        result = subprocess.run(["git", "-c", "core.hooksPath=" + str(self.root / "empty-hooks"), *args], cwd=cwd or self.repo, text=True, encoding="utf-8", capture_output=True, check=True)
        return result.stdout

    def test_distinct_worktrees_do_not_change_the_source_or_each_other(self):
        a = self.host.create("run-a", "a", self.base, ["src/a.txt"])
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.host.create("run-a", "a", self.base, ["src/a.txt"])
        b = self.host.create("run-a", "b", self.base, ["src/b.txt"])
        (Path(a["path"]) / "src/a.txt").write_text("worker a\n")
        (Path(b["path"]) / "src/b.txt").write_text("worker b\n")
        self.assertEqual((self.repo / "src/a.txt").read_text(), "original\n")
        self.assertEqual((Path(b["path"]) / "src/a.txt").read_text(), "original\n")
        report = self.host.audit(a)
        self.assertTrue(report["scope_ok"])
        self.assertEqual(report["changed_files"], ["src/a.txt"])
        self.assertEqual(report["isolation"], "git-worktree-only")
        self.assertFalse(report["os_sandbox_verified"])
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_untracked_ignored_and_renamed_paths_are_all_checked(self):
        a = self.host.create("run-b", "a", self.base, ["src/a.txt"])
        path = Path(a["path"])
        (path / "outside.txt").write_text("escape")
        (path / ".gitignore").write_text("ignored.txt\n")
        (path / "ignored.txt").write_text("ignored is still a change")
        self.git("mv", "src/a.txt", "renamed.txt", cwd=path)
        report = self.host.audit(a)
        self.assertFalse(report["scope_ok"])
        self.assertTrue({"outside.txt", "ignored.txt", "renamed.txt", ".gitignore"} <= set(report["violations"]))
        self.assertIn("src/a.txt", report["changed_files"])

    def test_dirty_source_duplicate_paths_and_escaping_scopes_are_refused(self):
        for scope in ("../outside/**", ".git/config", ".agents/skills/x/SKILL.md", "AGENTS.md"):
            with self.assertRaisesRegex(ValueError, "scope"):
                self.host.create("bad", "task", self.base, [scope])
        (self.repo / "uncommitted.txt").write_text("owner work")
        with self.assertRaisesRegex(ValueError, "clean"):
            self.host.create("run", "task", self.base, ["src/**"])
        self.assertEqual((self.repo / "uncommitted.txt").read_text(), "owner work")

    def test_directory_scope_does_not_allow_nested_policy_files(self):
        a = self.host.create("policy", "a", self.base, ["src/**"])
        (Path(a["path"]) / "src/AGENTS.md").write_text("untrusted policy")
        self.assertEqual(self.host.audit(a)["violations"], ["src/AGENTS.md"])

    def test_staged_violation_is_not_hidden_by_restoring_the_working_file(self):
        a = self.host.create("staged", "a", self.base, ["src/a.txt"])
        path = Path(a["path"])
        (path / "src/b.txt").write_text("staged outside scope\n")
        self.git("add", "src/b.txt", cwd=path)
        (path / "src/b.txt").write_text("other\n")
        self.assertEqual(self.host.audit(a)["violations"], ["src/b.txt"])

    def test_committed_changes_are_checked_against_pinned_base(self):
        a = self.host.create("run-c", "a", self.base, ["src/a.txt"])
        path = Path(a["path"])
        (path / "src/b.txt").write_text("wrong scope")
        self.git("add", "src/b.txt", cwd=path)
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "bad fixture", cwd=path)
        self.assertFalse(self.host.audit(a)["scope_ok"])
        forged = {**a, "path": str(self.repo)}
        with self.assertRaises(ValueError):
            self.host.audit(forged)
