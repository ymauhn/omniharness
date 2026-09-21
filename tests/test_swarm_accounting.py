"""Actual telemetry parsing and durable admission; fixtures never call a provider."""
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from harness.swarm_accounting import Ledger, usage_from_stream


def stream(session="s", cost=0.02, subtype="success", models=True):
    model = {"inputTokens": 10, "outputTokens": 5, "cacheReadInputTokens": 20, "cacheCreationInputTokens": 3}
    result = {"type": "result", "subtype": subtype, "session_id": session, "total_cost_usd": cost,
              "usage": {"input_tokens": 1, "output_tokens": 1}}
    if models:
        result["modelUsage"] = {"main": model, "child": model}
    return (json.dumps(result) + "\n").encode()


class Accounting(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "coordinator.sqlite"
        self.ledger = Ledger(self.path)
        self.ledger.create("run", estimated_usd=0.1, tokens=1000, approval="fixture-only")

    def test_whole_tree_tokens_and_estimated_money_are_distinct_from_billing(self):
        receipt = usage_from_stream(stream(), session="s", exit_code=0)
        self.assertEqual(receipt["total_tokens"], 76) # both models, including both cache categories
        self.assertEqual(receipt["token_categories"]["output_tokens"], 10)
        self.assertEqual(receipt["estimated_usd"], 0.02)
        self.assertIsNone(receipt["billed_usd"])
        self.assertTrue(receipt["usage_complete"])
        self.assertFalse(usage_from_stream(stream(subtype="error_max_budget_usd"), session="s", exit_code=1)["process_ok"])
        self.assertEqual(usage_from_stream(stream(subtype="error_max_budget_usd"), session="s", exit_code=1)["total_tokens"], 76)

    def test_incomplete_crashed_or_unbound_streams_never_become_zero(self):
        for data in (stream(models=False), stream(cost=None), stream(cost=0, subtype="error_during_execution")):
            receipt = usage_from_stream(data, session="s", exit_code=1)
            self.assertFalse(receipt["usage_complete"])
            self.assertTrue(receipt["issues"])
        for data in (b"", b'{broken', stream()+stream(), stream("other"), stream()+b'{broken'):
            with self.subTest(data=data), self.assertRaises(ValueError):
                usage_from_stream(data, session="s", exit_code=0)

    def test_concurrent_reservations_are_atomic_and_survive_reopening(self):
        def reserve(n):
            return Ledger(self.path).reserve("run", str(n), estimated_usd=0.06, tokens=100)
        with ThreadPoolExecutor(max_workers=2) as pool:
            leases = list(pool.map(reserve, (1, 2)))
        self.assertEqual(sum(x is not None for x in leases), 1)
        self.assertAlmostEqual(Ledger(self.path).status("run")["available_estimated_usd"], 0.04)
        self.assertIsNone(self.ledger.reserve("run", "huge", estimated_usd=0.01, tokens=1001))

    def test_failed_attempt_is_charged_once_and_evidence_cannot_be_reused(self):
        lease = self.ledger.reserve("run", "task-a", estimated_usd=0.05, tokens=100)
        self.ledger.start(lease, session="s")
        receipt = self.ledger.settle(lease, stream(), exit_code=1)
        self.assertFalse(receipt["process_ok"])
        self.ledger.settle(lease, stream(), exit_code=1)
        status = self.ledger.status("run")
        self.assertEqual(status["measured_tokens"], 76)
        self.assertEqual(status["estimated_usd"], 0.02)
        self.assertAlmostEqual(status["available_estimated_usd"], 0.08)
        other = self.ledger.reserve("run", "task-b", estimated_usd=0.05, tokens=100)
        with self.assertRaises(ValueError):
            self.ledger.start(other, session="s")
        with self.assertRaises(ValueError):
            self.ledger.settle(lease, stream(cost=0.03), exit_code=1)

    def test_unknown_or_over_cap_usage_retains_reservation_and_stops_admission(self):
        lease = self.ledger.reserve("run", "a", estimated_usd=0.05, tokens=100)
        self.ledger.start(lease, session="s")
        self.ledger.settle(lease, stream(models=False), exit_code=1)
        state = self.ledger.status("run")
        self.assertTrue(state["blocked"])
        self.assertIsNone(state["measured_tokens"])
        self.assertIsNone(self.ledger.reserve("run", "b", estimated_usd=0.01, tokens=1))
        self.ledger.create("over", estimated_usd=1, tokens=1000, approval="fixture")
        lease = self.ledger.reserve("over", "a", estimated_usd=0.01, tokens=10)
        self.ledger.start(lease, session="over-session")
        self.ledger.settle(lease, stream("over-session"), exit_code=0)
        self.assertTrue(self.ledger.status("over")["blocked"])

    def test_only_unstarted_reservations_can_be_cancelled(self):
        lease = self.ledger.reserve("run", "a", estimated_usd=0.1, tokens=1000)
        self.ledger.cancel(lease)
        self.assertEqual(self.ledger.status("run")["available_tokens"], 1000)
        lease = self.ledger.reserve("run", "b", estimated_usd=0.1, tokens=1000)
        self.ledger.start(lease, session="s")
        with self.assertRaises(ValueError):
            self.ledger.cancel(lease)
