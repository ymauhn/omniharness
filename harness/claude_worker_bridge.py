"""One fresh restricted Claude turn with a coordinator-owned Docker tool broker.

This binds process, MCP startup, broker events and container lifecycle. A sound
offline binding is still not a live isolation or provider-billing certificate.
"""
import hashlib
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

from harness.claude_broker import SERVER, TOOL_NAME
from harness.claude_native import run_claude_attempt
from harness.claude_tool_inventory import inspect_init
from harness.container_worker import ATTEMPT


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value


def _save_new(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def _verify_events(path, *, attempt_id, session_id, worker_state):
    try:
        events = [json.loads(line, object_pairs_hook=_unique_object)
                  for line in path.read_text(encoding="utf-8").splitlines()]
    except (OSError, UnicodeError, ValueError):
        return {"verified": False, "calls": 0, "issues": ["broker events missing or invalid"]}
    if (not events or events[0] != {"event": "server_started", "attempt_id": attempt_id,
                                     "session_id": session_id}):
        return {"verified": False, "calls": 0, "issues": ["broker startup identity differs"]}
    commands = worker_state.get("commands", []) if isinstance(worker_state, dict) else []
    if not isinstance(commands, list):
        commands = []
    completed = events[1:]
    good = len(completed) == len(commands) and all(
        isinstance(event, dict) and event.get("event") == "tool_completed"
        and event.get("attempt_id") == attempt_id and event.get("session_id") == session_id
        and event.get("number") == index and event.get("command_number") == index
        and isinstance(command, dict) and command.get("number") == index
        and command.get("state") == "completed"
        and event.get("argv_sha256") == command.get("argv_sha256")
        and event.get("exit_code") == command.get("exit_code")
        for index, (event, command) in enumerate(zip(completed, commands), start=1)
    )
    return {"verified": good, "calls": len(completed),
            "issues": [] if good else ["broker events and worker command ledger differ"]}


def _verify_claude_tools(data, *, session_id, worker_state):
    """Bind complete Claude tool_use/tool_result pairs to the worker ledger."""
    try:
        events = [json.loads(line, object_pairs_hook=_unique_object)
                  for line in data.decode("utf-8").splitlines() if line.strip()]
    except (UnicodeError, ValueError):
        return {"verified": False, "calls": 0, "results": 0,
                "issues": ["Claude tool stream missing or invalid"]}
    commands = worker_state.get("commands", []) if isinstance(worker_state, dict) else []
    if not isinstance(commands, list):
        commands = []
    uses = []
    results = []
    for event in events:
        if not isinstance(event, dict) or event.get("session_id", session_id) != session_id:
            return {"verified": False, "calls": len(uses), "results": len(results),
                    "issues": ["Claude event or session identity is invalid"]}
        if event.get("type") not in {"assistant", "user"}:
            continue
        message = event.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            return {"verified": False, "calls": len(uses), "results": len(results),
                    "issues": ["Claude message content is invalid"]}
        for block in content:
            if not isinstance(block, dict):
                return {"verified": False, "calls": len(uses), "results": len(results),
                        "issues": ["Claude content block is invalid"]}
            if block.get("type") == "tool_use" and event["type"] == "assistant":
                uses.append(block)
            elif block.get("type") == "tool_result" and event["type"] == "user":
                results.append(block)
    ids = [block.get("id") for block in uses]
    result_ids = [block.get("tool_use_id") for block in results]
    good = (bool(commands) and len(uses) == len(commands) == len(results)
            and all(isinstance(item, str) and item for item in ids)
            and len(set(ids)) == len(ids) and result_ids == ids)
    if good:
        for block, command in zip(uses, commands):
            arguments = block.get("input")
            argv = arguments.get("argv") if isinstance(arguments, dict) else None
            if (block.get("name") != TOOL_NAME or not isinstance(argv, list)
                    or any(not isinstance(arg, str) for arg in argv)
                    or hashlib.sha256(json.dumps(argv).encode()).hexdigest()
                    != command.get("argv_sha256")):
                good = False
                break
    return {"verified": good, "calls": len(uses), "results": len(results),
            "issues": [] if good else ["Claude tool events and worker command ledger differ"]}


def run_claude_worker_attempt(cli_executable, prompt, *, container_worker,
                              process_evidence_root, attempt_id, role, timeout,
                              approved_settings_sha256=None, cancel_event=None,
                              python_executable=None):
    """Start once, dispatch via one MCP tool, then stop the exact owned worker."""
    if not isinstance(attempt_id, str) or not ATTEMPT.fullmatch(attempt_id):
        raise ValueError("invalid attempt identifier")
    if type(timeout) not in (int, float) or not 0 < timeout < container_worker.lifetime_seconds - 5:
        raise ValueError("Claude timeout must fit inside the worker lifetime")
    if cancel_event is not None and cancel_event.is_set():
        raise ValueError("attempt cancelled before worker start")
    worker_path = container_worker.worker
    root = Path(process_evidence_root)
    if not root.is_absolute():
        raise ValueError("process evidence root must be absolute")
    root = root.resolve()
    if root == worker_path or root.is_relative_to(worker_path) or worker_path.is_relative_to(root):
        raise ValueError("process evidence must stay outside the worker")
    python = Path(python_executable or sys.executable)
    if not python.is_absolute() or not python.is_file() or os.name == "nt" and python.suffix.lower() != ".exe":
        raise ValueError("one absolute Python executable is required for the trusted MCP broker")
    session = str(uuid.uuid4())
    bridge_dir = root / "_bridge" / attempt_id
    bridge_dir.mkdir(parents=True)  # no replay of an uncertain attempt
    events = bridge_dir / "events.jsonl"
    binding = {
        "schema_version": 1, "attempt_id": attempt_id, "session_id": session,
        "source": str(container_worker.worktrees.source),
        "workers": str(container_worker.worktrees.workers),
        "record": container_worker.record,
        "worker_evidence_root": str(container_worker.root),
        "docker": str(container_worker.docker), "image": container_worker.image,
        "endpoint": container_worker.endpoint,
        "lifetime_seconds": container_worker.lifetime_seconds,
        "events_path": str(events),
    }
    binding_path = bridge_dir / "binding.json"
    _save_new(binding_path, binding)
    digest = hashlib.sha256(binding_path.read_bytes()).hexdigest()
    code_root = Path(__file__).resolve().parent.parent
    python_code = ("import sys; sys.path.insert(0, " + repr(str(code_root))
                   + "); from harness.claude_broker import main; raise SystemExit(main())")
    mcp = {"mcpServers": {SERVER: {"type": "stdio", "command": str(python),
                                 "args": ["-I", "-u", "-c", python_code,
                                          "--binding", str(binding_path), "--sha256", digest]}}}
    config_path = bridge_dir / "mcp.json"
    _save_new(config_path, mcp)
    native = None
    native_error = None
    try:
        container_worker.start(attempt_id)
        native = run_claude_attempt(
            cli_executable, prompt, cwd=worker_path, evidence_root=root,
            attempt_id=attempt_id, role=role, timeout=timeout,
            billing_channel="native-allowance",
            approved_settings_sha256=approved_settings_sha256,
            cancel_event=cancel_event, restricted_mcp_config=config_path,
            session_id=session)
    except BaseException as error:
        native_error = error
    finally:
        try:
            stopped = container_worker.cancel(attempt_id)
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
            stopped = {"phase": "unknown", "issues": ["exact worker stop unconfirmed"]}
            stop_error = error
        else:
            stop_error = None
    if native_error is not None:
        if stopped.get("phase") != "cancelled":
            stop_error = stop_error or RuntimeError("exact worker stop unconfirmed")
            raise BaseExceptionGroup("Claude attempt failed and exact worker stop unconfirmed",
                                     [native_error, stop_error])
        raise native_error
    if stop_error is not None:
        raise RuntimeError("exact worker stop unconfirmed") from stop_error
    source = root / attempt_id / "stdout.bin"
    process = native["process"]
    data = source.read_bytes() if source.is_file() else b""
    if (process.get("stdout_bytes") != len(data)
            or process.get("stdout_sha256") != hashlib.sha256(data).hexdigest()):
        inventory = {"verified": False, "issues": ["Claude stream differs from captured evidence"]}
    else:
        inventory = inspect_init(data, session_id=session, expected_tools={TOOL_NAME},
                                 server_name=SERVER)
    broker = _verify_events(events, attempt_id=attempt_id, session_id=session,
                            worker_state=stopped)
    claude_tools = _verify_claude_tools(data, session_id=session, worker_state=stopped)
    receipt = native["receipt"]
    verified = (process.get("state") == "finished" and process.get("process_ok") is True
                and receipt.get("usage_complete") is True and receipt.get("session_id") == session
                and stopped.get("phase") == "cancelled" and inventory["verified"]
                and broker["verified"] and broker["calls"] > 0
                and claude_tools["verified"] and claude_tools["calls"] == broker["calls"])
    return {**native, "tool_inventory": inventory, "broker": broker,
            "claude_tools": claude_tools,
            "worker_stop": stopped, "bridge_verified": verified,
            "task_pass": None}
