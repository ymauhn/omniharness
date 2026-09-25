"""Offline protocol/adversarial checks, not a classifier quality evaluation."""
from dataclasses import asdict
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from harness import prompt_classifier as pc


CANDIDATES = [pc.Candidate("source:review", "Review code for correctness"),
              pc.Candidate("source:commit", "Create a Git commit")]


def response(choice="source:review", probabilities=None, *, fits=(0.9, 0.1), usage=True):
    value = {"model": pc.JEV_MODEL, "answers": {
        "selection": {"type": "choice", "choice": choice,
                      "probabilities": probabilities or {"source:review": 0.8, "source:commit": 0.1, pc.NONE: 0.1},
                      "confidence": 0.8},
        "fit_0": {"type": "noul", "noul": fits[0]},
        "fit_1": {"type": "noul", "noul": fits[1]},
    }}
    if usage:
        value["usage"] = {"input_tokens": 120, "output_tokens": 17}
    return json.dumps(value).encode()


class PromptClassifierTests(unittest.TestCase):
    def select(self, raw=None, **kwargs):
        return pc.select_jev("Revise o código", CANDIDATES, enabled=True,
                             api_key="caller-key", transport=lambda *args: raw or response(), **kwargs)

    def test_positive_typed_selection_is_not_execution_authority(self):
        calls = []
        def transport(*args):
            calls.append(args)
            return response()
        result = pc.select_jev("Revise o código", CANDIDATES, enabled=True,
                               api_key="caller-key", transport=transport)
        self.assertEqual(result.source_id, "source:review")
        self.assertEqual(result.reason, "selected")
        self.assertFalse(result.runnable)
        self.assertEqual(asdict(result.usage), {"input_tokens": 120, "output_tokens": 17})
        self.assertEqual(len(calls), 1)

    def test_opt_in_and_key_are_required_before_any_transport_or_environment_access(self):
        transport = Mock(side_effect=AssertionError("No outbound request allowed"))
        for enabled, key, reason in [(False, "key", "disabled"), (1, "key", "disabled"),
                                     (True, None, "missing_key"), (True, "x\r\nInjected: yes", "missing_key")]:
            with self.subTest(enabled=enabled, reason=reason), patch.dict("os.environ", {"TYPESAFE_API_KEY": "do-not-discover"}):
                result = pc.select_jev("text", CANDIDATES, enabled=enabled, api_key=key, transport=transport)
                self.assertEqual(result.reason, reason)
                self.assertIsNone(result.usage.input_tokens)
        transport.assert_not_called()

    def test_request_contains_only_bounded_excerpt_and_shortlist_with_key_outside_json(self):
        calls = []
        pc.select_jev("Revise o código", CANDIDATES, enabled=True, api_key="SECRET_CALLER_KEY",
                      transport=lambda *args: calls.append(args) or response())
        body, key, timeout, maximum = calls[0]
        payload = json.loads(body)
        self.assertEqual(set(payload), {"state", "questions", "model"})
        self.assertEqual(payload["state"], "Revise o código")
        self.assertEqual(payload["model"], "jev-1.13.0")
        self.assertEqual(set(payload["questions"]), {"selection", "fit_0", "fit_1"})
        self.assertEqual(set(payload["questions"]["selection"]["criteria"]), {c.source_id for c in CANDIDATES} | {pc.NONE})
        self.assertNotIn(b"SECRET_CALLER_KEY", body)
        self.assertEqual(key, "SECRET_CALLER_KEY")
        self.assertTrue(0 < timeout <= 30)
        self.assertEqual(maximum, pc.MAX_RESPONSE_BYTES)

    def test_invalid_inputs_never_load_or_send(self):
        cases = [("x" * (pc.MAX_PROMPT_BYTES + 1), CANDIDATES),
                 ("🤖" * 600, CANDIDATES), ({"private_session": "private"}, CANDIDATES),
                 ("text", []), ("text", CANDIDATES * 5),
                 ("text", [CANDIDATES[0], CANDIDATES[0]]),
                 ("text", [pc.Candidate(pc.NONE, "reserved")]),
                 ("text", [pc.Candidate("source:x", "x" * 257)]),
                 ("text", [{"source_id": "source:x", "description": "short", "body": "PRIVATE_BODY"}])]
        for prompt, candidates in cases:
            with self.subTest(prompt=type(prompt), count=len(candidates)):
                transport = Mock()
                result = pc.select_jev(prompt, candidates, enabled=True, api_key="key", transport=transport)
                self.assertEqual(result.reason, "invalid_input")
                transport.assert_not_called()
        for config in [pc.SelectionConfig(min_probability=float("nan")), pc.SelectionConfig(timeout_seconds=float("inf")),
                       pc.SelectionConfig(min_margin=True), pc.SelectionConfig(require_fit="yes"),
                       pc.SelectionConfig(min_probability=10**1000)]:
            self.assertEqual(self.select(config=config).reason, "invalid_input")

    def test_unknown_incomplete_nonfinite_and_false_top_choice_abstain(self):
        mutations = [
            lambda v: v["answers"]["selection"].update(choice="unknown"),
            lambda v: v["answers"]["selection"]["probabilities"].pop(pc.NONE),
            lambda v: v["answers"]["selection"]["probabilities"].update(unknown=0.0),
            lambda v: v["answers"]["selection"]["probabilities"].update({"source:review": -0.1}),
            lambda v: v["answers"]["selection"]["probabilities"].update({"source:review": float("nan")}),
            lambda v: v["answers"]["selection"]["probabilities"].update({"source:review": float("inf")}),
            lambda v: v["answers"]["selection"]["probabilities"].update({"source:review": True}),
            lambda v: v["answers"]["selection"]["probabilities"].update({"source:review": 0.4}),
            lambda v: v["answers"]["selection"].update(choice="source:commit"),
            lambda v: v["answers"]["selection"].update(confidence=2),
            lambda v: v["answers"]["selection"].update(type="score"),
            lambda v: v["answers"].pop("fit_1"),
            lambda v: v["answers"]["fit_0"].update(noul="0.9"),
            lambda v: v.update(model="jev-latest"),
        ]
        for change in mutations:
            value = json.loads(response())
            change(value)
            with self.subTest(value=value):
                result = self.select(json.dumps(value).encode())
                self.assertIsNone(result.source_id)
                self.assertEqual(result.reason, "invalid_response")

    def test_duplicate_keys_oversize_and_invalid_json_abstain(self):
        duplicate = response().replace(b'"choice": "source:review"', b'"choice": "source:commit", "choice": "source:review"')
        for raw in [duplicate, b"[", b"x" * (pc.MAX_RESPONSE_BYTES + 1), b"\xff", b"[]"]:
            self.assertEqual(self.select(raw).reason, "invalid_response")

    def test_missing_or_invalid_usage_is_unknown_not_zero_and_never_billing(self):
        self.assertEqual(self.select(response(usage=False)).usage, pc.Usage())
        value = json.loads(response())
        for invalid in [None, {}, {"input_tokens": True, "output_tokens": -1}, {"input_tokens": "120"}]:
            value["usage"] = invalid
            result = self.select(json.dumps(value).encode())
            self.assertEqual(result.source_id, "source:review")
            self.assertEqual(result.usage, pc.Usage())
            self.assertNotIn("cost", asdict(result))
        value["usage"] = {"input_tokens": 120}
        self.assertEqual(self.select(json.dumps(value).encode()).usage, pc.Usage(120, None))

    def test_none_and_thresholds_abstain(self):
        self.assertEqual(self.select(response(pc.NONE, {"source:review": 0.1, "source:commit": 0.1, pc.NONE: 0.8})).reason, "none")
        self.assertEqual(self.select(response(probabilities={"source:review": 0.45, "source:commit": 0.4, pc.NONE: 0.15})).reason, "below_threshold")

    def test_fit_must_belong_to_selected_candidate_not_unrelated_maximum(self):
        result = self.select(response(fits=(0.1, 0.99)))
        self.assertEqual(result.reason, "selected_fit_failed")
        self.assertIsNone(result.source_id)
        self.assertEqual(result.usage.input_tokens, 120)
        value = json.loads(response(fits=(0.1, 0.99)))
        del value["answers"]["fit_0"], value["answers"]["fit_1"]
        self.assertEqual(self.select(json.dumps(value).encode(), config=pc.SelectionConfig(require_fit=False)).source_id, "source:review")

    def test_failures_make_one_attempt_without_raw_exception_key_or_logs(self):
        for exception in [TimeoutError("SECRET_CALLER_KEY PRIVATE_BODY"), OSError("SECRET_CALLER_KEY PRIVATE_BODY")]:
            transport = Mock(side_effect=exception)
            output = io.StringIO()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                result = pc.select_jev("PRIVATE_BODY", CANDIDATES, enabled=True,
                                      api_key="SECRET_CALLER_KEY", transport=transport)
            transport.assert_called_once()
            self.assertEqual(result.reason, "provider_failed")
            self.assertEqual(result.usage, pc.Usage())
            self.assertNotIn("SECRET", repr(result) + output.getvalue())
            self.assertNotIn("PRIVATE_BODY", repr(result) + output.getvalue())

    def test_http_transport_pins_origin_refuses_redirects_and_bounds_response(self):
        for status, length, chunks in [(302, None, []), (429, None, []),
                                       (200, str(pc.MAX_RESPONSE_BYTES + 1), []),
                                       (200, None, [b"x" * (pc.MAX_RESPONSE_BYTES + 1)]),
                                       (200, "100", [b"{}", b""])]:
            connection = Mock()
            reply = connection.getresponse.return_value
            reply.status = status
            reply.getheader.side_effect = lambda key, default=None: length if key == "Content-Length" else default
            reply.read1.side_effect = chunks
            with patch.object(pc.http.client, "HTTPSConnection", return_value=connection) as connect:
                result = pc.select_jev("text", CANDIDATES, enabled=True, api_key="key")
            connect.assert_called_once_with("api.typesafe.ai", timeout=8.0)
            self.assertEqual(connection.request.call_args.args[:2], ("POST", "/v1/systemone"))
            connection.request.assert_called_once()
            self.assertEqual(result.reason, "provider_failed")

    def test_http_transport_accepts_only_one_complete_response(self):
        connection = Mock()
        reply = connection.getresponse.return_value
        reply.status = 200
        raw = response()
        reply.getheader.side_effect = lambda key, default=None: str(len(raw)) if key == "Content-Length" else default
        reply.read1.side_effect = [raw, b""]
        with patch.object(pc.http.client, "HTTPSConnection", return_value=connection):
            result = pc.select_jev("text", CANDIDATES, enabled=True, api_key="key")
        self.assertEqual(result.source_id, "source:review")
        connection.close.assert_called_once()

    def test_timeout_interrupts_response_even_when_connection_detaches_its_socket(self):
        connection = Mock()
        sock = connection.sock
        expired = threading.Event()
        sock.shutdown.side_effect = lambda *_: expired.set()
        reply = Mock(status=200)
        reply.getheader.side_effect = lambda key, default=None: default
        def response_headers():
            connection.sock = None  # HTTP/1.0 or Connection: close response
            return reply
        connection.getresponse.side_effect = response_headers
        def blocked_read(_):
            self.assertTrue(expired.wait(1), "Deadline did not interrupt the detached response socket")
            raise TimeoutError()
        reply.read1.side_effect = blocked_read
        with patch.object(pc.http.client, "HTTPSConnection", return_value=connection):
            result = pc.select_jev("text", CANDIDATES, enabled=True, api_key="key",
                                  config=pc.SelectionConfig(timeout_seconds=0.02))
        self.assertEqual(result.reason, "provider_failed")
        self.assertEqual(result.usage, pc.Usage())
        connection.request.assert_called_once()


class LayaAdapterTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.hashes = {}
        for name in ["rl_agent_config.json", "model.safetensors", "encoder/config.json",
                     "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json"]:
            artifact = self.root / name
            artifact.parent.mkdir(exist_ok=True)
            artifact.write_bytes(b"test-only artifact")
            self.hashes[name] = hashlib.sha256(artifact.read_bytes()).hexdigest()
        value = json.loads(response())
        value["model"] = "laya-rl-agent"
        value["usage"]["output_tokens"] = 0
        self.model = Mock()
        self.model.predict.return_value = value
        self.loader = Mock(return_value=self.model)

    def test_lazy_pinned_load_uses_same_closed_boundary_and_observed_local_zero(self):
        classifier = pc.LayaClassifier(self.root, self.hashes, loader=self.loader)
        self.loader.assert_not_called()
        result = classifier.select("Review code", CANDIDATES)
        self.assertEqual(result.source_id, "source:review")
        self.assertFalse(result.runnable)
        self.assertEqual(result.usage.output_tokens, 0)
        classifier.select("Review again", CANDIDATES)
        self.loader.assert_called_once_with(str(self.root.resolve()))
        self.assertEqual(self.model.predict.call_args.kwargs, {"max_len": 8192, "head_max_len": 4096})
        self.model.predict.return_value["answers"]["selection"]["choice"] = "unknown"
        self.assertEqual(classifier.select("Review", CANDIDATES).reason, "invalid_response")

    def test_missing_corrupt_unpinned_or_mutated_checkpoint_abstains_before_inference(self):
        for path, hashes in [("convaiinnovations/laya", self.hashes), (self.root, {}), (self.root, None),
                             (self.root, {**self.hashes, "../outside": "0" * 64}),
                             (self.root, {**self.hashes, "model.safetensors": "0" * 64})]:
            result = pc.LayaClassifier(path, hashes, loader=self.loader).select("Review", CANDIDATES)
            self.assertEqual(result.reason, "provider_failed")
        self.loader.assert_not_called()
        (self.root / "tokenizer" / "unreviewed.json").write_text("{}")
        self.assertEqual(pc.LayaClassifier(self.root, self.hashes, loader=self.loader).select("Review", CANDIDATES).reason, "provider_failed")
        self.loader.assert_not_called()

    def test_unreviewed_root_file_abstains_before_loading(self):
        (self.root / "unreviewed_root_hook.py").write_text("# unreviewed artifact")
        result = pc.LayaClassifier(self.root, self.hashes, loader=self.loader).select("Review", CANDIDATES)
        self.assertEqual(result.reason, "provider_failed")
        self.loader.assert_not_called()

    def test_unreviewed_empty_root_directory_abstains_before_loading(self):
        (self.root / "unreviewed_directory").mkdir()
        result = pc.LayaClassifier(self.root, self.hashes, loader=self.loader).select("Review", CANDIDATES)
        self.assertEqual(result.reason, "provider_failed")
        self.loader.assert_not_called()

    def test_preserved_tokenizer_backup_requires_its_exact_manifest_hash(self):
        name = "tokenizer/tokenizer_config.json.pre-omniharness"
        backup = self.root / name
        backup.write_bytes(b"original config preserved")
        result = pc.LayaClassifier(self.root, self.hashes, loader=self.loader).select("Review", CANDIDATES)
        self.assertEqual(result.reason, "provider_failed")
        self.loader.assert_not_called()
        pinned = {**self.hashes, name: hashlib.sha256(backup.read_bytes()).hexdigest()}
        result = pc.LayaClassifier(self.root, pinned, loader=self.loader).select("Review", CANDIDATES)
        self.assertEqual(result.source_id, "source:review")
        self.loader.reset_mock()
        backup.write_bytes(b"unreviewed backup change")
        result = pc.LayaClassifier(self.root, pinned, loader=self.loader).select("Review", CANDIDATES)
        self.assertEqual(result.reason, "provider_failed")
        self.loader.assert_not_called()

    def test_loader_mutation_or_failure_does_not_return_a_selection(self):
        def mutate(_):
            (self.root / "rl_agent_config.json").write_text("changed")
            return self.model
        result = pc.LayaClassifier(self.root, self.hashes, loader=mutate).select("Review", CANDIDATES)
        self.assertEqual(result.reason, "provider_failed")
        self.model.predict.assert_not_called()

    def test_native_loader_sets_offline_cpu_and_refuses_online_imported_hub(self):
        native = Mock(__version__="0.3.20")
        with patch.dict(pc.os.environ, {}, clear=True), patch.object(pc.importlib, "import_module", return_value=native), patch.dict(pc.sys.modules, {"huggingface_hub.constants": None}):
            pc._load_laya(str(self.root))
            self.assertEqual(pc.os.environ["HF_HUB_OFFLINE"], "1")
            self.assertEqual(pc.os.environ["TRANSFORMERS_OFFLINE"], "1")
            self.assertEqual(pc.os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"], "1")
            self.assertEqual(pc.os.environ["USE_TF"], "0")
        native.load.assert_called_once_with(str(self.root), device="cpu")
        with patch.dict(pc.sys.modules, {"huggingface_hub.constants": Mock(HF_HUB_OFFLINE=False)}):
            with self.assertRaises(ValueError):
                pc._load_laya(str(self.root))


if __name__ == "__main__":
    unittest.main()
