"""Pillar 4 practice challenge: executable verifier and persistent member progress (harness/challenges.py).

Progress always goes to a temp OMNIFORGE_DATA_DIR; the owner's data folders are never read or written.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
sys.path.insert(0, REPO + "/harness")
import challenges  # noqa: E402

CLI = REPO + "/harness/challenges.py"
CH = REPO + "/challenges/paginate-bug"
POSITIVE, NEGATIVE, STARTER = CH + "/submissions/positive.py", CH + "/submissions/negative.py", CH + "/starter.py"


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def cli(*args, env=None):
    return subprocess.run([sys.executable, CLI, *args], capture_output=True, text=True, encoding="utf-8", env=env)


class Verify(unittest.TestCase):
    def test_positive_passes_with_hashes(self):
        v = challenges.verify("paginate-bug", POSITIVE)
        self.assertEqual(v["verdict"], "PASS", v)
        self.assertGreater(v["testsRun"], 0)
        self.assertEqual((v["challenge"], v["version"]), ("paginate-bug", 1))
        self.assertEqual(v["submissionSha256"], sha(POSITIVE))
        self.assertRegex(v["verifierSha256"], "^[0-9a-f]{64}$")

    def test_negative_and_unchanged_starter_fail(self):
        for path in (NEGATIVE, STARTER):
            v = challenges.verify("paginate-bug", path)
            self.assertEqual(v["verdict"], "FAIL", (path, v))
            self.assertIn("failed", v["reason"], v)

    def test_timeout_crash_and_early_exit_are_fail_not_pass(self):
        cases = {"loop": "while True:\n    pass\n", "os_exit": "import os\nos._exit(0)\n",
                 "system_exit": "raise SystemExit(0)\n", "syntax": "def paginate(:\n", "empty": ""}
        with tempfile.TemporaryDirectory() as d:
            for name, src in cases.items():
                path = os.path.join(d, name + ".py")
                with open(path, "w", encoding="utf-8") as f:
                    f.write(src)
                v = challenges.verify("paginate-bug", path, timeout=3)
                self.assertEqual(v["verdict"], "FAIL", (name, v))
                if name == "loop":
                    self.assertIn("timeout", v["reason"])

    def test_a_tampering_submission_can_forge_pass_so_no_doc_promises_otherwise(self):
        # The submission runs inside the suite's process and can write the result file itself. Until V-04 isolates
        # it, PASS trusts the submission not to tamper. If this forge ever FAILs, isolation landed: update the docs.
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "mod.py")
            with open(path, "w", encoding="utf-8") as f:
                f.write('import json, os, sys\njson.dump({"ran": 7, "bad": 0}, open(sys.argv[1], "w"))\nos._exit(0)\n')
            self.assertEqual(challenges.verify("paginate-bug", path)["verdict"], "PASS")
        texts = {"harness/challenges.py": challenges.__doc__}
        for rel in ("docs/omniforge/PILLAR-4-LIBRARY.md", "challenges/paginate-bug/README.md"):
            with open(REPO + "/" + rel, encoding="utf-8") as f:
                texts[rel] = f.read().replace("`", "")
        for where, text in texts.items():
            self.assertIn("tamper", text, where)
            for overclaim in ("never PASS", "suite's own result"):
                self.assertNotIn(overclaim, text, where)

    def test_caller_environment_does_not_reach_the_submission(self):
        with open(POSITIVE, encoding="utf-8") as f:
            src = 'import os\nassert "OMNIFORGE_TEST_TOKEN" not in os.environ\n' + f.read()
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"OMNIFORGE_TEST_TOKEN": "secret"}):
            path = os.path.join(d, "mod.py")
            with open(path, "w", encoding="utf-8") as f:
                f.write(src)
            v = challenges.verify("paginate-bug", path)
        self.assertEqual(v["verdict"], "PASS", v)

    def test_cli_prints_verdict_and_exit_code(self):
        r = cli("verify", "paginate-bug", POSITIVE)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(json.loads(r.stdout)["verdict"], "PASS")
        r = cli("verify", "paginate-bug", NEGATIVE)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertEqual(json.loads(r.stdout)["verdict"], "FAIL")

    def test_unknown_or_traversing_challenge_is_rejected(self):
        for name in ("no-such-challenge", "../evals", "Paginate-Bug"):
            self.assertEqual(cli("verify", name, POSITIVE).returncode, 2, name)


class Progress(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp(prefix="omni-progress-")
        self.env = dict(os.environ, OMNIFORGE_DATA_DIR=self.data)
        self.file = os.path.join(self.data, "progress", "local-owner.json")
        patcher = mock.patch.dict(os.environ, {"OMNIFORGE_DATA_DIR": self.data})
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        shutil.rmtree(self.data)

    def load(self):
        with open(self.file, encoding="utf-8") as f:
            return json.load(f)

    def test_a_lock_being_deleted_on_windows_is_busy_not_an_error(self):
        # Windows answers an exclusive create of a file another writer is deleting with access denied, not "exists".
        real_open, denied = os.open, []

        def open_(path, *args, **kwargs):
            if str(path).endswith(".lock") and not denied:
                denied.append(path)
                raise PermissionError(13, "Access is denied", path)
            return real_open(path, *args, **kwargs)

        with mock.patch.object(challenges.os, "open", side_effect=open_):
            if os.name == "nt":
                with challenges.locked(self.file):
                    pass
                self.assertEqual(len(denied), 1, "the writer retried after the transient denial")
            else:
                with self.assertRaises(PermissionError):
                    with challenges.locked(self.file):
                        pass

    def test_default_location_is_localappdata(self):
        with mock.patch.dict(os.environ, {"LOCALAPPDATA": self.data}):
            del os.environ["OMNIFORGE_DATA_DIR"]
            self.assertEqual(os.path.normpath(challenges.progress_path("local-owner")),
                             os.path.normpath(os.path.join(self.data, "OmniForge", "data", "progress", "local-owner.json")))

    def test_progress_survives_a_restart(self):
        r = cli("progress", "record", "paginate-bug", POSITIVE, env=self.env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        saved = self.load()
        self.assertEqual((saved["member"], saved["revision"]), ("local-owner", 1))
        attempt = saved["challenges"]["paginate-bug"][0]
        self.assertEqual((attempt["version"], attempt["verdict"]), (1, "PASS"))
        self.assertEqual(attempt["submissionSha256"], sha(POSITIVE))
        self.assertTrue(attempt["recordedAt"].endswith("+00:00"), attempt)
        shown = cli("progress", "show", env=self.env)  # a new process reads what the first one wrote
        self.assertEqual(shown.returncode, 0, shown.stderr)
        self.assertIn("paginate-bug: completed v1", shown.stdout)
        self.assertIn("revision 1", shown.stdout)

    def test_failed_attempt_is_recorded_but_not_completed(self):
        r = cli("progress", "record", "paginate-bug", NEGATIVE, "--member", "ana", env=self.env)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        shown = cli("progress", "show", "--member", "ana", env=self.env)
        self.assertIn("paginate-bug: not completed", shown.stdout)
        self.assertFalse(os.path.exists(self.file), "another member's file was written")

    def test_stale_revision_cannot_overwrite(self):
        challenges.record("paginate-bug", POSITIVE, expected_revision=0)
        with self.assertRaises(challenges.Conflict):
            challenges.record("paginate-bug", NEGATIVE, expected_revision=0)
        r = cli("progress", "record", "paginate-bug", NEGATIVE, "--expected-revision", "0", env=self.env)
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        saved = self.load()
        self.assertEqual(saved["revision"], 1)
        self.assertEqual([a["verdict"] for a in saved["challenges"]["paginate-bug"]], ["PASS"])

    def test_concurrent_writers_never_lose_an_update(self):
        procs = [subprocess.Popen([sys.executable, CLI, "progress", "record", "paginate-bug", NEGATIVE],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env) for _ in range(4)]
        errors = [p.communicate(timeout=120)[1] for p in procs]
        codes = [p.returncode for p in procs]
        self.assertTrue(set(codes) <= {1, 3}, (codes, errors))  # 1 = recorded FAIL verdict, 3 = conflict, nothing written
        saved = self.load()
        written = codes.count(1)
        self.assertGreaterEqual(written, 1)
        self.assertEqual(saved["revision"], written)
        self.assertEqual(len(saved["challenges"]["paginate-bug"]), written)

    def test_corrupt_progress_is_never_overwritten(self):
        os.makedirs(os.path.dirname(self.file))
        with open(self.file, "w", encoding="utf-8") as f:
            f.write("{not json")
        r = cli("progress", "record", "paginate-bug", POSITIVE, env=self.env)
        self.assertNotIn(r.returncode, (0, 1), r.stdout + r.stderr)
        with open(self.file, encoding="utf-8") as f:
            self.assertEqual(f.read(), "{not json")

    def test_invalid_member_is_rejected(self):
        for member in ("../x", "Owner", "a.b", ""):
            self.assertEqual(cli("progress", "show", "--member", member, env=self.env).returncode, 2, member)


if __name__ == "__main__":
    unittest.main()
