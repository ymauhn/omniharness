"""Offline Codex exec JSONL and fake-CLI acceptance; no model calls."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import harness.codex_exec as codex_exec
from harness.codex_exec import (recover_codex_attempt, run_codex_attempt,
                                usage_from_codex_exec_jsonl)


FAKE_CLI = r'''
import json, os, sys, time
args = sys.argv[1:]
assert args[:1] == ['exec'] and '--json' in args and '--ephemeral' in args
assert args[-1] == '-' and args[args.index('-C') + 1] == os.getcwd()
prompt = sys.stdin.read()
print(json.dumps({'type': 'thread.started', 'thread_id': 'thread-fixture'}), flush=True)
print(json.dumps({'type': 'turn.started'}), flush=True)
if prompt in ('sleep', 'cancel'):
    time.sleep(30)
if prompt == 'malformed':
    print('{broken', flush=True)
    sys.exit(0)
if prompt == 'second-thread':
    print(json.dumps({'type': 'thread.started', 'thread_id': 'thread-other'}), flush=True)
if prompt != 'failed':
    print(json.dumps({'type': 'item.completed', 'item': {
        'id': 'item-final', 'type': 'agent_message',
        'text': '' if prompt == 'empty' else 'done'}}), flush=True)
terminal = {'type': 'turn.failed'} if prompt == 'failed' else {
    'type': 'turn.completed', 'usage': {
        'input_tokens': 10, 'cached_input_tokens': 4,
        'output_tokens': 3, 'reasoning_output_tokens': 1,
        'cache_write_input_tokens': 2}}
print(json.dumps(terminal), flush=True)
if prompt == 'duplicate':
    print(json.dumps(terminal), flush=True)
print('key-present' if 'CODEX_API_KEY' in os.environ else 'key-absent', file=sys.stderr)
if prompt == 'exit7':
    sys.exit(7)
'''


class CodexExecTests(unittest.TestCase):
    def setUp(self):
        # Canonical: the harness works on resolved paths, and TEMP may be an 8.3 or junction spelling of one.
        temp = tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name)
        self.worker = self.base / "worker"
        self.worker.mkdir()
        self.evidence = self.base / "evidence"
        script = self.base / "fake_codex.py"
        script.write_text(FAKE_CLI, encoding="utf-8")
        self.cli = str(Path(sys.executable).resolve())
        self.script = script

    def run_fake(self, prompt="ok", attempt="one", **options):
        actual_run = codex_exec.run_attempt
        launched_env = None
        def launch_fake(command, **kwargs):
            nonlocal launched_env
            self.assertEqual(command, [self.cli, "exec", "--json", "--ephemeral",
                                       "--ignore-user-config", "-c", 'model_provider="openai"',
                                       "--sandbox", "workspace-write", "-C",
                                       str(self.worker), "-"])
            launched_env = kwargs["env"]
            return actual_run([self.cli, "-u", str(self.script), *command[1:]], **kwargs)
        with patch.object(codex_exec, "_preflight_auth") as auth:
            with patch.object(codex_exec, "run_attempt", side_effect=launch_fake):
                result = run_codex_attempt(
                    self.cli, prompt, cwd=self.worker, evidence_root=self.evidence,
                    attempt_id=attempt, role="implementer", timeout=options.pop("timeout", 2),
                    billing_channel=options.pop("billing_channel", "native-allowance"),
                    **options)
            if result:
                auth.assert_called_once()
                self.assertEqual(auth.call_args.args[0], self.cli)
                self.assertEqual(auth.call_args.args[1], self.worker)
                self.assertIs(auth.call_args.args[2], launched_env)
        return result

    def test_fresh_stdin_jsonl_has_bound_observation_but_unknown_tree_total(self):
        old = os.environ.get("CODEX_API_KEY")
        os.environ["CODEX_API_KEY"] = "test-do-not-forward"
        try:
            result = self.run_fake("private prompt phrase")
        finally:
            if old is None:
                os.environ.pop("CODEX_API_KEY", None)
            else:
                os.environ["CODEX_API_KEY"] = old
        process, receipt = result["process"], result["receipt"]
        self.assertEqual(process["state"], "finished")
        self.assertEqual(process["exit_code"], 0)
        self.assertEqual(receipt["thread_id"], "thread-fixture")
        self.assertEqual(receipt["source_sha256"], process["stdout_sha256"])
        self.assertTrue(receipt["usage_observed"])
        self.assertEqual(receipt["observed_turn_tokens"], 13)
        self.assertEqual(receipt["observed_token_categories"]["cached_input_tokens"], 4)
        self.assertEqual(receipt["observed_token_categories"]["cache_write_input_tokens"], 2)
        self.assertIsNone(receipt["total_tokens"])
        self.assertFalse(receipt["usage_complete"])
        self.assertTrue(receipt["execution_valid"])
        self.assertIsNone(receipt["task_pass"])
        self.assertEqual((self.evidence / "one" / "stderr.bin").read_text().strip(), "key-absent")
        self.assertNotIn("private prompt phrase", (self.evidence / "one" / "state.json").read_text())
        self.assertEqual(result, recover_codex_attempt(self.evidence, "one"))

    def test_empty_answer_and_nonzero_exit_keep_tokens_without_task_pass(self):
        empty = self.run_fake("empty")
        self.assertEqual(empty["receipt"]["observed_turn_tokens"], 13)
        self.assertTrue(empty["receipt"]["execution_valid"])
        self.assertFalse(empty["receipt"]["response_nonempty"])
        self.assertFalse(empty["receipt"]["task_pass"])
        failed = self.run_fake("exit7", attempt="two")
        self.assertEqual(failed["receipt"]["observed_turn_tokens"], 13)
        self.assertFalse(failed["receipt"]["execution_valid"])
        self.assertFalse(failed["receipt"]["task_pass"])

    def test_interrupted_state_cannot_be_promoted_by_complete_stream(self):
        result = self.run_fake()
        interrupted = dict(result["process"], state="interrupted", termination="cancel", process_ok=False)
        receipt = codex_exec._receipt(self.evidence, "one", interrupted)
        self.assertFalse(receipt["process_ok"])
        self.assertFalse(receipt["execution_valid"])
        self.assertFalse(receipt["task_pass"])
        self.assertEqual(receipt["observed_turn_tokens"], 13)

    def test_failed_malformed_duplicate_and_second_thread_cannot_pass(self):
        for prompt in ("failed", "malformed", "duplicate", "second-thread"):
            with self.subTest(prompt=prompt):
                result = self.run_fake(prompt, attempt=prompt)
                receipt = result["receipt"]
                self.assertFalse(receipt["execution_valid"])
                self.assertFalse(receipt["task_pass"])
                self.assertIsNone(receipt["total_tokens"])
                self.assertFalse(receipt["usage_complete"])

    def test_timeout_and_cancel_leave_unknown_usage(self):
        timed = self.run_fake("sleep", timeout=0.2)
        self.assertEqual(timed["process"]["termination"], "timeout")
        self.assertFalse(timed["receipt"]["usage_observed"])
        self.assertFalse(timed["receipt"]["task_pass"])
        cancelled = threading.Event()
        timer = threading.Timer(0.2, cancelled.set)
        timer.start()
        try:
            stopped = self.run_fake("cancel", attempt="two", cancel_event=cancelled)
        finally:
            timer.cancel()
        self.assertEqual(stopped["process"]["termination"], "cancel")
        self.assertFalse(stopped["receipt"]["usage_observed"])
        self.assertFalse(stopped["receipt"]["task_pass"])

    def test_recovery_and_tamper_preserve_uncertainty(self):
        self.run_fake()
        source = self.evidence / "one" / "stdout.bin"
        source.write_bytes(source.read_bytes() + b"tamper")
        recovered = recover_codex_attempt(self.evidence, "one")
        self.assertFalse(recovered["receipt"]["usage_observed"])
        self.assertFalse(recovered["receipt"]["task_pass"])
        orphan = self.evidence / "orphan"
        orphan.mkdir()
        (orphan / "state.json").write_text(json.dumps({
            "schema_version": 1, "attempt_id": "orphan", "state": "running",
            "identity": {"provider": "codex", "role": "reviewer"},
            "exit_code": None, "stdout_sha256": None, "stdout_bytes": None}), encoding="utf-8")
        unknown = recover_codex_attempt(self.evidence, "orphan")
        self.assertEqual(unknown["process"]["state"], "unknown")
        self.assertFalse(unknown["receipt"]["usage_observed"])
        self.assertFalse(unknown["receipt"]["task_pass"])

    def test_invalid_channel_or_prompt_rejected_before_launch(self):
        with self.assertRaises(ValueError):
            self.run_fake(billing_channel="additional-charge")
        with self.assertRaises(ValueError):
            self.run_fake(prompt=" ")
        with self.assertRaises(ValueError):
            run_codex_attempt([self.cli, "-cmodel_provider=api"], "ok",
                              cwd=self.worker, evidence_root=self.evidence,
                              attempt_id="override", role="implementer", timeout=2,
                              billing_channel="native-allowance")
        if os.name == "nt":
            batch = self.base / "codex.cmd"
            batch.write_text("echo unsafe", encoding="utf-8")
            with self.assertRaises(ValueError):
                run_codex_attempt(str(batch), "ok", cwd=self.worker,
                                  evidence_root=self.evidence, attempt_id="batch",
                                  role="reviewer", timeout=2,
                                  billing_channel="native-allowance")
        self.assertFalse(self.evidence.exists())

    def test_preflight_requires_exact_chatgpt_login_and_scrubbed_environment(self):
        env = {"PATH": "test"}
        success = subprocess.CompletedProcess([], 0, "Logged in using ChatGPT\n", "")
        with patch.object(codex_exec.subprocess, "run", return_value=success) as run:
            codex_exec._preflight_auth(self.cli, self.worker, env)
            self.assertEqual(run.call_args.args[0], [self.cli, "login", "status"])
            self.assertEqual(run.call_args.kwargs["env"], env)
            self.assertEqual(run.call_args.kwargs["cwd"], self.worker)
            self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        with patch.object(codex_exec.subprocess, "run", return_value=subprocess.CompletedProcess(
                [], 0, "", "Logged in using ChatGPT\n")):
            codex_exec._preflight_auth(self.cli, self.worker, env)
        for status in (subprocess.CompletedProcess([], 0, "Logged in using API key\n", "secret"),
                       subprocess.CompletedProcess([], 7, "Logged in using ChatGPT\n", "secret"),
                       subprocess.CompletedProcess([], 0, "extra\nLogged in using ChatGPT\n", "")):
            with self.subTest(status=status.returncode, output=status.stdout):
                with patch.object(codex_exec.subprocess, "run", return_value=status):
                    with self.assertRaises(ValueError) as failure:
                        codex_exec._preflight_auth(self.cli, self.worker, env)
                    self.assertNotIn("secret", str(failure.exception))
        with patch.object(codex_exec.subprocess, "run", side_effect=OSError("secret")):
            with self.assertRaises(ValueError) as failure:
                codex_exec._preflight_auth(self.cli, self.worker, env)
            self.assertNotIn("secret", str(failure.exception))

    def test_parser_refuses_overlapping_subset_inflation_and_duplicate_keys(self):
        lines = [
            {"type": "thread.started", "thread_id": "thr"},
            {"type": "turn.started"},
            {"type": "item.completed", "item": {"type": "agent_message", "text": "ok"}},
            {"type": "turn.completed", "usage": {"input_tokens": 10, "cached_input_tokens": 11,
                                                 "output_tokens": 3, "reasoning_output_tokens": 1}},
        ]
        with self.assertRaises(ValueError):
            usage_from_codex_exec_jsonl("\n".join(json.dumps(e) for e in lines).encode(), exit_code=0)
        lines[-1]["usage"]["cached_input_tokens"] = 4
        good = usage_from_codex_exec_jsonl("\n".join(json.dumps(e) for e in lines).encode(), exit_code=0)
        self.assertEqual(good["observed_turn_tokens"], 13)
        self.assertIsNone(good["observed_token_categories"]["cache_write_input_tokens"])
        self.assertIsNone(good["total_tokens"])
        lines[-1]["usage"]["cache_write_input_tokens"] = 11
        with self.assertRaises(ValueError):
            usage_from_codex_exec_jsonl("\n".join(json.dumps(e) for e in lines).encode(), exit_code=0)
        lines[-1]["usage"].pop("cache_write_input_tokens")
        bad = (b'{"type":"thread.started","thread_id":"thr","thread_id":"other"}\n'
               + "\n".join(json.dumps(e) for e in lines[1:]).encode())
        with self.assertRaises(ValueError):
            usage_from_codex_exec_jsonl(bad, exit_code=0)


if __name__ == "__main__":
    unittest.main()
