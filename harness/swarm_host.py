"""Offline trusted host for the swarm/swarm.workflow.js callbacks, over JSON lines.

One instance owns one ledger run. Each driver attempt maps to one lease, one
Docker-safe attempt ID, one pinned worktree and one prepared Claude worker.
Prepared handles are process-local, so one long-lived Python process serves
every callback. Managed admission stays closed until the V-04 live gates pass;
this module certifies no isolation, provider cap or billed spend.
"""
import hashlib
import json
import subprocess
import threading
from pathlib import Path

from harness.claude_worker_bridge import (
    cancel_prepared_claude_worker_attempt, prepare_claude_worker_attempt,
    run_prepared_claude_worker_attempt,
)
from harness.native_process import recover_attempt
from harness.swarm_accounting import terminal_result

MANAGED_ADMISSION = False  # V-04-2..V-04-8 first; only offline fixtures patch this
# integrate/review need a read-only mount and a host-side merge before admission (D3)
ROLES = ("implement",)
OPS = ("reserve", "cancel", "preflight", "agent", "settle", "verify")
_BAD = (KeyError, TypeError, AttributeError, ValueError, OSError, subprocess.CalledProcessError)


def docker_attempt_id(run, label, lease):
    """41 chars matching container/process ATTEMPT and Worktrees.key; never '_bridge'."""
    return "a" + hashlib.sha256("\0".join((run, label, lease)).encode()).hexdigest()[:40]


def worker_identity(cid, nonce, worktree, docker_id, lease):
    """Host-derived only: prepared/durable CID and nonce, exact worktree, mapping, lease."""
    value = {"cid": cid, "nonce": nonce, "worktree": worktree, "docker_id": docker_id, "lease": lease}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _removed(stopped):
    if stopped.get("phase") != "cancelled" or stopped.get("container_removed") is not True:
        raise RuntimeError("exact worker stop unconfirmed")


class SwarmHost:
    def __init__(self, ledger, run, *, worktrees, make_worker, process_root, cli, timeout,
                 python_executable=None, approved_settings_sha256=None, cancel_event=None):
        self.ledger, self.run, self.worktrees, self.make_worker = ledger, run, worktrees, make_worker
        self.process_root, self.cli, self.timeout = Path(process_root), cli, timeout
        self.python, self.settings, self.cancel_event = python_executable, approved_settings_sha256, cancel_event
        self._lock = threading.Lock()
        self._live = {}  # lease -> prepared, unlaunched attempt
        self._done = {}  # lease -> launched attempt and its bridge result

    def _row(self, lease):
        row = self.ledger.attempt(lease) if isinstance(lease, str) else None
        return row if row and row["run"] == self.run else None

    def reserve(self, cap):
        if not isinstance(cap, dict) or set(cap) != {"usd", "tokens", "attempt_id", "label"} \
                or cap["attempt_id"] != cap["label"]:
            return None
        try:
            return self.ledger.reserve(self.run, cap["label"], estimated_usd=cap["usd"], tokens=cap["tokens"])
        except ValueError:
            return None

    def cancel(self, lease):
        """Release an unstarted lease only after its exact worker, if any, is confirmed removed."""
        row = self._row(lease)
        if row is None or row["state"] != "reserved":
            raise ValueError("only this run's unstarted reservation can be released")
        with self._lock:
            live = self._live.pop(lease, None)
        if live:
            _removed(cancel_prepared_claude_worker_attempt(live["prepared"]))
        elif row["docker_id"] is not None:  # restarted host: stop by exact durable identity
            docker_id = docker_attempt_id(self.run, row["label"], lease)
            if row["docker_id"] != docker_id:
                raise ValueError("durable worker binding differs from its lease")
            record = json.loads(self.worktrees.key(self.run, docker_id).read_text(encoding="utf-8"))
            worker = self.make_worker(record)
            state, _, _ = worker._load(docker_id)
            if worker_identity(state.get("cid"), state.get("nonce"), record["path"],
                               docker_id, lease) != row["worker_identity"]:
                raise ValueError("durable container identity differs from the bound worker")
            _removed(worker.cancel(docker_id))
        self.ledger.cancel(lease)

    def preflight(self, attempt):
        if not MANAGED_ADMISSION:
            return None
        try:
            label, lease, role = attempt["label"], attempt["reservation"], attempt["role"]
            row = self._row(lease)
            if (attempt["attempt_id"] != label or role not in ROLES or role != label.split(":")[0]
                    or row is None or row["label"] != label or row["state"] != "reserved"
                    or row["docker_id"] is not None):
                return None
            docker_id = docker_attempt_id(self.run, label, lease)
            with self._lock:  # concurrent `git worktree add` on one source is not safe
                record = self.worktrees.create(self.run, docker_id, attempt["baseCommit"], attempt["scope"])
            worker = self.make_worker(record)
            # ponytail: prepare stops its own failed start by exact ID; an unconfirmed stop stays
            # 'unknown' in worker evidence for triage, and this unbound lease can still be released
            prepared = prepare_claude_worker_attempt(
                container_worker=worker, process_evidence_root=self.process_root, attempt_id=docker_id,
                role=role, timeout=self.timeout, cancel_event=self.cancel_event,
                python_executable=self.python)
        except Exception:
            return None
        identity = worker_identity(prepared.cid, prepared.nonce, record["path"], docker_id, lease)
        try:
            self.ledger.bind_worker(lease, run=self.run, label=label, docker_id=docker_id,
                                    worker_identity=identity)
        except ValueError:
            try:
                cancel_prepared_claude_worker_attempt(prepared)
            except (RuntimeError, ValueError):
                pass  # an unconfirmed stop stays 'unknown' in the worker evidence
            return None
        with self._lock:
            self._live[lease] = {"prepared": prepared, "worker": worker, "record": record,
                                 "docker_id": docker_id, "identity": identity, "label": label, "role": role}
        return {"os_sandbox_verified": True, "attempt_id": label, "reservation": lease,
                "worker_identity": identity}

    def agent(self, prompt, options):
        try:
            lease, label, identity = options["reservation"], options["label"], options["worker_identity"]
            with self._lock:
                live, row = self._live.get(lease), self._row(lease)
                if (live is None or row is None or live["label"] != label or live["identity"] != identity
                        or live["docker_id"] != docker_attempt_id(self.run, label, lease)
                        or (row["label"], row["state"], row["docker_id"], row["worker_identity"])
                        != (label, "reserved", live["docker_id"], identity)):
                    return None
                del self._live[lease]  # one launch per lease
        except (KeyError, TypeError, AttributeError):
            return None
        prepared = live["prepared"]
        try:
            self.ledger.start(lease, session=prepared.session_id)
        except ValueError:
            try:
                cancel_prepared_claude_worker_attempt(prepared)
            except (RuntimeError, ValueError):
                pass
            return None
        try:
            result = run_prepared_claude_worker_attempt(
                prepared, self.cli, prompt, container_worker=live["worker"],
                process_evidence_root=self.process_root, attempt_id=live["docker_id"], role=live["role"],
                timeout=self.timeout, approved_settings_sha256=self.settings, cancel_event=self.cancel_event)
        except Exception:
            result = None
        with self._lock:
            self._done[lease] = {**live, "result": result}
        return None if result is None else self._report(live, result)

    def _report(self, live, result):
        """Host evidence replaces every model-claimed field except the test claim."""
        record, path, label = live["record"], Path(live["record"]["path"]), live["label"]
        try:
            data = (self.process_root / live["docker_id"] / "stdout.bin").read_bytes()
            final = terminal_result([json.loads(line) for line in data.decode("utf-8").splitlines()
                                     if line.strip()], live["prepared"].session_id)
            claimed = json.loads(final["result"])
            tests = claimed.get("tests") if isinstance(claimed, dict) else None
        except _BAD:
            tests = None
        try:
            audit = self.worktrees.audit(record)
            changed, scope_ok = audit["changed_files"], audit["scope_ok"]
            if scope_ok and changed:
                self.worktrees.git(path, "add", "-A", "-f", "--", *changed)
                self.worktrees.git(path, "-c", "user.name=OmniHarness Swarm",
                                   "-c", "user.email=swarm@omniharness.invalid", "-c", "commit.gpgsign=false",
                                   "commit", "-q", "--no-verify", "-m", "swarm " + label)
            numstat = self.worktrees.git(path, "diff", "--numstat", "--no-renames", record["base"], "--")
            net = sum(int(added) - int(deleted) for added, deleted, _ in
                      (line.split("\t", 2) for line in numstat.splitlines()) if added != "-")
        except _BAD:
            changed, scope_ok, net = [], False, 0
        return {"task": label.split(":")[1], "worktree": record["path"], "branch": record["branch"],
                "base_commit": record["base"], "changed_files": changed, "net_lines": net, "tests": tests,
                "worker_identity": live["identity"],
                "execution_valid": result["receipt"].get("process_ok") is True
                and result["bridge_verified"] is True and scope_ok}

    def settle(self, lease):
        row = self._row(lease)
        if row is None:
            return None
        if row["state"] == "reserved" and not row["launched"]:
            self.cancel(lease)  # no model call happened
            return None
        docker_id = docker_attempt_id(self.run, row["label"], lease)
        if row["docker_id"] != docker_id:
            return None  # tampered binding: keep the reservation held
        attempt = self.process_root / docker_id
        stream = attempt / "stdout.bin"
        data = stream.read_bytes() if stream.is_file() else b""
        try:
            process = recover_attempt(self.process_root, docker_id)
            native = json.loads((attempt / "receipt.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            process, native = {}, {}
        agree = (hashlib.sha256(data).hexdigest() == process.get("stdout_sha256") == native.get("source_sha256")
                 and row["session"] == native.get("session_id") and native.get("usage_complete") is True)
        receipt = self.ledger.settle(lease, data, exit_code=process.get("exit_code"), issue=None if agree else
                                     "captured stream, process evidence and native receipt disagree")
        return {"usd": receipt["estimated_usd"], "tokens": receipt["total_tokens"],
                "usage_complete": receipt["usage_complete"], "usage_scope": receipt["usage_scope"],
                "attempt_id": row["label"], "reservation": lease, "worker_identity": row["worker_identity"],
                "source_sha256": receipt["source_sha256"], "token_categories": receipt["token_categories"],
                "billed_usd": None, "issues": receipt["issues"],
                "reservation_exceeded": receipt["reservation_exceeded"]}

    def verify(self, report, context):
        # ponytail: integrate would also need report.commit == host HEAD; closed until D3 lands
        try:
            lease, label = context["reservation"], context["label"]
            row, done = self._row(lease), self._done.get(lease)
            identity, result = row["worker_identity"], done["result"]
            stop = result["worker_stop"]
            ok = (row["label"] == done["label"] == label
                  and row["docker_id"] == done["docker_id"] == docker_attempt_id(self.run, label, lease)
                  and identity == done["identity"] == context["worker_identity"]
                  == context["admission"]["worker_identity"] == report["worker_identity"]
                  and stop.get("phase") == "cancelled" and stop.get("container_removed") is True
                  and result["bridge_verified"] is True
                  and self.worktrees.audit(done["record"])["scope_ok"] is True)
        except _BAD:
            return None
        return {"scope_ok": ok, "os_sandbox_verified": MANAGED_ADMISSION and ok, "attempt_id": label,
                "reservation": lease, "worker_identity": identity}


def serve(host, rfile, wfile):
    """JSON lines {id, op, args} -> {id, result} | {id, error}; one thread per request.

    A serial loop would let a sibling's worker lifetime expire while an earlier agent runs.
    """
    lock = threading.Lock()

    def answer(message):
        try:
            if message["op"] not in OPS or not isinstance(message["args"], list):
                raise ValueError("unknown operation or arguments")
            text = json.dumps({"id": message["id"], "result": getattr(host, message["op"])(*message["args"])})
        except Exception as error:
            text = json.dumps({"id": message.get("id") if isinstance(message, dict) else None,
                               "error": f"{type(error).__name__}: {error}"})
        with lock:
            wfile.write(text + "\n")
            wfile.flush()

    threads = []
    for line in rfile:
        if line.strip():
            try:
                message = json.loads(line)
            except ValueError:
                message = None
            threads.append(threading.Thread(target=answer, args=(message,)))
            threads[-1].start()
    for thread in threads:
        thread.join()
