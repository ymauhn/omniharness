"""Offline SwarmHost callback/ledger facade: T1-T13. No model, network or real Docker."""
import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures"))
import swarm_host_fixture as fx  # noqa: E402

from harness import swarm_host  # noqa: E402
from harness.claude_worker_bridge import (  # noqa: E402
    cancel_prepared_claude_worker_attempt, prepare_claude_worker_attempt)
from harness.container_worker import ATTEMPT  # noqa: E402
from harness.native_process import _ATTEMPT  # noqa: E402
from harness.swarm_host import docker_attempt_id  # noqa: E402

RUN = fx.RUN


class SwarmHostTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(temp.cleanup)
        self.fx = fx.Fixture(temp.name)
        self.enterContext(patch.object(swarm_host, "MANAGED_ADMISSION", True))
        self.enterContext(patch("harness.claude_worker_bridge.run_claude_attempt", new=self.fx.native))
        self.host = self.fx.host()

    def reserve(self, label, host=None):
        return (host or self.host).reserve({"usd": 0.1, "tokens": 100, "attempt_id": label, "label": label})

    def context(self, label, lease):
        role = label.split(":")[0]
        return {"attempt_id": label, "label": label, "reservation": lease, "role": role,
                "baseCommit": self.fx.base,
                "scope": fx.SCOPES[label.split(":")[1]] if role == "implement" else []}

    def admit(self, label, host=None):
        lease = self.reserve(label, host)
        return lease, (host or self.host).preflight(self.context(label, lease))

    def launch(self, label, lease, admission, host=None):
        return (host or self.host).agent(fx.driver_prompt(label.split(":")[1]), {
            "label": label, "isolation": "worktree", "reservation": lease,
            "worker_identity": admission["worker_identity"]})

    def verify(self, report, label, lease, admission):
        return self.host.verify(report, {**self.context(label, lease), "admission": admission,
                                         "worker_identity": admission["worker_identity"]})

    def run_attempt(self, label):
        lease, admission = self.admit(label)
        report = self.launch(label, lease, admission)
        usage = self.host.settle(lease)
        return {"lease": lease, "admission": admission, "report": report, "usage": usage,
                "proof": self.verify(report, label, lease, admission)}

    def path(self, *parts):
        return self.fx.root.joinpath(*parts)

    def fake(self, label, lease):
        return self.fx.dockers[str(self.fx.worktrees.workers / RUN / docker_attempt_id(RUN, label, lease))]

    def actions(self, fake):
        return [command[5] for command, _ in fake.calls]

    def state(self, lease):
        return self.fx.ledger.attempt(lease)["state"]

    def blocked(self):
        return self.fx.ledger.status(RUN)["blocked"]

    def test_t1_docker_attempt_ids_are_safe_distinct_and_deterministic(self):
        labels = ["implement:a:0", "implement:a:1", "integrate:1", "review", "implement:" + "t" * 200 + ":0"]
        for label in labels[:3] + labels[4:]:  # 'review' happens to pass; it is mapped anyway
            self.assertIsNone(ATTEMPT.fullmatch(label))
            self.assertIsNone(_ATTEMPT.fullmatch(label))
        with self.assertRaises(ValueError):
            self.fx.worktrees.key(RUN, "implement:a:0")
        ids = {docker_attempt_id(RUN, label, "lease") for label in labels}
        ids |= {docker_attempt_id(RUN, "implement:a:0", "other"), docker_attempt_id("other", "implement:a:0", "lease")}
        self.assertEqual(len(ids), len(labels) + 2)
        for value in ids:
            self.assertEqual(len(value), 41)
            self.assertTrue(ATTEMPT.fullmatch(value) and _ATTEMPT.fullmatch(value))
            self.fx.worktrees.key(RUN, value)
            self.assertNotEqual(value, "_bridge")
        self.assertEqual(docker_attempt_id("r", "l", "x"), "a" + hashlib.sha256(b"r\0l\0x").hexdigest()[:40])

    def test_t2_label_collision_refuses_second_attempt_without_stopping_first(self):
        fixed = "a" + "0" * 40
        with patch.object(swarm_host, "docker_attempt_id", return_value=fixed):
            _, admitted = self.admit("implement:a:0")
            second, refused = self.admit("implement:a:1")
        self.assertIsNotNone(admitted)
        self.assertIsNone(refused)
        with self.assertRaises(ValueError):
            self.fx.ledger.bind_worker(second, run=RUN, label="implement:a:1", docker_id=fixed,
                                       worker_identity="other")
        [fake] = self.fx.dockers.values()
        self.assertTrue(fake.running)
        self.assertNotIn("stop", self.actions(fake))
        self.assertEqual(self.fx.launches, [])

    def test_t3_closed_gate_creates_no_worktree_or_container(self):
        self.assertIn("\nMANAGED_ADMISSION = False", Path(swarm_host.__file__).read_text(encoding="utf-8"))
        with patch.object(swarm_host, "MANAGED_ADMISSION", False):
            lease, admission = self.admit("implement:a:0")
        self.assertIsNone(admission)
        self.assertFalse((self.fx.worktrees.workers / RUN).exists())
        self.assertEqual(self.fx.dockers, {})
        self.host.cancel(lease)
        self.assertEqual(self.state(lease), "cancelled")
        run = self.run_attempt("implement:b:0")
        with patch.object(swarm_host, "MANAGED_ADMISSION", False):
            proof = self.verify(run["report"], "implement:b:0", run["lease"], run["admission"])
        self.assertEqual((proof["scope_ok"], proof["os_sandbox_verified"]), (True, False))

    def test_t4_every_candidate_gets_its_own_identity_and_losers_are_charged(self):
        runs = {label: self.run_attempt(label)
                for label in ("implement:a:0", "implement:a:1", "implement:b:0", "implement:b:1")}
        rows = {label: self.fx.ledger.attempt(run["lease"]) for label, run in runs.items()}
        for key in ("docker_id", "session", "worker_identity"):
            self.assertEqual(len({row[key] for row in rows.values()}), 4)
        for key in ("lease",):
            self.assertEqual(len({run[key] for run in runs.values()}), 4)
        self.assertEqual(len({run["report"]["worktree"] for run in runs.values()}), 4)
        self.assertEqual(len({run["usage"]["source_sha256"] for run in runs.values()}), 4)
        for label, run in runs.items():
            usage, report, proof = run["usage"], run["report"], run["proof"]
            self.assertEqual((usage["attempt_id"], usage["reservation"], usage["worker_identity"]),
                             (label, run["lease"], run["admission"]["worker_identity"]))
            self.assertEqual((usage["usage_complete"], usage["tokens"], usage["usd"], usage["billed_usd"]),
                             (True, 15, 0.01, None))
            self.assertEqual(rows[label]["state"], "settled")  # losers are charged too
            self.assertTrue(report["execution_valid"])
            self.assertEqual(report["changed_files"], [fx.SCOPES[label.split(":")[1]][0].replace("/**", "/file.py")])
            self.assertEqual((proof["scope_ok"], proof["os_sandbox_verified"]), (True, True))
        self.assertEqual(sorted(self.fx.launches), sorted(row["docker_id"] for row in rows.values()))
        self.assertTrue(all(fake.removed for fake in self.fx.dockers.values()))
        self.assertEqual(self.fx.ledger.status(RUN)["measured_tokens"], 60)

    def test_t5_started_label_cannot_be_reserved_again_and_a_retry_gets_a_new_id(self):
        first = self.run_attempt("implement:a:0")
        self.assertIsNone(self.reserve("implement:a:0"))
        retry = self.reserve("implement:a:1")
        self.assertNotEqual(docker_attempt_id(RUN, "implement:a:1", retry),
                            self.fx.ledger.attempt(first["lease"])["docker_id"])
        for cap in ({"usd": 0.1, "tokens": 100, "attempt_id": "x", "label": "y"},
                    {"usd": 0.1, "tokens": 100, "attempt_id": "y", "label": "y", "extra": 1}):
            self.assertIsNone(self.host.reserve(cap))

    def test_t6_integrate_and_review_stay_closed_without_a_container(self):
        for label in ("integrate:1", "review"):
            lease, admission = self.admit(label)
            self.assertIsNone(admission)
            self.host.cancel(lease)
            self.assertEqual(self.state(lease), "cancelled")
        self.assertEqual(self.fx.dockers, {})
        self.assertFalse((self.fx.worktrees.workers / RUN).exists())

    def test_t7_replayed_callbacks_launch_nothing_twice(self):
        lease, admission = self.admit("implement:a:0")
        self.assertIsNone(self.host.preflight(self.context("implement:a:0", lease)))
        fake = self.fake("implement:a:0", lease)
        self.assertTrue(fake.running)
        self.assertNotIn("stop", self.actions(fake))
        self.assertIsNotNone(self.launch("implement:a:0", lease, admission))
        self.assertIsNone(self.launch("implement:a:0", lease, admission))
        self.assertEqual(len(self.fx.launches), 1)
        settled = self.host.settle(lease)
        self.assertTrue(settled["usage_complete"])
        self.assertEqual(self.host.settle(lease), settled)
        other, other_admission = self.admit("implement:b:0")
        self.launch("implement:b:0", other, other_admission)
        source = self.path("process", docker_attempt_id(RUN, "implement:a:0", lease))
        target = self.path("process", docker_attempt_id(RUN, "implement:b:0", other))
        for name in ("stdout.bin", "stderr.bin", "receipt.json"):
            (target / name).write_bytes((source / name).read_bytes())
        state = json.loads((source / "state.json").read_text())
        (target / "state.json").write_text(json.dumps({**state, "attempt_id": target.name}))
        replayed = self.host.settle(other)
        self.assertEqual((replayed["attempt_id"], replayed["usage_complete"], replayed["tokens"]),
                         ("implement:b:0", False, None))
        self.assertTrue(self.blocked())

    def test_t8_swapped_attempt_identities_are_refused(self):
        a, admission_a = self.admit("implement:a:0")
        b, admission_b = self.admit("implement:b:0")
        for options in ({"label": "implement:a:0", "reservation": b, "worker_identity": admission_b["worker_identity"]},
                        {"label": "implement:a:0", "reservation": a, "worker_identity": admission_b["worker_identity"]}):
            self.assertIsNone(self.host.agent(fx.driver_prompt("a"), options))
        self.assertEqual(self.fx.launches, [])
        report_a = self.launch("implement:a:0", a, admission_a)
        report_b = self.launch("implement:b:0", b, admission_b)
        self.assertEqual(self.host.settle(b)["attempt_id"], "implement:b:0")
        self.assertEqual(self.host.settle(a)["attempt_id"], "implement:a:0")
        self.assertFalse(self.verify(report_a, "implement:b:0", b, admission_b)["os_sandbox_verified"])
        self.assertTrue(self.verify(report_b, "implement:b:0", b, admission_b)["os_sandbox_verified"])
        docker_id = self.fx.ledger.attempt(a)["docker_id"]
        self.assertEqual({key: report_a[key] for key in ("task", "worktree", "branch", "base_commit",
                                                         "changed_files", "net_lines", "worker_identity")},
                         {"task": "a", "worktree": str(self.fx.worktrees.workers / RUN / docker_id),
                          "branch": "codex/swarm-" + RUN + "-" + docker_id, "base_commit": self.fx.base,
                          "changed_files": ["src/a/file.py"], "net_lines": 1,
                          "worker_identity": admission_a["worker_identity"]})

    def test_t9_restarted_host_stops_the_orphan_by_exact_durable_identity(self):
        lease, admission = self.admit("implement:a:0")
        restarted = self.fx.host()
        self.assertIsNone(self.launch("implement:a:0", lease, admission, restarted))
        self.assertIsNone(restarted.settle(lease))
        fake = self.fake("implement:a:0", lease)
        self.assertTrue(fake.removed)
        self.assertEqual(self.actions(fake)[-3:], ["stop", "rm", "inspect"])
        self.assertEqual(self.state(lease), "cancelled")
        self.assertEqual(self.fx.launches, [])

    def test_t9_crash_after_start_or_crashed_result_is_unknown_and_blocks(self):
        lease, _ = self.admit("implement:a:0")
        self.fx.ledger.start(lease, session=str(uuid.uuid4()))  # coordinator died before launch
        usage = self.fx.host().settle(lease)
        self.assertEqual((usage["usage_complete"], usage["tokens"], usage["usd"]), (False, None, None))
        self.assertTrue(self.blocked())
        for behavior in ({"crash": True}, {"subtype": "error_during_execution"}):
            with self.subTest(behavior=behavior):
                self.setUp()
                self.fx.behavior = {"a": behavior}
                run = self.run_attempt("implement:a:0")
                self.assertEqual((run["usage"]["usage_complete"], run["usage"]["tokens"]), (False, None))
                self.assertEqual(self.state(run["lease"]), "unknown")
                self.assertTrue(self.blocked())

    def test_t10_cancellation_releases_only_unstarted_leases_after_exact_stop(self):
        bare = self.reserve("implement:a:0")
        self.host.cancel(bare)
        self.assertEqual((self.state(bare), self.fx.dockers), ("cancelled", {}))
        lease, _ = self.admit("implement:a:1")
        self.host.cancel(lease)
        self.assertTrue(self.fake("implement:a:1", lease).removed)
        self.assertEqual(self.state(lease), "cancelled")
        lease, _ = self.admit("implement:b:0")
        fake = self.fake("implement:b:0", lease)
        fake.mutate_profile = lambda info: info["Config"]["Labels"].update({"org.omniharness.nonce": "forged"})
        with self.assertRaises(RuntimeError):
            self.host.cancel(lease)
        self.assertEqual(self.state(lease), "reserved")
        self.assertFalse(fake.removed)
        started = self.run_attempt("implement:b:1")["lease"]
        with self.assertRaises(ValueError):
            self.host.cancel(started)
        self.assertEqual(self.state(started), "settled")

    def test_t10_cancel_event_during_a_turn_leaves_usage_unknown(self):
        self.fx.behavior = {"a": {"cancel": True}}
        run = self.run_attempt("implement:a:0")
        self.assertTrue(self.fx.cancel_event.is_set())
        self.assertEqual((run["usage"]["usage_complete"], run["usage"]["tokens"]), (False, None))
        self.assertEqual(self.state(run["lease"]), "unknown")
        self.assertTrue(self.blocked())

    def test_t11_over_reservation_usage_is_unclipped_and_blocks_admission(self):
        self.fx.behavior = {"a": {"tokens": 500}}
        usage = self.run_attempt("implement:a:0")["usage"]
        self.assertEqual((usage["tokens"], usage["usage_complete"], usage["reservation_exceeded"]), (500, True, True))
        self.assertTrue(self.blocked())
        self.assertIsNone(self.reserve("implement:b:0"))

    def test_t12_tampered_binding_cid_or_row_never_launches_or_stops_a_foreign_container(self):
        for tamper in ("binding.json", "mcp.json", "cid", "row"):
            with self.subTest(tamper=tamper):
                self.setUp()
                lease, admission = self.admit("implement:a:0")
                docker_id = docker_attempt_id(RUN, "implement:a:0", lease)
                if tamper == "cid":
                    state = self.path("containers", docker_id, "state.json")
                    state.write_text(json.dumps({**json.loads(state.read_text()), "cid": "d" * 64}))
                elif tamper == "row":
                    db = sqlite3.connect(self.fx.ledger.path)
                    with db:
                        db.execute("UPDATE workers SET docker_id=? WHERE lease=?", ("a" + "f" * 40, lease))
                    db.close()
                else:
                    self.path("process", "_bridge", docker_id, tamper).write_text("{}")
                self.assertIsNone(self.launch("implement:a:0", lease, admission))
                self.assertEqual(self.fx.launches, [])
                if tamper == "cid":
                    self.assertFalse({"stop", "rm"} & set(self.actions(self.fake("implement:a:0", lease))))

    def test_t12_edited_stream_or_out_of_scope_file_fails_closed(self):
        lease, admission = self.admit("implement:a:0")
        report = self.launch("implement:a:0", lease, admission)
        self.assertEqual(report["worktree"], str(self.fx.worktrees.workers / RUN / self.fx.ledger.attempt(lease)["docker_id"]))
        stream = self.path("process", docker_attempt_id(RUN, "implement:a:0", lease), "stdout.bin")
        stream.write_bytes(stream.read_bytes().replace(b'"inputTokens": 10', b'"inputTokens": 1'))
        usage = self.host.settle(lease)
        self.assertEqual((usage["usage_complete"], usage["tokens"]), (False, None))
        self.setUp()
        self.fx.behavior = {"a": {"outside": True}}
        run = self.run_attempt("implement:a:0")
        self.assertFalse(run["report"]["execution_valid"])
        self.assertIn("outside.txt", run["report"]["changed_files"])
        self.assertEqual((run["proof"]["scope_ok"], run["proof"]["os_sandbox_verified"]), (False, False))

    def test_t13_failed_colliding_prepare_never_stops_the_earlier_container(self):
        # D1: a prepare that never created its own container must not cancel another attempt's.
        record = self.fx.worktrees.create(RUN, "one", self.fx.base, ["src/a/**"])
        worker = self.fx.make_worker(record)
        first = prepare_claude_worker_attempt(container_worker=worker, process_evidence_root=self.path("p1"),
                                              attempt_id="one", role="implement", timeout=60)
        fake = self.fx.dockers[record["path"]]
        with self.assertRaises(FileExistsError):
            prepare_claude_worker_attempt(container_worker=worker, process_evidence_root=self.path("p2"),
                                          attempt_id="one", role="implement", timeout=60)
        self.assertTrue(fake.running)
        self.assertNotIn("stop", self.actions(fake))
        self.assertEqual(cancel_prepared_claude_worker_attempt(first)["phase"], "cancelled")

    def test_t13_failed_own_start_is_stopped_before_its_lease_is_released(self):
        # The D1 fix must still stop a container this attempt created and ran itself.
        lease = self.reserve("implement:a:0")
        path = str(self.fx.worktrees.workers / RUN / docker_attempt_id(RUN, "implement:a:0", lease))
        fake = self.fx.dockers[path] = fx.FakeDocker(Path(path))
        fake.mutate_profile = lambda info: info["HostConfig"].update(Privileged=info["State"]["Running"])
        self.assertIsNone(self.host.preflight(self.context("implement:a:0", lease)))
        self.assertEqual(self.actions(fake)[-3:], ["stop", "rm", "inspect"])
        self.assertEqual((fake.running, fake.removed), (False, True))
        self.host.cancel(lease)
        self.assertEqual((self.state(lease), self.fx.launches), ("cancelled", []))


if __name__ == "__main__":
    unittest.main()
