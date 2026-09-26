"""Offline E2 task-graph scoring experiment; coefficients are not calibrated fitness.

The reference graph and policy are supplied by the evaluator, never by an
execution trace. Attempts can earn evidence for existing nodes, not add nodes.
All arithmetic used for quality is exact and serialized as rational strings.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from fractions import Fraction


_ID = re.compile(r"[A-Za-z0-9_.-]{1,128}\Z")
_VERDICTS = {"accepted", "rejected", "verification", "no_progress"}


def _id(value, label):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(f"{label} must be a bounded identifier")
    return value


def _ratio(value, label):
    if type(value) not in (int, Fraction):
        raise ValueError(f"{label} must be an exact rational")
    return Fraction(value)


def _shown(value):
    return str(value.numerator) + "/" + str(value.denominator)


def _intervals(value, start, end, label):
    if not isinstance(value, (tuple, list)):
        raise ValueError(f"{label} must be a sequence of intervals")
    intervals = []
    for interval in value:
        if (not isinstance(interval, (tuple, list)) or len(interval) != 2
                or any(type(bound) is not int for bound in interval)
                or not start <= interval[0] < interval[1] <= end):
            raise ValueError(f"{label} must stay inside its attempt")
        intervals.append(tuple(interval))
    ordered = sorted(intervals)
    if any(previous[1] > current[0] for previous, current in zip(ordered, ordered[1:])):
        raise ValueError(f"{label} intervals overlap")
    return ordered


def _union_ms(intervals):
    total = 0
    last_end = None
    for start, end in sorted(intervals):
        if last_end is None or start >= last_end:
            total += end - start
            last_end = end
        elif end > last_end:
            total += end - last_end
            last_end = end
    return total


@dataclass(frozen=True)
class Node:
    id: str
    dependencies: tuple[str, ...] = ()
    critical: bool = False
    criterion: str = field(kw_only=True)


@dataclass(frozen=True)
class ReferenceGraph:
    id: str
    nodes: tuple[Node, ...]
    acceptance_version: str = field(kw_only=True)


@dataclass(frozen=True)
class Policy:
    min_raw_weight: Fraction
    centrality_bonus_cap: Fraction
    loop_penalty_per_repeat: Fraction
    loop_penalty_cap: Fraction


@dataclass(frozen=True)
class Attempt:
    id: str
    node_id: str
    agent_id: str
    verdict: str
    started_ms: int
    ended_ms: int
    active_intervals: tuple[tuple[int, int], ...]
    human_wait_intervals: tuple[tuple[int, int], ...]
    evidence_id: str | None = None
    loop_key: str | None = None
    no_progress_adjudication_id: str | None = None


@dataclass(frozen=True)
class RefuterCase:
    id: str
    flagged: bool
    human_label: bool | None = None


def _reference(graph):
    if not isinstance(graph, ReferenceGraph):
        raise ValueError("one frozen reference graph is required")
    _id(graph.id, "graph id")
    _id(graph.acceptance_version, "acceptance version")
    if not isinstance(graph.nodes, tuple) or not 1 <= len(graph.nodes) <= 128:
        raise ValueError("reference nodes must be a bounded nonempty tuple")
    nodes = {}
    for node in graph.nodes:
        if not isinstance(node, Node):
            raise ValueError("invalid reference node")
        _id(node.id, "node id")
        if (node.id in nodes or type(node.critical) is not bool
                or not isinstance(node.dependencies, tuple)
                or not isinstance(node.criterion, str)
                or not node.criterion.strip() or len(node.criterion) > 2048):
            raise ValueError("duplicate or invalid reference node")
        nodes[node.id] = node
    for node in nodes.values():
        if (any(not isinstance(dep, str) for dep in node.dependencies)
                or len(set(node.dependencies)) != len(node.dependencies)
                or any(dep not in nodes or dep == node.id for dep in node.dependencies)):
            raise ValueError("unknown, repeated or self dependency")
    visiting = set()
    visited = set()

    def visit(node_id):
        if node_id in visiting:
            raise ValueError("reference graph contains a cycle")
        if node_id in visited:
            return
        visiting.add(node_id)
        for dep in nodes[node_id].dependencies:
            visit(dep)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in nodes:
        visit(node_id)
    canonical = {"id": graph.id, "acceptance_version": graph.acceptance_version,
                 "nodes": [
        {"id": node.id, "dependencies": sorted(node.dependencies),
         "critical": node.critical, "criterion": node.criterion}
        for node in sorted(nodes.values(), key=lambda item: item.id)]}
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True,
                                       separators=(",", ":")).encode()).hexdigest()
    return nodes, digest


def _weights(nodes, policy):
    if not isinstance(policy, Policy):
        raise ValueError("explicit experimental policy is required")
    floor = _ratio(policy.min_raw_weight, "min_raw_weight")
    bonus = _ratio(policy.centrality_bonus_cap, "centrality_bonus_cap")
    rate = _ratio(policy.loop_penalty_per_repeat, "loop_penalty_per_repeat")
    cap = _ratio(policy.loop_penalty_cap, "loop_penalty_cap")
    if not (floor > 0 and 0 <= bonus <= floor and 0 <= rate <= Fraction(1, 2)
            and 0 <= cap <= Fraction(1, 2)):
        raise ValueError("weight floor, centrality and loop caps are out of bounds")

    ancestor_cache = {}

    def ancestors(node_id):
        if node_id in ancestor_cache:
            return ancestor_cache[node_id]
        found = set()
        for dep in nodes[node_id].dependencies:
            found.add(dep)
            found.update(ancestors(dep))
        ancestor_cache[node_id] = found
        return found

    descendants = {node_id: 0 for node_id in nodes}
    for node_id in nodes:
        for ancestor in ancestors(node_id):
            descendants[ancestor] += 1
    scale = max(1, len(nodes) - 1)
    raw = {node_id: floor + bonus * Fraction(count, scale)
           for node_id, count in descendants.items()}
    total = sum(raw.values(), Fraction())
    return ({node_id: value / total for node_id, value in raw.items()},
            {"min_raw_weight": _shown(floor),
             "centrality_bonus_cap": _shown(bonus),
             "loop_penalty_per_repeat": _shown(rate),
             "loop_penalty_cap": _shown(cap)}, rate, cap)


def _refuter(cases):
    if not isinstance(cases, (tuple, list)):
        raise ValueError("refuter cases must be a sequence")
    ids = set()
    for case in cases:
        if not isinstance(case, RefuterCase):
            raise ValueError("invalid refuter case")
        _id(case.id, "refuter case id")
        if (case.id in ids or type(case.flagged) is not bool
                or case.human_label is not None and type(case.human_label) is not bool):
            raise ValueError("duplicate or invalid refuter case")
        ids.add(case.id)
    labeled = sum(case.human_label is not None for case in cases)
    result = {"cases": len(cases), "human_labeled": labeled,
              "confusion": None, "precision": None, "recall": None,
              "calibrated": False}
    if not cases or labeled != len(cases):
        return result
    tp = sum(case.flagged and case.human_label for case in cases)
    fp = sum(case.flagged and not case.human_label for case in cases)
    fn = sum(not case.flagged and case.human_label for case in cases)
    tn = len(cases) - tp - fp - fn
    result["confusion"] = {"true_positive": tp, "false_positive": fp,
                           "false_negative": fn, "true_negative": tn}
    result["precision"] = _shown(Fraction(tp, tp + fp)) if tp + fp else None
    result["recall"] = _shown(Fraction(tp, tp + fn)) if tp + fn else None
    return result


def score_task_graph(graph, policy, attempts, *, run_started_ms, run_ended_ms,
                     refuter_cases=()):
    """Score fixed requirements; unknown/invalid evidence cannot earn weight."""
    nodes, graph_sha256 = _reference(graph)
    weights, policy_record, loop_rate, loop_cap = _weights(nodes, policy)
    policy_sha256 = hashlib.sha256(json.dumps(policy_record, sort_keys=True,
                                               separators=(",", ":")).encode()).hexdigest()
    if (type(run_started_ms) is not int or type(run_ended_ms) is not int
            or run_ended_ms <= run_started_ms or not isinstance(attempts, (tuple, list))):
        raise ValueError("bounded run interval and attempt sequence required")
    attempt_ids = set()
    accepted = {}
    evidence_nodes = {}
    active = []
    waits = []
    per_agent = {}
    no_progress = {}
    for attempt in attempts:
        if not isinstance(attempt, Attempt):
            raise ValueError("invalid attempt")
        _id(attempt.id, "attempt id")
        _id(attempt.agent_id, "agent id")
        if (attempt.id in attempt_ids or attempt.node_id not in nodes
                or attempt.verdict not in _VERDICTS
                or type(attempt.started_ms) is not int or type(attempt.ended_ms) is not int
                or not run_started_ms <= attempt.started_ms < attempt.ended_ms <= run_ended_ms):
            raise ValueError("attempt is duplicated, outside the graph or outside the run")
        attempt_ids.add(attempt.id)
        own_active = _intervals(attempt.active_intervals, attempt.started_ms,
                                attempt.ended_ms, "active")
        own_waits = _intervals(attempt.human_wait_intervals, attempt.started_ms,
                               attempt.ended_ms, "human wait")
        if _union_ms(own_active + own_waits) != (sum(end - start for start, end in own_active)
                                              + sum(end - start for start, end in own_waits)):
            raise ValueError("one attempt cannot execute during its human wait")
        active.extend(own_active)
        waits.extend(own_waits)
        per_agent.setdefault(attempt.agent_id, []).extend(own_active)
        if attempt.verdict in {"accepted", "verification"}:
            _id(attempt.evidence_id, "accepted or verification evidence id")
            if evidence_nodes.setdefault(attempt.evidence_id, attempt.node_id) != attempt.node_id:
                raise ValueError("evidence id is shared by another node")
        if attempt.verdict == "accepted":
            accepted.setdefault(attempt.node_id, []).append((attempt.started_ms, attempt.ended_ms))
        if attempt.verdict == "no_progress":
            _id(attempt.loop_key, "no-progress loop key")
            _id(attempt.no_progress_adjudication_id, "no-progress adjudication id")
            # Per node: an adjudicator's loop_key granularity cannot dodge the penalty.
            no_progress[attempt.node_id] = no_progress.get(attempt.node_id, 0) + 1
    for intervals in per_agent.values():
        if _union_ms(intervals) != sum(end - start for start, end in intervals):
            raise ValueError("one agent has overlapping active attempts")
    credited_ms = {}

    def credit(node_id):
        # Earliest accepted end among attempts started at or after every prerequisite's credit.
        if node_id not in credited_ms:
            floors = [credit(dep) for dep in nodes[node_id].dependencies]
            floor = None if None in floors else max(floors, default=run_started_ms)
            credited_ms[node_id] = None if floor is None else min(
                (end for start, end in accepted.get(node_id, ()) if start >= floor), default=None)
        return credited_ms[node_id]

    credited = {node_id for node_id in nodes if credit(node_id) is not None}
    critical_pass = all(not node.critical or node_id in credited
                        for node_id, node in nodes.items())
    quality = sum((weights[node_id] for node_id in credited), Fraction())
    excess = sum(max(0, count - 1) for count in no_progress.values())
    penalty = min(loop_cap, loop_rate * excess)
    return {"schema_version": 1, "reference_id": graph.id,
            "acceptance_version": graph.acceptance_version,
            "reference_sha256": graph_sha256, "policy": policy_record,
            "policy_sha256": policy_sha256, "run_valid": True,
            "hard_gate_pass": critical_pass,
            "task_pass": critical_pass and len(credited) == len(nodes),
            "accepted_nodes": sorted(accepted), "credited_nodes": sorted(credited),
            "uncredited_nodes": sorted(set(nodes) - credited),
            "weights": {node_id: _shown(weights[node_id]) for node_id in sorted(nodes)},
            "quality_before_penalty": _shown(quality),
            "no_progress_repeat_excess": excess, "loop_penalty": _shown(penalty),
            "provisional_quality": _shown(quality * (1 - penalty)) if critical_pass else None,
            "timing_ms": {"wall": run_ended_ms - run_started_ms,
                          "active_execution": _union_ms(active),
                          "summed_agent": sum(end - start for start, end in active),
                          "human_wait": _union_ms(waits)},
            "refuter": _refuter(refuter_cases),
            "fitness_calibrated": False}
