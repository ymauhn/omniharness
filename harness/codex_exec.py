"""Fresh Codex CLI JSONL attempt on the owner's declared native allowance.

This records one process and one reported turn. It cannot prove that the turn
counter covers subagents, authenticate the billing channel, or isolate model
tools at the OS boundary. The coordinator must make those decisions separately.
"""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

from harness.native_process import recover_attempt, run_attempt


_ROLE = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
_ENV_KEYS = {
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "COMSPEC",
    "HOMEDRIVE", "HOMEPATH", "HOME", "CODEX_HOME", "XDG_CONFIG_HOME",
    "XDG_DATA_HOME", "XDG_CACHE_HOME", "LANG", "LC_ALL",
}
_CONTRACT = {
    "schema_version": 1, "provider": "codex", "protocol": "exec-jsonl",
    "usage_scope": "reported-turn", "counter_scope": "single-fresh-turn",
    "token_basis": "codex-exec-overlapping-subsets", "cost_basis": "unavailable",
}
_COUNTERS = ("input_tokens", "cached_input_tokens", "output_tokens",
             "reasoning_output_tokens")


def _no_duplicates(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _usage(value):
    if not isinstance(value, dict):
        raise ValueError("turn.completed requires a usage object")
    counts = {}
    for key in _COUNTERS:
        count = value.get(key)
        if type(count) is not int or count < 0:
            raise ValueError(f"missing or invalid Codex counter: {key}")
        counts[key] = count
    if (counts["cached_input_tokens"] > counts["input_tokens"]
            or counts["reasoning_output_tokens"] > counts["output_tokens"]):
        raise ValueError("cached/reasoning counters exceed their containing category")
    write = value.get("cache_write_input_tokens")
    if write is not None and (type(write) is not int or write < 0 or write > counts["input_tokens"]):
        raise ValueError("cache-write counter must be an input subset")
    counts["cache_write_input_tokens"] = write
    observed_total = counts["input_tokens"] + counts["output_tokens"]
    if "total_tokens" in value and (type(value["total_tokens"]) is not int
                                   or value["total_tokens"] != observed_total):
        raise ValueError("reported total disagrees with input + output")
    return counts, observed_total


def _base(data, exit_code):
    return {**_CONTRACT, "thread_id": None, "turn_id": None,
            "source_sha256": hashlib.sha256(data).hexdigest(),
            "exit_code": exit_code, "terminal_status": None,
            "process_ok": False, "execution_valid": False,
            "response_nonempty": False, "task_pass": False,
            "observed_token_categories": None, "observed_turn_tokens": None,
            "usage_observed": False, "total_tokens": None,
            "estimated_usd": None, "billed_usd": None,
            "usage_complete": False, "issues": []}


def unknown_codex_receipt(data, *, exit_code, issue):
    """Keep uncertain consumption unknown, including after crash or tamper."""
    if not isinstance(data, bytes):
        raise ValueError("captured stream must be bytes")
    receipt = _base(data, exit_code)
    receipt["issues"] = [issue]
    return receipt


def usage_from_codex_exec_jsonl(data: bytes, *, exit_code: int) -> dict:
    """Parse a single fresh exec stream; never claim a whole-tree total.

    The official JSONL example has a thread ID but no turn ID. A coordinator
    must capture the entire stdout of exactly one new, non-resumed invocation.
    """
    if not isinstance(data, bytes) or type(exit_code) is not int:
        raise ValueError("captured bytes and integer exit code required")
    try:
        events = [json.loads(line, object_pairs_hook=_no_duplicates)
                  for line in data.decode("utf-8").splitlines() if line.strip()]
    except UnicodeError as error:
        raise ValueError("Codex stream is not UTF-8") from error
    receipt = _base(data, exit_code)
    thread_started = turn_started = False
    terminal = None
    errors = []
    last_message = None
    categories = observed_tokens = None
    turn_id = None
    for event in events:
        if not isinstance(event, dict) or not isinstance(event.get("type"), str):
            raise ValueError("expected a JSONL event object with type")
        kind = event["type"]
        if terminal is not None and (kind in {"thread.started", "turn.started", "turn.completed", "turn.failed"}
                                     or kind.startswith("item.") or kind == "error"):
            raise ValueError("Codex activity after terminal turn")
        if kind == "thread.started":
            thread = event.get("thread_id")
            if thread_started or turn_started or not isinstance(thread, str) or not thread:
                raise ValueError("duplicate or invalid thread.started")
            thread_started = True
            receipt["thread_id"] = thread
        elif kind == "turn.started":
            if not thread_started or turn_started:
                raise ValueError("duplicate or unbound turn.started")
            if "thread_id" in event and event["thread_id"] != receipt["thread_id"]:
                raise ValueError("turn started for another thread")
            if "turn_id" in event:
                if not isinstance(event["turn_id"], str) or not event["turn_id"]:
                    raise ValueError("invalid turn ID")
                turn_id = event["turn_id"]
            turn_started = True
        elif kind == "item.completed":
            if not turn_started:
                raise ValueError("item before turn start")
            item = event.get("item")
            if not isinstance(item, dict):
                raise ValueError("item.completed lacks item object")
            if item.get("type") == "agent_message":
                if not isinstance(item.get("text"), str):
                    raise ValueError("agent message text must be a string")
                last_message = item["text"]
        elif kind.startswith("item."):
            if not turn_started:
                raise ValueError("item before turn start")
        elif kind in ("turn.completed", "turn.failed"):
            if not turn_started:
                raise ValueError("terminal turn without start")
            if "thread_id" in event and event["thread_id"] != receipt["thread_id"]:
                raise ValueError("terminal turn belongs to another thread")
            if "turn_id" in event:
                if not isinstance(event["turn_id"], str) or not event["turn_id"]:
                    raise ValueError("invalid terminal turn ID")
                if turn_id is not None and event["turn_id"] != turn_id:
                    raise ValueError("terminal turn ID mismatch")
                turn_id = event["turn_id"]
            terminal = "completed" if kind == "turn.completed" else "failed"
            if kind == "turn.completed":
                categories, observed_tokens = _usage(event.get("usage"))
            elif "usage" in event:
                categories, observed_tokens = _usage(event["usage"])
        elif kind == "error":
            errors.append("Codex emitted an error event")
    receipt.update(turn_id=turn_id, terminal_status=terminal,
                   response_nonempty=bool(last_message and last_message.strip()),
                   observed_token_categories=categories,
                   observed_turn_tokens=observed_tokens,
                   usage_observed=categories is not None,
                   process_ok=(exit_code == 0 and terminal == "completed"))
    issues = list(errors)
    if not thread_started:
        issues.append("thread start was not observed")
    if not turn_started:
        issues.append("turn start was not observed")
    if terminal is None:
        issues.append("terminal turn was not observed")
    elif terminal != "completed":
        issues.append("turn did not complete")
    if categories is None:
        issues.append("turn usage was not observed")
    else:
        issues.append("reported turn counter does not establish descendant coverage")
    if exit_code != 0:
        issues.append("Codex process exited unsuccessfully")
    receipt["issues"] = issues
    receipt["execution_valid"] = bool(receipt["process_ok"] and categories is not None and not errors)
    receipt["task_pass"] = None if receipt["execution_valid"] and receipt["response_nonempty"] else False
    return receipt


def _receipt(evidence_root, attempt_id, process):
    attempt = Path(evidence_root) / attempt_id
    source = attempt / "stdout.bin"
    data = source.read_bytes() if source.is_file() else b""
    code = process.get("exit_code")
    identity = process.get("identity")
    if (not isinstance(identity, dict) or identity.get("provider") != "codex"
            or not isinstance(identity.get("role"), str) or not _ROLE.fullmatch(identity["role"])):
        return unknown_codex_receipt(data, exit_code=code, issue="process provider identity is missing")
    if (process.get("stdout_sha256") != hashlib.sha256(data).hexdigest()
            or process.get("stdout_bytes") != len(data)):
        return unknown_codex_receipt(data, exit_code=code,
                                     issue="captured Codex stream differs from process evidence")
    if process.get("state") == "unknown":
        return unknown_codex_receipt(data, exit_code=code,
                                     issue="recovered process tree may still be running")
    if type(code) is not int:
        return unknown_codex_receipt(data, exit_code=code,
                                     issue="Codex process exit was not confirmed")
    try:
        receipt = usage_from_codex_exec_jsonl(data, exit_code=code)
    except (ValueError, UnicodeError) as error:
        return unknown_codex_receipt(data, exit_code=code,
                                     issue=f"Codex JSONL could not be bound: {error}")
    if process.get("state") != "finished":
        receipt["process_ok"] = False
        receipt["execution_valid"] = False
        receipt["task_pass"] = False
        receipt["issues"].append("process attempt ended without a normal finish")
    return receipt


def recover_codex_attempt(evidence_root, attempt_id):
    """Reconcile captured evidence; never resume or relaunch an unknown turn."""
    process = recover_attempt(evidence_root, attempt_id)
    receipt = _receipt(evidence_root, attempt_id, process)
    saved = Path(evidence_root) / attempt_id / "receipt.json"
    if saved.is_file():
        try:
            old = json.loads(saved.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            old = None
        if old != receipt:
            source = Path(evidence_root) / attempt_id / "stdout.bin"
            data = source.read_bytes() if source.is_file() else b""
            receipt = unknown_codex_receipt(data, exit_code=process.get("exit_code"),
                                             issue="persisted Codex receipt disagrees with current evidence")
    else:
        with saved.open("x", encoding="utf-8") as stream:
            json.dump(receipt, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    return {"process": process, "receipt": receipt}


def _preflight_auth(cli, worker, environment):
    """Require the same read-only CLI auth mode for the upcoming invocation."""
    try:
        status = subprocess.run([cli, "login", "status"], cwd=worker, env=environment,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError("Codex ChatGPT login preflight could not be confirmed") from None
    stdout = status.stdout.strip() if isinstance(status.stdout, str) else None
    stderr = status.stderr.strip() if isinstance(status.stderr, str) else None
    if status.returncode != 0 or not ((stdout, stderr) in (
            ("Logged in using ChatGPT", ""), ("", "Logged in using ChatGPT"))):
        raise ValueError("Codex ChatGPT login preflight did not confirm native allowance")


def run_codex_attempt(cli_executable, prompt, *, cwd, evidence_root, attempt_id,
                      role, timeout, billing_channel, sandbox_mode="workspace-write",
                      cancel_event=None):
    """Run exactly one fresh Codex `exec --json -` process with prompt on stdin."""
    if billing_channel != "native-allowance":
        raise ValueError("this adapter admits only the owner's declared native allowance")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("one nonempty prompt is required")
    if not isinstance(role, str) or not _ROLE.fullmatch(role):
        raise ValueError("role must be a bounded name")
    if sandbox_mode not in ("read-only", "workspace-write"):
        raise ValueError("sandbox mode must retain native permissions")
    if not isinstance(cli_executable, (str, Path)):
        raise ValueError("CLI executable must be one absolute path")
    cli = Path(cli_executable)
    if not cli.is_absolute() or not cli.is_file():
        raise ValueError("CLI executable must be one existing absolute file")
    if os.name == "nt" and cli.suffix.lower() != ".exe":
        raise ValueError("Windows batch/script shims are not safe CLI executables")
    worker = Path(cwd).resolve(strict=True)
    command = [str(cli), "exec", "--json", "--ephemeral", "--ignore-user-config",
               "-c", 'model_provider="openai"', "--sandbox", sandbox_mode,
               "-C", str(worker), "-"]
    environment = {key: value for key, value in os.environ.items() if key.upper() in _ENV_KEYS}
    _preflight_auth(str(cli), worker, environment)
    run_attempt(command, cwd=worker, evidence_root=evidence_root, attempt_id=attempt_id,
                env=environment, input_bytes=prompt.encode("utf-8"), timeout=timeout,
                cancel_event=cancel_event, identity={"provider": "codex", "role": role})
    return recover_codex_attempt(evidence_root, attempt_id)
