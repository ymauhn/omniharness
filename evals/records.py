"""Versioned evidence and accounting; stdlib only, no execution or network."""
import hashlib
import json
import math
import platform
import re
import statistics
import uuid
from datetime import datetime, timezone
from pathlib import Path
from harness.swarm_accounting import RECEIPT_CONTRACT, TOKENS

SCHEMA_VERSION = 3
USAGE = {"tokens_in": "input_tokens", "tokens_out": "output_tokens",
         "cache_read": "cache_read_input_tokens", "cache_create": "cache_creation_input_tokens"}


def identity():
    return uuid.uuid4().hex


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def code_hash(root):
    return digest({p: file_hash(root / p) for p in ("evals/run.py", "evals/records.py", "harness/swarm_accounting.py")})


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def file_hash(path):
    path = Path(path)
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def file_map(root):
    return {p.relative_to(root).as_posix(): file_hash(p) for p in sorted(Path(root).rglob("*"))
            if p.is_file() and not any(part in ("__pycache__", ".git") for part in p.parts)}


def measurement(value):
    return value if type(value) in (int, float) and value >= 0 and (type(value) is int or math.isfinite(value)) else None


def telemetry(result, receipt=None):
    result = result or {}
    usage = result.get("usage")
    usage = usage if isinstance(usage, dict) else {}
    categories = (receipt or {}).get("token_categories") or {}
    estimate = (receipt or {}).get("estimated_usd")
    fields = {name: categories.get(raw) for name, raw in USAGE.items()}
    fields.update({"total_tokens": (receipt or {}).get("total_tokens"),
                   "estimated_usd": estimate, "cost_usd": estimate, "billed_usd": None,
                   "turns": measurement(result.get("num_turns")),
                   "duration_ms": measurement(result.get("duration_ms"))})
    return {**fields, "usage_raw": usage, "usage_receipt": receipt,
            "coverage": {k: ("estimated" if k in ("cost_usd", "estimated_usd") else "measured")
                         if v is not None else "unavailable" for k, v in fields.items()}}


def source(ws):
    files = file_map(ws)
    return {"files": files, "sha256": digest(files)}


def manifest(root, case_dir, arm, budget, timeout, config):
    """Only reproducible inputs, hashes and a config allowlist; no env, keys or user paths."""
    fixture = {p: h for p, h in file_map(case_dir).items() if p != "check.py"}
    harness = {str(p): file_hash(root / p) for p in ("AGENTS.md", "CLAUDE.md", "harness/settings.json", "harness/guard_bash.py")}
    harness.update({"skills/" + p: h for p, h in file_map(root / ".agents/skills").items()})
    return {"version": 1, "run_id": identity(), "started_at": timestamp(), "case": case_dir.name, "arm": arm,
            "fixture_files": fixture, "fixture_sha256": digest(fixture), "grader_sha256": file_hash(case_dir / "check.py"),
            "runner_sha256": code_hash(root),
            "harness_sha256": digest(harness), "budget_usd": budget, "timeout_s": timeout,
            "host": {"agent": "claude-code", "os": platform.system(), "release": platform.release(),
                     "arch": platform.machine(), "python": platform.python_version()},
            "config": {k: config[k] for k in ("permission_mode", "setting_sources", "flags", "permission_prompts", "home_isolation") if k in config}}


def verdict(value):
    """A malformed or contradictory grader must never silently approve a task."""
    if not isinstance(value, dict) or type(value.get("pass")) is not bool:
        raise ValueError("grader must return a boolean pass")
    failures = value.get("failures")
    if not isinstance(failures, list) or any(not isinstance(f, str) for f in failures):
        raise ValueError("grader must return a list of failure reasons")
    if value["pass"] and failures:
        raise ValueError("grader returned pass with failure reasons")
    return value["pass"], failures or ([] if value["pass"] else ["grader rejected the result"])


def comparison_key(rec):
    m = rec.get("manifest")
    if rec.get("schema_version") != SCHEMA_VERSION or not isinstance(m, dict):
        return None
    required = ("fixture_sha256", "runner_sha256", "harness_sha256", "budget_usd", "timeout_s", "host", "config")
    scoring = ("model", "agent_version", "grader_sha256", "scorer_sha256")
    if any(m.get(k) is None for k in required) or not all(rec.get(k) for k in (*scoring, "source")):
        return None
    if not isinstance(m["config"], dict) or m["config"].get("home_isolation") not in ("offline-fixture", "os-sandbox"):
        return None
    return digest({**{k: m[k] for k in required}, **{k: rec[k] for k in scoring}})


def validate_usage(rec):
    """Reject contradictory derived fields; a hash binds evidence, not OS isolation."""
    receipt = rec.get("usage_receipt")
    if receipt is not None:
        if not isinstance(receipt, dict):
            raise ValueError("invalid usage receipt")
        if (not isinstance(receipt.get("source_sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", receipt["source_sha256"])
                or receipt["source_sha256"] != (rec.get("source") or {}).get("files", {}).get("_stream.jsonl")
                or not receipt.get("session_id")
                or receipt["session_id"] != (rec.get("manifest") or {}).get("session_id")
                or receipt.get("exit_code") != rec.get("exit_code")):
            raise ValueError("usage receipt is not bound to stream/session/process")
        categories = receipt.get("token_categories")
        if categories is not None and (not isinstance(categories, dict) or set(categories) != set(TOKENS)
                or any(type(v) is not int or v < 0 for v in categories.values())):
            raise ValueError("invalid token categories")
        total = sum(categories.values()) if categories is not None else None
        if receipt.get("total_tokens") != total or (total is not None and type(receipt.get("total_tokens")) is not int):
            raise ValueError("contradictory receipt total")
        estimate = receipt.get("estimated_usd")
        if (estimate is not None and (measurement(estimate) is None or estimate > 1_000_000_000)) or receipt.get("billed_usd") is not None:
            raise ValueError("invalid estimate or unsupported billing claim")
    derived = telemetry(None, receipt)
    for name in (*USAGE, "total_tokens", "estimated_usd", "cost_usd", "billed_usd"):
        if (rec.get(name) != derived[name] or
                (derived[name] is not None and type(rec.get(name)) not in (int, float)) or
                (rec.get("coverage") or {}).get(name) != derived["coverage"][name]):
            raise ValueError(f"{name} contradicts usage receipt")


def metric_value(rec, metric):
    receipt = rec.get("usage_receipt") or {}
    manifest = rec.get("manifest") or {}
    if (any(receipt.get(k) != v for k, v in RECEIPT_CONTRACT.items())
            or manifest.get("invocation") != "fresh-single-input"):
        return None
    return measurement(receipt.get(metric))


def read_history(directory):
    rows, errors, ids = [], [], set()
    for path in sorted(Path(directory).glob("*.json")):
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(rec, dict) or not all(isinstance(rec.get(k), str) for k in ("case", "arm", "ts")):
                raise ValueError("missing case/arm/timestamp")
            if rec.get("schema_version") == SCHEMA_VERSION:
                if not rec.get("record_id") or not rec.get("run_id") or rec["record_id"] in ids:
                    raise ValueError("missing or duplicate record identity")
                if type(rec.get("run_valid")) is not bool or (rec["run_valid"] and type(rec.get("task_pass")) is not bool):
                    raise ValueError("invalid outcome types")
                if not rec["run_valid"] and (rec.get("task_pass") is not None or rec.get("control_discriminative") is not None):
                    raise ValueError("invalid execution cannot have task/control outcomes")
                if rec["run_valid"] and (type(rec.get("exit_code")) is not int or rec["exit_code"] != 0 or rec.get("execution_failures")):
                    raise ValueError("valid execution contradicts process status/failures")
                if rec.get("task_pass") is True and rec.get("failures"):
                    raise ValueError("successful task contradicts failure reasons")
                if rec.get("pass") != (rec["run_valid"] and rec["task_pass"] is True):
                    raise ValueError("contradictory pass alias")
                validate_usage(rec)
                ids.add(rec["record_id"])
            rows.append(rec)
        except (OSError, UnicodeError, ValueError, TypeError, AttributeError) as exc:
            errors.append(f"INVALID_RECORD {path.name}: {exc}")
    return sorted(rows, key=lambda r: (r.get("run_ts", r["ts"]), r["ts"], r.get("record_id", ""))), errors


def compare(directory, n=5, factor=1.2):
    if n < 1 or not math.isfinite(factor) or factor <= 1:
        raise ValueError("n must be positive and factor must be finite and greater than 1")
    rows, alerts = read_history(directory)
    groups, seen_runs = {}, {}
    for rec in rows:
        key = (rec["case"], rec["arm"])
        run_id = rec.get("run_id") or "legacy:" + digest(rec)
        previous = seen_runs.get(run_id)
        if previous:
            if (previous["case"], previous["arm"]) != key or (previous.get("source") or {}).get("files", {}).get("_stream.jsonl") != (rec.get("source") or {}).get("files", {}).get("_stream.jsonl"):
                alerts.append(f"INVALID_RECORD {run_id}: run identity reused for different evidence")
                continue
            groups[key].remove(previous)  # a rescore is one attempt, not another reliability sample
        seen_runs[run_id] = rec
        groups.setdefault(key, []).append(rec)
    reports = []
    for (case, arm), recs in sorted(groups.items()):
        new, prev = recs[-1], recs[:-1]
        name = f"{case}/{arm}"
        row = {"case": case, "arm": arm, "status": "insufficient", "metrics_compared": [],
               "unverified": sum(r.get("run_valid") is None for r in recs),
               "reliability": {"attempts": len(recs), "valid": sum(r.get("run_valid") is True for r in recs),
                               "task_successes": sum(r.get("run_valid") is True and r.get("task_pass") is True for r in recs)}}
        key = comparison_key(new)
        compatible = [r for r in prev if key is not None and comparison_key(r) == key][-n:]
        valid = [r for r in compatible if r.get("run_valid") is True]
        if new.get("run_valid") is False:
            row["status"] = "invalid"
            alerts.append(f"INVALID_RUN {name}: " + "; ".join(new.get("execution_failures") or ["execution invalid"]))
        elif key is None or prev and not compatible:
            row["status"] = "incomparable"
        elif valid:
            row["status"] = "compared"
            why = []
            if valid[-1]["task_pass"] and not new["task_pass"]:
                why.append("task_pass true -> false")
            if valid[-1].get("control_discriminative") is True and new.get("control_discriminative") is False:
                why.append("control_discriminative true -> false")
            if new["task_pass"]:
                for metric in ("total_tokens", "estimated_usd"):
                    hist = [metric_value(r, metric) for r in valid if r["task_pass"]]
                    hist = [v for v in hist if v is not None]
                    value = metric_value(new, metric)
                    if hist and value is not None:
                        row["metrics_compared"].append(metric)
                        median = statistics.median(hist)
                        if value > factor * median:
                            why.append(f"{metric} {value} > {factor}x median {median}")
            if why:
                row["status"] = "regression"
                alerts.append(f"REGRESSION {name}: " + "; ".join(why))
        row["comparable_previous"] = len(compatible)
        reports.append(row)
    return {"groups": reports, "alerts": alerts, "status": "action_required" if alerts else "reported" if reports else "insufficient"}
