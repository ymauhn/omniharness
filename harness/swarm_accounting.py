"""Coordinator-owned swarm accounting. No model calls; USD is a client estimate."""
import argparse
import hashlib
import json
import math
import sqlite3
import uuid
from contextlib import contextmanager
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from pathlib import Path

TOKENS = {"input_tokens": "inputTokens", "output_tokens": "outputTokens",
          "cache_read_input_tokens": "cacheReadInputTokens", "cache_creation_input_tokens": "cacheCreationInputTokens"}
RECEIPT_CONTRACT = {"schema_version": 1, "provider": "claude-code", "protocol": "stream-json",
                    "usage_scope": "whole-tree", "counter_scope": "session-cumulative",
                    "token_basis": "claude-modelUsage-disjoint", "cost_basis": "claude-client-estimate"}


def money(value, rounding=ROUND_CEILING):
    if type(value) not in (int, float) or not 0 <= value <= 1_000_000_000 or not math.isfinite(value):
        raise ValueError("USD estimate must be a finite nonnegative number")
    return int((Decimal(str(value)) * 1_000_000_000).to_integral_value(rounding=rounding))


def terminal_result(events, session=None):
    """Shared structural boundary for scoring and accounting; system summaries may trail."""
    if any(not isinstance(e, dict) for e in events):
        raise ValueError("non-object stream event")
    results = [e for e in events if e.get("type") == "result"]
    if len(results) > 1:
        raise ValueError("multiple result events")
    if not results:
        return None
    result = results[0]
    if session is not None and (not session or result.get("session_id") != session):
        raise ValueError("expected one result bound to the launched session")
    expected = session or result.get("session_id")
    if any(e.get("session_id") and expected and e["session_id"] != expected for e in events):
        raise ValueError("stream session identity mismatch")
    if any(e.get("type") in ("assistant", "stream_event", "user")
           or (e.get("type") == "system" and e.get("subtype") == "init")
           for e in events[events.index(result)+1:]):
        raise ValueError("activity after result; aggregate is stale")
    return result


def usage_from_stream(data, *, session, exit_code):
    """Parse one session aggregate. Caller must establish a fresh single-input invocation."""
    events = [json.loads(line) for line in data.decode("utf-8").splitlines() if line.strip()]
    result = terminal_result(events, session)
    if not session or result is None:
        raise ValueError("expected one result bound to the launched session")
    issues = []
    models = result.get("modelUsage")
    categories = None
    if not isinstance(models, dict) or not models or any(not isinstance(m, dict) or any(type(m.get(k)) is not int or m[k] < 0 for k in TOKENS.values()) for m in models.values()):
        issues.append("whole-tree modelUsage missing or incomplete; main-loop usage is not a substitute")
    else:
        categories = {key: sum(m[field] for m in models.values()) for key, field in TOKENS.items()}
    cost = result.get("total_cost_usd")
    try:
        money(cost)
    except ValueError:
        cost = None
        issues.append("client USD estimate unavailable")
    if result.get("subtype") == "error_during_execution":
        categories, cost = None, None
        issues.append("crash result may be zeroed; usage is unresolved")
    return {**RECEIPT_CONTRACT, "session_id": session, "source_sha256": hashlib.sha256(data).hexdigest(),
            "exit_code": exit_code, "result_subtype": result.get("subtype"),
            "process_ok": type(exit_code) is int and exit_code == 0 and result.get("subtype") == "success" and not result.get("is_error"),
            "token_categories": categories, "total_tokens": sum(categories.values()) if categories is not None else None,
            "estimated_usd": cost, "billed_usd": None, "cost_basis": "claude-client-estimate",
            "usage_complete": not issues, "issues": issues}


def unknown_receipt(data, *, session, exit_code, issue):
    return {**RECEIPT_CONTRACT, "session_id": session, "source_sha256": hashlib.sha256(data).hexdigest(),
            "exit_code": exit_code, "result_subtype": None, "process_ok": False,
            "token_categories": None, "total_tokens": None, "estimated_usd": None, "billed_usd": None,
            "usage_complete": False, "issues": [issue]}


class Ledger:
    """SQLite transactions serialize admission across coordinators; workers never own this DB."""
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, usd INTEGER NOT NULL, tokens INTEGER NOT NULL,
                    approval TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS attempts (
                    id TEXT PRIMARY KEY, run TEXT NOT NULL REFERENCES runs(id), label TEXT NOT NULL,
                    usd INTEGER NOT NULL, tokens INTEGER NOT NULL, state TEXT NOT NULL,
                    session TEXT UNIQUE, receipt TEXT, UNIQUE(run, label));
            """)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def create(self, run, *, estimated_usd, tokens, approval):
        if not isinstance(run, str) or not run or not isinstance(approval, str) or not approval.strip() or type(tokens) is not int or not 0 < tokens < 2**53:
            raise ValueError("run, explicit approval and positive integer token budget required")
        usd = money(estimated_usd, ROUND_FLOOR)
        if usd <= 0:
            raise ValueError("positive budget required")
        with self.db() as db:
            old = db.execute("SELECT * FROM runs WHERE id=?", (run,)).fetchone()
            if old:
                if (old["usd"], old["tokens"], old["approval"]) != (usd, tokens, approval):
                    raise ValueError("existing run approval/budget is immutable")
                return
            db.execute("INSERT INTO runs(id,usd,tokens,approval) VALUES(?,?,?,?)", (run, usd, tokens, approval))

    def _status(self, db, run):
        row = db.execute("SELECT * FROM runs WHERE id=?", (run,)).fetchone()
        if not row:
            raise ValueError("unknown run")
        held_usd = held_tokens = spent_usd = spent_tokens = 0
        complete = True
        states = {}
        for attempt in db.execute("SELECT * FROM attempts WHERE run=?", (run,)):
            state = attempt["state"]
            states[state] = states.get(state, 0) + 1
            if state == "cancelled":
                continue
            if state == "settled":
                receipt = json.loads(attempt["receipt"])
                spent_usd += money(receipt["estimated_usd"])
                spent_tokens += receipt["total_tokens"]
            else:
                held_usd += attempt["usd"]
                held_tokens += attempt["tokens"]
                complete &= state == "reserved"
        return {"run": run, "blocked": bool(row["blocked"]), "states": states,
                "available_nanodollars": max(0, row["usd"]-held_usd-spent_usd),
                "available_estimated_usd": max(0, row["usd"]-held_usd-spent_usd)/1e9,
                "available_tokens": max(0, row["tokens"]-held_tokens-spent_tokens),
                "estimated_usd": spent_usd/1e9 if complete else None,
                "measured_tokens": spent_tokens if complete else None, "billed_usd": None,
                "held_estimated_usd": held_usd/1e9, "held_tokens": held_tokens}

    def status(self, run):
        with self.db() as db:
            return self._status(db, run)

    def reserve(self, run, label, *, estimated_usd, tokens):
        usd = money(estimated_usd)
        if usd <= 0 or type(tokens) is not int or not 0 < tokens < 2**53 or not isinstance(label, str) or not label.strip():
            raise ValueError("positive reservation and label required")
        with self.db() as db:
            state = self._status(db, run)
            old = db.execute("SELECT * FROM attempts WHERE run=? AND label=?", (run, label)).fetchone()
            if old:
                if (old["usd"], old["tokens"], old["state"]) == (usd, tokens, "reserved"):
                    return old["id"]
                raise ValueError("attempt label already used")
            if state["blocked"] or usd > state["available_nanodollars"] or tokens > state["available_tokens"]:
                return None
            lease = uuid.uuid4().hex
            db.execute("INSERT INTO attempts(id,run,label,usd,tokens,state) VALUES(?,?,?,?,?,?)", (lease, run, label, usd, tokens, "reserved"))
            return lease

    def start(self, lease, *, session):
        if not isinstance(session, str) or not session.strip():
            raise ValueError("unique launched session required")
        with self.db() as db:
            row = db.execute("SELECT * FROM attempts WHERE id=?", (lease,)).fetchone()
            if not row or row["state"] != "reserved" or db.execute("SELECT 1 FROM attempts WHERE session=?", (session,)).fetchone():
                raise ValueError("invalid reservation or reused provider session")
            if self._status(db, row["run"])["blocked"]:
                raise ValueError("run blocked")
            db.execute("UPDATE attempts SET state='running',session=? WHERE id=?", (session, lease))

    def cancel(self, lease):
        with self.db() as db:
            if db.execute("UPDATE attempts SET state='cancelled' WHERE id=? AND state='reserved'", (lease,)).rowcount != 1:
                raise ValueError("only an unstarted reservation can be released")

    def settle(self, lease, data, *, exit_code):
        with self.db() as db:
            row = db.execute("SELECT * FROM attempts WHERE id=?", (lease,)).fetchone()
            if not row or row["state"] not in ("running", "settled", "unknown"):
                raise ValueError("attempt was not started")
            if row["receipt"]:
                old = json.loads(row["receipt"])
                if old["source_sha256"] != hashlib.sha256(data).hexdigest() or old["exit_code"] != exit_code:
                    raise ValueError("settlement evidence is immutable")
                return old
            try:
                receipt = usage_from_stream(data, session=row["session"], exit_code=exit_code)
            except (ValueError, UnicodeError) as error:
                receipt = unknown_receipt(data, session=row["session"], exit_code=exit_code, issue=str(error))
            known = receipt["usage_complete"]
            over = known and (money(receipt["estimated_usd"]) > row["usd"] or receipt["total_tokens"] > row["tokens"])
            if not known or over:
                db.execute("UPDATE runs SET blocked=1 WHERE id=?", (row["run"],))
            receipt["reservation_exceeded"] = bool(over)
            db.execute("UPDATE attempts SET state=?,receipt=? WHERE id=?", ("settled" if known else "unknown", json.dumps(receipt), lease))
            return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stream", type=Path)
    parser.add_argument("--session", required=True)
    parser.add_argument("--exit-code", type=int, required=True)
    args = parser.parse_args()
    try:
        result = usage_from_stream(args.stream.read_bytes(), session=args.session, exit_code=args.exit_code)
        print(json.dumps(result, ensure_ascii=True))
        return 0 if result["usage_complete"] else 1
    except (OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
