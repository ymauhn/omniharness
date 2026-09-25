"""Offline fixtures for the native Windows sandbox acceptance command."""
import hashlib
import json
import os
import shutil
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

from harness import codex_windows_probe as probe


class CodexWindowsProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.cli = root / "codex.exe"
        self.powershell = root / "powershell.exe"
        self.cli.write_bytes(b"synthetic executable path")
        self.powershell.write_bytes(b"synthetic executable path")
        windows = patch.object(probe, "_native_windows", return_value=True)
        windows.start()
        self.addCleanup(windows.stop)

    def _run(self, *, child_override=None, state="finished", code=0, stderr=b"",
             change_host=None, marker=True):
        seen = {}

        def runner(command, **kwargs):
            seen.update(command=command, kwargs=kwargs)
            worker = Path(kwargs["cwd"])
            root = worker.parent
            nonce = command[-6]
            self.assertEqual(command[:3], [str(self.cli.resolve()), "sandbox", "-P"])
            self.assertEqual(command[3:9], ["worker-probe", "-C", str(worker),
                                            "--include-managed-config", "--", str(self.powershell.resolve())])
            self.assertNotIn("--sandbox", command)
            self.assertNotIn("exec", command)
            self.assertEqual(command[-5:], [str(root / name) for name in
                                            ("worker", "sibling", "home", "coordinator", "codex-home")])
            config = (root / "codex-home" / "config.toml").read_text(encoding="utf-8")
            self.assertIn('sandbox = "unelevated"', config)
            self.assertIn('":root" = "deny"', config)
            self.assertIn('":minimal" = "read"', config)
            self.assertIn(f'{json.dumps(str(worker))} = "write"', config)
            self.assertIn('enabled = false', config)
            self.assertNotIn("extends", config)
            parsed = tomllib.loads(config)
            self.assertEqual(parsed["permissions"]["worker-probe"]["filesystem"][str(worker)], "write")
            self.assertEqual(kwargs["env"]["CODEX_HOME"], str(root / "codex-home"))
            self.assertEqual(kwargs["env"]["USERPROFILE"], str(root / "home"))
            self.assertEqual(kwargs["env"]["TEMP"], str(worker / "tmp"))
            self.assertEqual(kwargs["timeout"], 20)
            self.assertEqual(kwargs["identity"], {"provider": "codex", "role": "sandbox_probe"})
            for name in (".sandbox", "tmp"):
                setup = root / "codex-home" / name
                self.assertTrue(setup.is_dir())
                self.assertTrue((setup / "sentinel.txt").is_file())
            if marker:
                (worker / "own.marker").write_text("escape probe", encoding="utf-8")
            if change_host:
                change_host(root)
            checks = {key: True for key in probe._CHILD_CHECKS}
            if isinstance(child_override, dict):
                checks.update(child_override)
            output = (json.dumps({"schema_version": 1, "nonce": nonce, "checks": checks}).encode()
                      if child_override != "malformed" else b"not json")
            if child_override == "missing":
                output = b""
            capture = Path(kwargs["evidence_root"]) / kwargs["attempt_id"]
            capture.mkdir(parents=True)
            (capture / "stdout.bin").write_bytes(output)
            (capture / "stderr.bin").write_bytes(stderr)
            return {"state": state, "exit_code": code, "process_ok": state == "finished" and code == 0,
                    "termination": "timeout" if state == "unknown" else None,
                    "issues": ["tree stop unconfirmed"] if state == "unknown" else [],
                    "stdout_bytes": len(output), "stdout_sha256": hashlib.sha256(output).hexdigest(),
                    "stderr_bytes": len(stderr), "stderr_sha256": hashlib.sha256(stderr).hexdigest()}

        with patch.object(probe, "run_attempt", side_effect=runner):
            result = probe.probe(self.cli, self.powershell)
        return result, seen

    def test_exact_command_and_synthetic_host_evidence_pass(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "private", "CODEX_API_KEY": "private"}):
            result, seen = self._run()
        self.assertTrue(result["passed"])
        self.assertEqual(result["status"], "passed")
        self.assertEqual(set(result["checks"]), set(probe._ALL_CHECKS))
        self.assertTrue(all(value is True for value in result["checks"].values()))
        self.assertNotIn("OPENAI_API_KEY", seen["kwargs"]["env"])
        self.assertNotIn("CODEX_API_KEY", seen["kwargs"]["env"])
        self.assertEqual(result["backend"], "codex-windows-unelevated")

    def test_reported_read_escape_fails_even_if_process_is_zero(self):
        result, _ = self._run(child_override={"sibling_read_denied": False})
        self.assertFalse(result["passed"])
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["checks"]["sibling_read_denied"])

    def test_host_side_sibling_mutation_fails_despite_forged_success(self):
        result, _ = self._run(change_host=lambda root: (root / "sibling" / "attempt.marker").write_text("escape"))
        self.assertFalse(result["passed"])
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["checks"]["host_artifacts_unchanged"])
        self.assertEqual(result["synthetic_changes"], ["sibling/attempt.marker:added"])
        self.assertEqual(result["host_change_class"], "forbidden-attempt-marker")

    def test_launcher_mutation_without_child_report_is_inconclusive(self):
        result, _ = self._run(child_override="missing", marker=False,
                              change_host=lambda root: (root / "home" / "launcher-alias").write_text("setup"))
        self.assertFalse(result["passed"])
        self.assertEqual(result["status"], "inconclusive")
        self.assertEqual(result["synthetic_changes"], ["home/launcher-alias:added"])
        self.assertEqual(result["host_change_class"], "launcher-or-unattributed")

    def test_existing_codex_home_probe_dirs_are_audited(self):
        result, _ = self._run()
        self.assertTrue(result["passed"])
        self.assertTrue(result["checks"]["host_artifacts_unchanged"])
        self.assertEqual(result["host_change_class"], "none")
        self.assertEqual(result["synthetic_changes"], [])

    def test_childless_launcher_change_is_inconclusive(self):
        def setup(root):
            (root / "codex-home" / ".sandbox" / "launcher.tmp").write_text("setup")
        result, _ = self._run(child_override="missing", marker=False, change_host=setup)
        self.assertFalse(result["passed"])
        self.assertEqual(result["status"], "inconclusive")
        self.assertEqual(result["host_change_class"], "launcher-or-unattributed")

    def test_missing_codex_home_probe_dir_cannot_pass(self):
        for name in (".sandbox", "tmp"):
            with self.subTest(name=name):
                result, _ = self._run(change_host=lambda root: shutil.rmtree(root / "codex-home" / name))
                self.assertFalse(result["passed"])
                self.assertEqual(result["status"], "failed")
                self.assertFalse(result["checks"]["host_artifacts_unchanged"])

    def test_worker_marker_inside_launcher_setup_is_a_failure(self):
        def escape(root):
            setup = root / "codex-home" / ".sandbox"
            (setup / "attempt.marker").write_text("escape")
        result, _ = self._run(child_override="missing", marker=False, change_host=escape)
        self.assertFalse(result["passed"])
        self.assertEqual(result["status"], "failed")
        self.assertIn("codex-home/.sandbox/attempt.marker:added", result["synthetic_changes"])

    def test_attempt_marker_without_child_report_still_demonstrates_escape(self):
        result, _ = self._run(child_override="missing", marker=False,
                              change_host=lambda root: (root / "coordinator" / "attempt.marker").write_text("escape"))
        self.assertFalse(result["passed"])
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["host_change_class"], "forbidden-attempt-marker")

    def test_refusal_timeout_or_stderr_never_passes(self):
        for options in ({"state": "launch_failed", "code": None, "marker": False},
                        {"state": "unknown", "code": None},
                        {"stderr": b"sandbox warning"}):
            with self.subTest(options=options):
                result, _ = self._run(**options)
                self.assertFalse(result["passed"])
                self.assertEqual(result["status"], "inconclusive")

    def test_stderr_diagnostic_is_bounded_and_contains_no_raw_path(self):
        raw = b"Error: permission profile at C:\\Users\\Private\\secret-key.txt was refused"
        result, _ = self._run(child_override="missing", marker=False, stderr=raw)
        self.assertFalse(result["passed"])
        self.assertEqual(result["stderr_diagnostic"]["kind"], "profile-rejected")
        self.assertEqual(result["stderr_diagnostic"]["bytes"], len(raw))
        self.assertNotIn("Private", json.dumps(result))
        self.assertNotIn("secret-key", json.dumps(result))
        self.assertEqual(probe._stderr_diagnostic(b"windows sandbox failed: no home dir\n")["kind"],
                         "home-unavailable")
        self.assertEqual(probe._stderr_diagnostic(
            b"Restricted read-only access requires the elevated Windows sandbox backend\n")["kind"],
            "elevated-backend-required")

    def test_missing_or_malformed_child_report_is_inconclusive(self):
        for value in ("missing", "malformed"):
            with self.subTest(value=value):
                result, _ = self._run(child_override=value)
                self.assertFalse(result["passed"])
                self.assertEqual(result["status"], "inconclusive")
                self.assertIsNone(result["checks"]["worker_read"])

    def test_child_report_rejects_duplicate_keys_wrong_nonce_and_nonboolean(self):
        checks = {key: True for key in probe._CHILD_CHECKS}
        valid = {"schema_version": 1, "nonce": "abc", "checks": checks}
        self.assertEqual(probe._child_report(json.dumps(valid).encode(), "abc"), checks)
        self.assertIsNone(probe._child_report(json.dumps(valid).encode(), "other"))
        checks["worker_read"] = 1
        self.assertIsNone(probe._child_report(json.dumps(valid).encode(), "abc"))
        self.assertIsNone(probe._child_report(b'{"schema_version":1,"schema_version":1}', "abc"))

    def test_invalid_inputs_fail_before_launch(self):
        with patch.object(probe, "run_attempt") as runner:
            with self.assertRaises(ValueError):
                probe.probe(self.cli, self.powershell, timeout=31)
            with self.assertRaises(ValueError):
                probe.probe(self.cli.with_suffix(".cmd"), self.powershell)
            runner.assert_not_called()

    def test_cli_exit_code_is_failure_on_refusal(self):
        with patch.object(probe, "probe", side_effect=ValueError("synthetic refusal")):
            with patch("builtins.print") as printer:
                exit_code = probe.main(["--codex", str(self.cli), "--powershell", str(self.powershell)])
        self.assertEqual(exit_code, 1)
        report = json.loads(printer.call_args.args[0])
        self.assertFalse(report["passed"])
        self.assertEqual(report["status"], "inconclusive")
        self.assertEqual(set(report["checks"]), set(probe._ALL_CHECKS))
        self.assertIsNone(report["stderr_diagnostic"])
        self.assertEqual(report["synthetic_changes"], [])


if __name__ == "__main__":
    unittest.main()
