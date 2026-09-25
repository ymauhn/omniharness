"""Coordinator-owned evidence for one local native process attempt.

This is process capture, not an OS sandbox or a model-usage receipt. The caller
must keep the evidence root outside every worker's filesystem view and enforce
its own permission, budget and containment policy before launch.
"""
import hashlib
import json
import os
import re
import signal
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


_ATTEMPT = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
_TERMINAL = {"finished", "interrupted", "launch_failed", "unknown"}


def _stamp():
    return datetime.now(timezone.utc).isoformat()


def _write_state(path, state):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with temporary.open("x", encoding="utf-8") as stream:
        json.dump(state, stream, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def _file_evidence(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return size, digest.hexdigest()


def _terminate_tree(process):
    """Best-effort tree stop; the result must never be sold as containment."""
    if process.poll() is not None:
        return []
    issues = []
    try:
        if os.name == "nt":
            killed = subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=5, check=False,
            )
            if killed.returncode:
                issues.append("Windows process-tree stop was not confirmed")
        else:
            os.killpg(process.pid, signal.SIGKILL)
    except (OSError, subprocess.TimeoutExpired) as error:
        issues.append(f"process-tree stop failed: {type(error).__name__}")
    if process.poll() is None:
        try:
            process.kill()
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        issues.append("process exit could not be confirmed")
    return issues


def _validate(command, cwd, evidence_root, attempt_id, env, timeout, input_bytes, identity):
    if not isinstance(attempt_id, str) or not _ATTEMPT.fullmatch(attempt_id):
        raise ValueError("attempt_id must be a safe nonempty name")
    if not isinstance(command, (tuple, list)) or not command or any(not isinstance(item, str) for item in command):
        raise ValueError("command must be a nonempty argument vector")
    executable = Path(command[0])
    if not executable.is_absolute() or not executable.is_file():
        raise ValueError("command must start with an existing absolute executable")
    if os.name == "nt" and executable.suffix.lower() != ".exe":
        raise ValueError("Windows batch/script shims are not safe executable boundaries")
    worker = Path(cwd).resolve(strict=True)
    if not worker.is_dir():
        raise ValueError("cwd must be a directory")
    root = Path(evidence_root)
    if not root.is_absolute():
        raise ValueError("evidence_root must be absolute")
    root = root.resolve()
    if root == worker or root.is_relative_to(worker) or worker.is_relative_to(root):
        raise ValueError("evidence_root and worker cwd must be separate")
    if not isinstance(env, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in env.items()):
        raise ValueError("explicit string environment required")
    if timeout is not None and (type(timeout) not in (int, float) or not 0 < timeout <= 86400):
        raise ValueError("timeout must be positive and at most one day")
    if input_bytes is not None and not isinstance(input_bytes, bytes):
        raise ValueError("input_bytes must be bytes")
    if identity is not None and (not isinstance(identity, dict)
            or set(identity) - {"provider", "role", "session_id", "thread_id", "turn_id"}
            or any(not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value)
                   for value in identity.values())):
        raise ValueError("identity must contain only bounded provider/role/session/turn labels")
    return worker, root


def run_attempt(command, *, cwd, evidence_root, attempt_id, env, input_bytes=None,
                timeout=None, cancel_event=None, identity=None):
    """Launch once, capture streams, and never infer token use from process exit."""
    worker, root = _validate(command, cwd, evidence_root, attempt_id, env, timeout, input_bytes, identity)
    if cancel_event is not None and cancel_event.is_set():
        raise ValueError("attempt was cancelled before launch")
    root.mkdir(parents=True, exist_ok=True)
    attempt = root / attempt_id
    attempt.mkdir()  # exclusive: no replay of an uncertain attempt
    state_path = attempt / "state.json"
    stdout_path = attempt / "stdout.bin"
    stderr_path = attempt / "stderr.bin"
    state = {"schema_version": 1, "attempt_id": attempt_id, "identity": identity or {}, "state": "starting",
             "started_at": _stamp(), "finished_at": None, "pid": None,
             "exit_code": None, "termination": None, "process_ok": False,
             "usage_tokens": None, "stdout_bytes": None, "stdout_sha256": None,
             "stderr_bytes": None, "stderr_sha256": None, "issues": []}
    _write_state(state_path, state)
    with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
        try:
            process = subprocess.Popen(
                command, cwd=worker, env=env, shell=False,
                stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL,
                stdout=stdout, stderr=stderr,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                start_new_session=os.name != "nt",
            )
        except OSError as error:
            state.update(state="launch_failed", finished_at=_stamp(),
                         issues=[f"process launch failed: {type(error).__name__}"])
        else:
            try:
                state.update(state="running", pid=process.pid)
                _write_state(state_path, state)
                deadline = time.monotonic() + timeout if timeout is not None else None
                pending_input = input_bytes
                while True:
                    if process.poll() is not None:
                        process.communicate()
                        break
                    if cancel_event is not None and cancel_event.is_set():
                        state["termination"] = "cancel"
                        break
                    if deadline is not None and time.monotonic() >= deadline:
                        state["termination"] = "timeout"
                        break
                    interval = min(0.1, max(0.001, deadline - time.monotonic())) if deadline else 0.1
                    try:
                        process.communicate(input=pending_input, timeout=interval)
                        break
                    except subprocess.TimeoutExpired:
                        pending_input = None
                if state["termination"] is not None:
                    state["issues"].extend(_terminate_tree(process))
                    try:
                        process.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        state["issues"].append("process pipes could not be closed")
                state.update(state=("unknown" if state["issues"] else "interrupted")
                             if state["termination"] else "finished",
                             exit_code=process.returncode, finished_at=_stamp(),
                             process_ok=state["termination"] is None and process.returncode == 0)
            except BaseException:
                try:
                    _terminate_tree(process)
                except BaseException:
                    pass  # persisted 'starting'/'running' evidence remains unknown on recovery
                raise
    state["stdout_bytes"], state["stdout_sha256"] = _file_evidence(stdout_path)
    state["stderr_bytes"], state["stderr_sha256"] = _file_evidence(stderr_path)
    _write_state(state_path, state)
    return state


def recover_attempt(evidence_root, attempt_id):
    """On coordinator restart, preserve uncertainty; never relaunch or kill a PID."""
    if not isinstance(attempt_id, str) or not _ATTEMPT.fullmatch(attempt_id):
        raise ValueError("attempt_id must be a safe nonempty name")
    path = Path(evidence_root) / attempt_id / "state.json"
    if not path.parent.is_dir():
        raise FileNotFoundError(path.parent)
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {"schema_version": 1, "attempt_id": attempt_id, "state": "unknown"}
    if not isinstance(state, dict):
        raise ValueError("attempt manifest must be a JSON object")
    if state.get("attempt_id") != attempt_id or state.get("schema_version") != 1:
        raise ValueError("attempt manifest identity/version mismatch")
    if state.get("state") == "unknown":
        if "usage_tokens" not in state:
            state.update(finished_at=_stamp(), process_ok=False, usage_tokens=None,
                         issues=["orphan may still be running; no automatic relaunch or PID kill"])
            _write_state(path, state)
        return state
    if state.get("state") in _TERMINAL:
        return state
    state.update(state="unknown", finished_at=_stamp(), process_ok=False,
                 usage_tokens=None, issues=["orphan may still be running; no automatic relaunch or PID kill"])
    _write_state(path, state)
    return state
