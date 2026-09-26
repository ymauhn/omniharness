"""Offline positive and adversarial fixtures for provisional E2 graph scoring."""
import unittest
from dataclasses import replace
from fractions import Fraction
from pathlib import Path

from evals.task_graph import (Attempt, Node, Policy, ReferenceGraph, RefuterCase,
                              score_task_graph)


GRAPH = ReferenceGraph("engineering-v1", (
    Node("discover", critical=True, criterion="Reproduce the target behavior with evidence."),
    Node("implement", ("discover",), criterion="Deliver the bounded code change."),
    Node("test", ("implement",), critical=True,
         criterion="Run and pass the relevant test for the changed behavior."),
    Node("review", ("implement",), criterion="Review the delivered diff."),
), acceptance_version="engineering-acceptance-v1")
POLICY = Policy(Fraction(1), Fraction(1), Fraction(1, 10), Fraction(1, 2))


def attempt(number, node, start, end, *, agent="a", verdict="accepted",
            active=None, wait=(), evidence=None, loop_key=None, adjudication=None):
    return Attempt(str(number), node, agent, verdict, start, end,
                   tuple(active if active is not None else ((start, end),)),
                   tuple(wait), evidence, loop_key, adjudication)


def deliveries():
    return (
        attempt(1, "discover", 0, 10, active=((0, 8),), wait=((8, 10),), evidence="d1"),
        attempt(2, "implement", 10, 20, evidence="i1"),
        attempt(3, "test", 20, 30, evidence="t1"),
        attempt(4, "review", 20, 30, agent="b", evidence="r1"),
    )


def score(items, *, end=30, graph=GRAPH, policy=POLICY, refuters=()):
    return score_task_graph(graph, policy, items, run_started_ms=0,
                            run_ended_ms=end, refuter_cases=refuters)


class TaskGraphTests(unittest.TestCase):
    def test_complete_delivery_normalized_weights_and_parallel_clocks(self):
        result = score(deliveries())
        self.assertTrue(result["task_pass"])
        self.assertTrue(result["hard_gate_pass"])
        self.assertEqual(result["quality_before_penalty"], "1/1")
        self.assertEqual(result["provisional_quality"], "1/1")
        self.assertEqual(sum(Fraction(value) for value in result["weights"].values()), 1)
        self.assertTrue(all(Fraction(value) > 0 for value in result["weights"].values()))
        self.assertGreater(Fraction(result["weights"]["discover"]),
                           Fraction(result["weights"]["test"]))
        self.assertEqual(result["timing_ms"], {"wall": 30, "active_execution": 28,
                                                "summed_agent": 38, "human_wait": 2})
        self.assertFalse(result["fitness_calibrated"])

    def test_critical_failure_is_hard_gate_even_with_high_partial_quality(self):
        result = score(tuple(item for item in deliveries() if item.node_id != "test"))
        self.assertFalse(result["hard_gate_pass"])
        self.assertFalse(result["task_pass"])
        self.assertIsNone(result["provisional_quality"])
        self.assertEqual(result["quality_before_penalty"], "14/17")

    def test_retry_and_artificial_split_cannot_create_weight(self):
        baseline = score(deliveries())
        repeated = deliveries() + (
            attempt(5, "implement", 31, 40, evidence="i2"),
            attempt(6, "implement", 40, 50, evidence="i3"),
        )
        result = score(repeated, end=50)
        self.assertEqual(result["weights"], baseline["weights"])
        self.assertEqual(result["quality_before_penalty"], baseline["quality_before_penalty"])
        self.assertEqual(result["credited_nodes"], baseline["credited_nodes"])
        with self.assertRaisesRegex(ValueError, "outside the graph"):
            score(deliveries() + (attempt(5, "implement.part2", 31, 40,
                                         evidence="artificial"),), end=40)

    def test_repeated_adjudicated_no_progress_penalized_but_verification_is_not(self):
        first = attempt(5, "implement", 31, 35, verdict="no_progress", evidence=None,
                        loop_key="same-failed-command", adjudication="adjudicated-1")
        second = replace(first, id="6", started_ms=35, ended_ms=40,
                         active_intervals=((35, 40),), no_progress_adjudication_id="adjudicated-2")
        verification = attempt(7, "test", 40, 45, verdict="verification",
                               evidence="new-test-report")
        initial = score(deliveries() + (first,), end=35)
        repeated = score(deliveries() + (first, second, verification), end=45)
        self.assertEqual(initial["loop_penalty"], "0/1")
        self.assertEqual(repeated["no_progress_repeat_excess"], 1)
        self.assertEqual(repeated["loop_penalty"], "1/10")
        self.assertEqual(repeated["provisional_quality"], "9/10")
        self.assertTrue(repeated["task_pass"])
        with self.assertRaisesRegex(ValueError, "adjudication"):
            score(deliveries() + (replace(first, no_progress_adjudication_id=None),), end=35)

    def test_missing_prerequisite_blocks_downstream_credit(self):
        result = score((attempt(1, "test", 0, 10, evidence="t1"),))
        self.assertEqual(result["accepted_nodes"], ["test"])
        self.assertEqual(result["credited_nodes"], [])
        self.assertEqual(result["quality_before_penalty"], "0/1")
        self.assertFalse(result["hard_gate_pass"])

    def test_acceptance_before_prerequisite_acceptance_earns_no_credit(self):
        reversed_order = (attempt(1, "test", 0, 10, evidence="t1"),
                          attempt(2, "review", 10, 20, evidence="r1"),
                          attempt(3, "discover", 20, 30, evidence="d1"),
                          attempt(4, "implement", 30, 40, evidence="i1"))
        result = score(reversed_order, end=50)
        self.assertEqual(result["credited_nodes"], ["discover", "implement"])
        self.assertFalse(result["hard_gate_pass"])
        self.assertFalse(result["task_pass"])
        rerun = score(reversed_order + (attempt(5, "test", 40, 50, evidence="t2"),), end=50)
        self.assertEqual(rerun["credited_nodes"], ["discover", "implement", "test"])
        self.assertTrue(rerun["hard_gate_pass"])

    def test_one_evidence_id_cannot_back_two_nodes(self):
        shared = tuple(replace(item, evidence_id="same") for item in deliveries())
        with self.assertRaisesRegex(ValueError, "evidence id is shared"):
            score(shared)
        retried = score(deliveries() + (attempt(5, "implement", 31, 40, evidence="i1"),), end=40)
        self.assertTrue(retried["task_pass"])

    def test_no_progress_penalty_counts_per_node_not_per_loop_key(self):
        loops = tuple(attempt(5 + index, "implement", 30 + index, 31 + index,
                              verdict="no_progress", loop_key=f"k{index}",
                              adjudication=f"adjudicated-{index}") for index in range(5))
        loops += (attempt(10, "test", 35, 36, verdict="no_progress", loop_key="k0",
                          adjudication="adjudicated-test"),)
        result = score(deliveries() + loops, end=40)
        self.assertEqual(result["no_progress_repeat_excess"], 4)
        self.assertEqual(result["loop_penalty"], "2/5")
        self.assertEqual(result["provisional_quality"], "3/5")

    def test_contract_doc_states_the_implemented_credit_and_loop_rules(self):
        doc = (Path(__file__).resolve().parents[1] / "docs/evals/E2-TASK-GRAPH.md").read_text(
            encoding="utf-8")
        self.assertFalse("same `(node, loop_key)`" in doc, "stale per-loop-key penalty rule")
        for rule in ("counted per node", "started at or after", "reused by another node"):
            self.assertTrue(rule in doc, rule)

    def test_refuter_fields_unknown_until_all_human_labels_exist(self):
        unknown = score(deliveries(), refuters=(RefuterCase("finding-1", True),))
        self.assertEqual(unknown["refuter"]["human_labeled"], 0)
        self.assertIsNone(unknown["refuter"]["confusion"])
        self.assertIsNone(unknown["refuter"]["precision"])
        labeled = score(deliveries(), refuters=(
            RefuterCase("tp", True, True), RefuterCase("fp", True, False),
            RefuterCase("fn", False, True), RefuterCase("tn", False, False)))
        self.assertEqual(labeled["refuter"]["confusion"], {
            "true_positive": 1, "false_positive": 1,
            "false_negative": 1, "true_negative": 1})
        self.assertEqual(labeled["refuter"]["precision"], "1/2")
        self.assertEqual(labeled["refuter"]["recall"], "1/2")
        self.assertFalse(labeled["refuter"]["calibrated"])

    def test_reference_identity_and_invalid_topologies(self):
        reordered = ReferenceGraph(GRAPH.id, tuple(reversed(GRAPH.nodes)),
                                   acceptance_version=GRAPH.acceptance_version)
        self.assertEqual(score(deliveries())["reference_sha256"],
                         score(deliveries(), graph=reordered)["reference_sha256"])
        for invalid in (ReferenceGraph("bad", (Node("x", ("missing",), criterion="x"),),
                                       acceptance_version="v1"),
                        ReferenceGraph("bad", (Node("x", ("y",), criterion="x"),
                                               Node("y", ("x",), criterion="y")),
                                       acceptance_version="v1"),
                        ReferenceGraph("bad", (Node("x", criterion="x"),
                                               Node("x", criterion="x")),
                                       acceptance_version="v1")):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                score((), graph=invalid)
        changed_criterion = replace(GRAPH, nodes=(
            replace(GRAPH.nodes[0], criterion="Reproduce and quantify the target behavior."),
            *GRAPH.nodes[1:]))
        changed_version = replace(GRAPH, acceptance_version="engineering-acceptance-v2")
        baseline_hash = score(deliveries())["reference_sha256"]
        self.assertEqual(score(deliveries())["acceptance_version"], "engineering-acceptance-v1")
        self.assertNotEqual(score(deliveries(), graph=changed_criterion)["reference_sha256"],
                            baseline_hash)
        self.assertNotEqual(score(deliveries(), graph=changed_version)["reference_sha256"],
                            baseline_hash)
        with self.assertRaisesRegex(ValueError, "reference node"):
            score((), graph=replace(GRAPH, nodes=(replace(GRAPH.nodes[0], criterion=" "),
                                                  *GRAPH.nodes[1:])))
        with self.assertRaisesRegex(ValueError, "out of bounds"):
            score(deliveries(), policy=Policy(Fraction(1), Fraction(2),
                                             Fraction(1, 10), Fraction(1, 2)))
        changed_policy = Policy(Fraction(1), Fraction(1, 2),
                                Fraction(1, 10), Fraction(1, 2))
        self.assertNotEqual(score(deliveries())["policy_sha256"],
                            score(deliveries(), policy=changed_policy)["policy_sha256"])

    def test_overlap_of_one_agents_intervals_is_invalid(self):
        simultaneous = deliveries() + (attempt(5, "review", 25, 30, evidence="r2"),)
        with self.assertRaisesRegex(ValueError, "overlapping active attempts"):
            score(simultaneous)


if __name__ == "__main__":
    unittest.main()
