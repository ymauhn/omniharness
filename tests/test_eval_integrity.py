"""E1 contract tests. Frozen adversarial input; no model or network calls."""
import importlib.util
import copy
import json
import tempfile
import subprocess
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("integrity_runner", ROOT / "evals/run.py")
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)


class ExecutionContract(unittest.TestCase):
    def test_malformed_grader_and_transcript_cannot_approve(self):
        good = json.loads((ROOT / "tests/fixtures/evals/streams.json").read_text())[0]["answer"]
        for verdict in ({"pass": "yes", "failures": []}, {"pass": True, "failures": ["broken"]}, {"pass": True}):
            with self.subTest(verdict=verdict), tempfile.TemporaryDirectory() as tmp:
                ws = Path(tmp)
                (ws / "_stream.jsonl").write_text(json.dumps({"type": "result", "subtype": "success", "result": good}))
                grader = SimpleNamespace(check=lambda *args: verdict)
                with patch.object(run, "load_check", return_value=grader):
                    rec = run.evaluate_ws("detour-bounded", "harness", ws, 1, 0)
                self.assertFalse(rec["run_valid"])
                self.assertFalse(rec["pass"])
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            stream = [{"type": "assistant", "message": "corrupt"}, {"type": "result", "subtype": "success", "result": good}]
            (ws / "_stream.jsonl").write_text("\n".join(map(json.dumps, stream)))
            self.assertFalse(run.evaluate_ws("detour-bounded", "harness", ws, 1, 0)["run_valid"])

    def test_persisted_process_error_cannot_be_overridden_by_a_caller(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            good = json.loads((ROOT / "tests/fixtures/evals/streams.json").read_text())[0]["answer"]
            (ws / "_stream.jsonl").write_text(json.dumps({"type": "result", "subtype": "success", "result": good, "num_turns": 2}))
            (ws / "_process.json").write_text(json.dumps({"exit_code": 1, "failures": ["timeout"]}))
            self.assertFalse(run.evaluate_ws("detour-bounded", "harness", ws, 1, 0)["run_valid"])

    def test_launch_failure_and_timeout_are_persisted(self):
        for failure in ("launch", "timeout"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                waits = iter([subprocess.TimeoutExpired("fake", 1), 0])
                def wait(timeout):
                    value = next(waits)
                    if isinstance(value, Exception): raise value
                    return value
                proc = SimpleNamespace(returncode=-9, wait=wait)
                with patch.object(run, "RESULTS", Path(tmp)), patch.object(run, "git", return_value="fixture"), \
                     patch.object(run.subprocess, "Popen", side_effect=OSError("missing") if failure == "launch" else None, return_value=proc), \
                     patch.object(run, "tree_kill") as kill:
                    self.assertEqual(run.main(["run", "detour-bounded", "--arm", "harness", "--claude", "never-called"]), 1)
                rec = json.loads(next(Path(tmp).glob("*.json")).read_text())
                self.assertFalse(rec["run_valid"])
                self.assertFalse(rec["pass"])
                self.assertEqual(rec["exit_code"], None if failure == "launch" else -9)
                self.assertTrue(any(failure in f for f in rec["execution_failures"]))
                self.assertEqual(kill.call_count, int(failure == "timeout"))

    def test_history_audit_is_derived_and_preserves_originals(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            ws = directory / "workspace" / "legacy"
            ws.mkdir(parents=True)
            (ws / "_stream.jsonl").write_text(json.dumps({"type": "result", "subtype": "error_max_budget_usd", "result": ""}))
            original = {"ts": "01", "case": "detour-bounded", "arm": "control", "pass": True, "exit_code": 1, "workspace": str(ws)}
            p = directory / "legacy.json"
            p.write_text(json.dumps(original))
            before = p.read_bytes()
            report = run.audit_history(directory)
            row = report["records"][0]
            self.assertFalse(row["run_valid"])
            self.assertIsNone(row["task_pass"])
            self.assertEqual(row["source_sha256"], run.records.file_hash(p))
            self.assertEqual(row["comparison"], "incomparable")
            self.assertEqual(p.read_bytes(), before)
            original.update(exit_code=0, workspace=None, case="gauntlet-rapido", tokens_out=99, turns=3)
            p.write_text(json.dumps(original))
            row = run.audit_history(directory)["records"][0]
            self.assertIsNone(row["run_valid"])
            self.assertEqual(row["tokens_total_reported"], 99)
            self.assertIsNone(row["usage"]["tokens_out"])

    def test_record_identity_never_overwrites_and_missing_usage_stays_unknown(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(run, "RESULTS", Path(tmp)):
            a = run.baseline("case", "harness", True, [], exit_code=0, stamp="same-second")
            b = run.baseline("case", "harness", True, [], exit_code=0, stamp="same-second")
            self.assertNotEqual(a["record_id"], b["record_id"])
            pa, pb = run.write_record(a, "harness"), run.write_record(b, "harness")
            before = pa.read_bytes()
            self.assertNotEqual(pa, pb)
            with self.assertRaises(FileExistsError):
                run.write_record(a, "harness")
            self.assertEqual(pa.read_bytes(), before)
            for k in ("tokens_in", "tokens_out", "cache_read", "cache_create", "cost_usd"):
                self.assertIsNone(a[k])

    def test_rescore_uses_original_manifest_and_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            manifest = run.records.manifest(run.ROOT, run.CASES / "detour-bounded", "harness", 1.25, 12,
                                            {"permission_mode": "manual"})
            (ws / "_manifest.json").write_text(json.dumps(manifest))
            (ws / "_process.json").write_text(json.dumps({"exit_code": 0, "wall_ms": 123}))
            good = json.loads((ROOT / "tests/fixtures/evals/streams.json").read_text())[0]["answer"]
            stream = [{"type": "system", "subtype": "init", "model": "fixture-model"},
                      {"type": "result", "subtype": "success", "result": good}]
            (ws / "_stream.jsonl").write_text("\n".join(map(json.dumps, stream)))
            with patch.object(run, "RESULTS", ws / "records"):
                self.assertEqual(run.main(["rescore", "detour-bounded", "--arm", "harness", "--workspace", str(ws)]), 0)
                first = next((ws / "records").glob("*.json"))
                rec = json.loads(first.read_text())
                self.assertEqual(rec["run_id"], manifest["run_id"])
                self.assertEqual(rec["manifest"]["budget_usd"], 1.25)
                self.assertEqual(rec["model"], "fixture-model")
                self.assertEqual(rec["wall_ms"], 123)
                self.assertEqual(run.main(["rescore", "detour-bounded", "--arm", "harness", "--workspace", str(ws),
                                           "--max-budget-usd", "9"]), 1)
                self.assertEqual(json.loads((ws / "_manifest.json").read_text()), manifest)

    def test_interactive_aggregate_is_not_output_and_unknown_process_cannot_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "driver.json"
            path.write_text(json.dumps({"resumo": {"tokens": 100}, "notification": {"totalTokens": 100, "agentCount": 3}}))
            grader = SimpleNamespace(check_record=lambda data, expected: {"pass": True, "failures": []})
            with patch.object(run, "RESULTS", Path(tmp) / "records"), patch.object(run, "git", return_value="checkpoint"), \
                 patch.object(run, "load_check", return_value=grader):
                self.assertEqual(run.main(["record", str(path), "gauntlet-rapido"]), 1)
            rec = json.loads(next((Path(tmp) / "records").glob("*.json")).read_text())
            self.assertFalse(rec["run_valid"])
            self.assertIsNone(rec["task_pass"])
            self.assertIsNone(rec["tokens_out"])
            self.assertIsNone(rec["turns"])
            self.assertEqual(rec["tokens_total_reported"], 100)
            self.assertEqual(rec["agent_count"], 3)

    def test_live_control_is_refused_before_spawning_without_home_isolation(self):
        with patch.object(run.subprocess, "Popen") as spawn:
            self.assertEqual(run.main(["run", "detour-bounded", "--arm", "control"]), 1)
            spawn.assert_not_called()

    def test_frozen_stream_fixtures(self):
        fixtures = json.loads((ROOT / "tests/fixtures/evals/streams.json").read_text())
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]), tempfile.TemporaryDirectory() as tmp:
                ws = Path(tmp)
                result = {"type": "result", "subtype": fixture.get("subtype", "success"),
                          "is_error": fixture.get("is_error", False), "num_turns": 2}
                if "answer" in fixture:
                    result["result"] = fixture["answer"]
                stream = '{"type":"result",' if fixture.get("truncated") else json.dumps(result)
                stream += "\n" + fixture.get("tail", "")
                (ws / "_stream.jsonl").write_text(stream, encoding="utf-8")
                with patch.object(run, "RESULTS", ws / "records"):
                    status = run.score_ws(fixture.get("case", "detour-bounded"), fixture["arm"], ws, 1,
                                          fixture["exit_code"], failures=fixture.get("runner_failures", []))
                rec = json.loads(next((ws / "records").glob("*.json")).read_text())
                self.assertEqual(rec["schema_version"], 2)
                self.assertEqual(rec["run_valid"], fixture["valid"])
                self.assertEqual(rec["task_pass"], fixture.get("task"))
                self.assertEqual(rec["control_discriminative"], fixture.get("control"))
                self.assertEqual(rec["pass"], fixture.get("task") is True)
                self.assertEqual(status, 0 if rec["pass"] else 1)
                self.assertIsNone(rec["tokens_out"])
                self.assertEqual(rec["coverage"]["tokens_out"], "unavailable")
                self.assertEqual(len(rec["source"]["files"]["_stream.jsonl"]), 64)
                if not fixture["valid"]:
                    self.assertTrue(any(fixture["reason"] in f for f in rec["execution_failures"]), rec)


def comparable(stamp, task=True, valid=True, cost=1):
    manifest = run.records.manifest(run.ROOT, run.CASES / "detour-bounded", "harness", 1, 60,
                                    {"home_isolation": "offline-fixture", "permission_mode": "manual"})
    return run.baseline("detour-bounded", "harness", task, [], exit_code=0 if valid else 1,
                        stamp=stamp, run_valid=valid, manifest=manifest, model="fixture-model", agent_version="fixture-cli",
                        grader_sha256=manifest["grader_sha256"], source={"files": {"_stream.jsonl": "a" * 64}},
                        cost_usd=cost, tokens_out=None)


class ComparisonContract(unittest.TestCase):
    def analyse(self, records, **kwargs):
        with tempfile.TemporaryDirectory() as tmp:
            for i, rec in enumerate(records):
                (Path(tmp) / f"{i}.json").write_text(json.dumps(rec))
            return run.records.compare(tmp, **kwargs)

    def test_valid_quality_drop_and_invalid_execution_are_distinct(self):
        good, bad = comparable("01"), comparable("02", task=False)
        report = self.analyse([good, bad])
        self.assertEqual(report["groups"][0]["status"], "regression")
        self.assertIn("task_pass true -> false", report["alerts"][0])
        invalid = comparable("03", valid=False)
        report = self.analyse([good, bad, invalid])
        self.assertTrue(report["alerts"][0].startswith("INVALID_RUN"))
        self.assertEqual(report["groups"][0]["reliability"], {"attempts": 3, "valid": 2, "task_successes": 1})
        with tempfile.TemporaryDirectory() as tmp, patch.object(run, "RESULTS", Path(tmp)):
            (Path(tmp) / "invalid.json").write_text(json.dumps(invalid))
            self.assertEqual(run.main(["regress"]), 1)

    def test_configuration_drift_blocks_comparison(self):
        good = comparable("01")
        for field in ("model", "agent_version", "budget_usd", "grader_sha256", "scorer_sha256", "fixture_sha256", "host", "runner_sha256", "config"):
            bad = comparable("02", task=False)
            container = bad if field in ("model", "grader_sha256", "agent_version", "scorer_sha256") else bad["manifest"]
            container[field] = "changed"
            with self.subTest(field=field):
                report = self.analyse([good, bad])
                self.assertEqual(report["alerts"], [])
                self.assertEqual(report["groups"][0]["status"], "incomparable")

    def test_efficiency_uses_successes_but_reliability_keeps_failures(self):
        records = [comparable("01", task=False, cost=0.001), comparable("02", cost=1), comparable("03", cost=1.1)]
        report = self.analyse(records)
        self.assertEqual(report["alerts"], [])
        self.assertEqual(report["groups"][0]["reliability"]["attempts"], 3)
        records[-1]["cost_usd"] = 1.3
        self.assertIn("cost_usd", self.analyse(records)["alerts"][0])
        records[-1]["cost_usd"] = None
        report = self.analyse(records)
        self.assertEqual(report["alerts"], [])
        self.assertEqual(report["groups"][0]["metrics_compared"], [])

    def test_insufficient_legacy_and_duplicate_runs_are_explicit(self):
        first = comparable("01")
        self.assertEqual(self.analyse([first])["groups"][0]["status"], "insufficient")
        legacy = {"case": "detour-bounded", "arm": "harness", "pass": True, "ts": "02"}
        self.assertEqual(self.analyse([first, legacy])["groups"][0]["status"], "incomparable")
        duplicate = copy.deepcopy(first)
        duplicate["record_id"] = run.records.identity()
        duplicate["ts"] = "02"
        report = self.analyse([first, duplicate])
        self.assertEqual(report["groups"][0]["reliability"]["attempts"], 1)
        duplicate["source"]["files"]["_stream.jsonl"] = "b" * 64
        self.assertTrue(self.analyse([first, duplicate])["alerts"][0].startswith("INVALID_RECORD"))
        duplicate = copy.deepcopy(first)
        self.assertTrue(self.analyse([first, duplicate])["alerts"][0].startswith("INVALID_RECORD"))

    def test_contradictory_success_records_are_rejected(self):
        for changes in ({"exit_code": 1}, {"exit_code": False}, {"execution_failures": ["timeout"]},
                        {"task_pass": True, "failures": ["task broken"]}):
            with self.subTest(changes=changes):
                rec = comparable("01")
                rec.update(changes)
                alerts = self.analyse([rec])["alerts"]
                self.assertTrue(alerts, rec)
                self.assertTrue(alerts[0].startswith("INVALID_RECORD"))


if __name__ == "__main__":
    unittest.main()
