"""Fake-CLI acceptance for Claude's one-attempt native boundary; no model calls."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from harness import claude_native, native_process
from harness.claude_native import recover_claude_attempt, run_claude_attempt


FAKE_CLI = r'''
import json, os, sys, time
args = sys.argv[1:]
session = args[args.index('--session-id') + 1]
prompt = sys.stdin.read()
if prompt == 'sleep':
    time.sleep(30)
if prompt != 'empty':
    print(json.dumps({'type': 'result', 'subtype': 'success',
                      'session_id': 'wrong-session' if prompt == 'mismatch' else session,
                      'total_cost_usd': 0.05,
                      'modelUsage': {'fixture': {'inputTokens': 10, 'outputTokens': 3,
                                                  'cacheReadInputTokens': 4,
                                                  'cacheCreationInputTokens': 2}}}), flush=True)
print(os.environ.get('OMNIHARNESS_PRIVATE_SENTINEL', 'absent'), file=sys.stderr)
if prompt == 'failed':
    sys.exit(7)
'''


class ClaudeNativeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.worker = self.base / "worker"
        self.worker.mkdir()
        self.evidence = self.base / "evidence"
        script = self.base / "fake_cli.py"
        script.write_text(FAKE_CLI, encoding="utf-8")
        self.fixture_script = script

    def run_fake(self, prompt="answer", attempt="one", **options):
        def fixture_process(command, **kwargs):
            self.assertEqual(command[0], sys.executable)
            self.assertEqual(command.count("--session-id"), 1)
            self.assertNotIn(prompt, command)
            return native_process.run_attempt(
                [sys.executable, "-u", str(self.fixture_script), *command[1:]], **kwargs)
        with patch.object(claude_native, "_preflight_auth"), \
             patch.object(claude_native, "run_attempt", side_effect=fixture_process):
            return run_claude_attempt(sys.executable, prompt, cwd=self.worker,
                                      evidence_root=self.evidence, attempt_id=attempt,
                                      role="implementer", billing_channel=options.pop("billing_channel", "native-allowance"),
                                      timeout=options.pop("timeout", 2), **options)

    def test_fresh_session_stdin_and_whole_tree_receipt(self):
        previous = os.environ.get("OMNIHARNESS_PRIVATE_SENTINEL")
        os.environ["OMNIHARNESS_PRIVATE_SENTINEL"] = "private-value"
        try:
            result = self.run_fake("answer")
        finally:
            if previous is None:
                os.environ.pop("OMNIHARNESS_PRIVATE_SENTINEL", None)
            else:
                os.environ["OMNIHARNESS_PRIVATE_SENTINEL"] = previous
        self.assertEqual(result["process"]["state"], "finished")
        self.assertTrue(result["receipt"]["usage_complete"])
        self.assertTrue(result["receipt"]["process_ok"])
        self.assertEqual(result["receipt"]["total_tokens"], 19)
        self.assertEqual(result["receipt"]["session_id"], result["process"]["identity"]["session_id"])
        self.assertEqual((self.evidence / "one" / "stderr.bin").read_text().strip(), "absent")
        state_text = (self.evidence / "one" / "state.json").read_text(encoding="utf-8")
        self.assertNotIn("answer", state_text)
        self.assertEqual(recover_claude_attempt(self.evidence, "one"), result)

    def test_failure_with_final_result_keeps_measured_tokens(self):
        result = self.run_fake("failed")
        self.assertEqual(result["process"]["exit_code"], 7)
        self.assertFalse(result["receipt"]["process_ok"])
        self.assertTrue(result["receipt"]["usage_complete"])
        self.assertEqual(result["receipt"]["total_tokens"], 19)

    def test_interrupted_state_cannot_be_promoted_by_complete_stream(self):
        result = self.run_fake()
        interrupted = dict(result["process"], state="interrupted", termination="cancel", process_ok=False)
        receipt = claude_native._receipt(self.evidence, "one", interrupted)
        self.assertFalse(receipt["process_ok"])
        self.assertTrue(receipt["usage_complete"])
        self.assertEqual(receipt["total_tokens"], 19)

    def test_misbound_provider_or_role_cannot_claim_whole_tree_usage(self):
        result = self.run_fake()
        for identity in ({**result["process"]["identity"], "provider": "codex"},
                         {**result["process"]["identity"], "role": ""}):
            with self.subTest(identity=identity):
                changed = dict(result["process"], identity=identity)
                receipt = claude_native._receipt(self.evidence, "one", changed)
                self.assertFalse(receipt["usage_complete"])
                self.assertIsNone(receipt["total_tokens"])

    def test_empty_and_timeout_never_become_zero_usage(self):
        empty = self.run_fake("empty")
        self.assertFalse(empty["receipt"]["usage_complete"])
        self.assertIsNone(empty["receipt"]["total_tokens"])
        timed = self.run_fake("sleep", attempt="two", timeout=0.2)
        self.assertEqual(timed["process"]["termination"], "timeout")
        self.assertFalse(timed["receipt"]["usage_complete"])
        self.assertIsNone(timed["receipt"]["total_tokens"])

    def test_wrong_session_and_unsupported_billing_channel_are_rejected(self):
        mismatch = self.run_fake("mismatch")
        self.assertFalse(mismatch["receipt"]["usage_complete"])
        self.assertIsNone(mismatch["receipt"]["total_tokens"])
        with self.assertRaises(ValueError):
            self.run_fake(attempt="two", billing_channel="additional-charge")
        self.assertFalse((self.evidence / "two").exists())
        with self.assertRaises(ValueError):
            run_claude_attempt([sys.executable, "--resume=older"], "x", cwd=self.worker,
                               evidence_root=self.evidence, attempt_id="two", role="reviewer",
                               timeout=2, billing_channel="native-allowance")

    def test_project_settings_require_matching_reviewed_hash(self):
        settings = self.worker / ".claude" / "settings.json"
        settings.parent.mkdir()
        settings.write_text('{"hooks": {}}', encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_fake()
        approved = hashlib.sha256(settings.read_bytes()).hexdigest()
        result = self.run_fake(approved_settings_sha256=approved)
        self.assertTrue(result["receipt"]["usage_complete"])
        settings.write_text('{"hooks": {"changed": []}}', encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_fake(attempt="two", approved_settings_sha256=approved)
        settings.write_text('{broken', encoding="utf-8")
        malformed_hash = hashlib.sha256(settings.read_bytes()).hexdigest()
        with self.assertRaises(ValueError):
            self.run_fake(attempt="three", approved_settings_sha256=malformed_hash)

    def test_project_settings_cannot_redirect_subscription_auth(self):
        settings = self.worker / ".claude" / "settings.json"
        settings.parent.mkdir()
        configurations = (
            {"apiKeyHelper": "echo key"},
            {"env": {"ANTHROPIC_API_KEY": "fixture-key"}},
            {"env": {"ANTHROPIC_AUTH_TOKEN": "fixture-token"}},
            {"env": {"ANTHROPIC_BASE_URL": "https://fixture.invalid"}},
            {"env": {"CLAUDE_CODE_USE_VERTEX": "1"}},
            {"env": {"API_TIMEOUT_MS": "1000"}},
            {"env": []},
        )
        for index, configuration in enumerate(configurations):
            with self.subTest(configuration=configuration):
                settings.write_text(json.dumps(configuration), encoding="utf-8")
                approved = hashlib.sha256(settings.read_bytes()).hexdigest()
                with self.assertRaises(ValueError):
                    self.run_fake(attempt=f"redirect-{index}", approved_settings_sha256=approved)
                self.assertFalse((self.evidence / f"redirect-{index}").exists())

    def test_auth_preflight_rejects_non_subscription_modes_without_launch(self):
        good = {"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty",
                "subscriptionType": "max"}
        with patch.object(claude_native.subprocess, "run",
                          return_value=subprocess.CompletedProcess([], 0, json.dumps(good), "")):
            claude_native._preflight_auth(sys.executable, self.worker, {"PATH": "fixture"})
        for wrong in ({**good, "authMethod": "api-key"},
                      {**good, "apiProvider": "thirdParty"},
                      {**good, "loggedIn": False}):
            with self.subTest(wrong=wrong), patch.object(
                    claude_native.subprocess, "run",
                    return_value=subprocess.CompletedProcess([], 0, json.dumps(wrong), "")):
                with self.assertRaises(ValueError):
                    claude_native._preflight_auth(sys.executable, self.worker, {"PATH": "fixture"})

    def test_stdout_tamper_cannot_recover_as_measured(self):
        self.run_fake()
        stream = self.evidence / "one" / "stdout.bin"
        stream.write_bytes(stream.read_bytes() + b"tamper")
        result = recover_claude_attempt(self.evidence, "one")
        self.assertFalse(result["receipt"]["usage_complete"])
        self.assertIsNone(result["receipt"]["total_tokens"])

    def test_missing_stdout_after_capture_recovers_unknown(self):
        self.run_fake()
        (self.evidence / "one" / "stdout.bin").unlink()
        result = recover_claude_attempt(self.evidence, "one")
        self.assertFalse(result["receipt"]["usage_complete"])
        self.assertIsNone(result["receipt"]["total_tokens"])

    def test_partial_manifest_without_session_recovers_unknown(self):
        attempt = self.evidence / "partial"
        attempt.mkdir(parents=True)
        result = recover_claude_attempt(self.evidence, "partial")
        self.assertEqual(result["process"]["state"], "unknown")
        self.assertFalse(result["receipt"]["usage_complete"])
        self.assertIsNone(result["receipt"]["session_id"])
        self.assertIsNone(result["receipt"]["total_tokens"])
        self.assertEqual(result, recover_claude_attempt(self.evidence, "partial"))


if __name__ == "__main__":
    unittest.main()
