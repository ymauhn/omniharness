"""Codex App Server dynamic-tool broker for one coordinator-owned worker.

This module handles the App Server's experimental ``item/tool/call`` request.
It deliberately does not start a model turn: the current App Server has no
documented global built-in tool allowlist, so advertising this tool alone
cannot establish that host file/command tools are unavailable to the agent.
"""

import hashlib
import json
import os
import queue
import re
import subprocess
import threading
import time
from pathlib import Path


TOOL_NAME = "omni_worker_exec"
_IDENTITY = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
_SAFE_EVENTS = {"userMessage", "agentMessage", "reasoning", "plan"}
_MAX_CAPTURE = 1024 * 1024
_ENV_KEYS = {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR",
             "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "COMSPEC",
             "HOMEDRIVE", "HOMEPATH", "HOME", "CODEX_HOME", "LANG", "LC_ALL"}


def dynamic_tool_spec():
    """Documented ``thread/start.dynamicTools`` schema; native turn use is unproven."""
    return {"type": "function", "name": TOOL_NAME,
            "description": "Run one bounded argv in the coordinator-owned isolated worker.",
            "inputSchema": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "argv": {"type": "array", "minItems": 1, "maxItems": 64,
                             "items": {"type": "string"}},
                    "timeoutSeconds": {"type": "integer", "minimum": 1, "maximum": 120},
                }, "required": ["argv", "timeoutSeconds"]}}


def initialize_request():
    """Experimental API opt-in is necessary for dynamicTools, not an isolation proof."""
    return {"id": 1, "method": "initialize", "params": {
        "clientInfo": {"name": "omniharness", "title": "OmniHarness worker broker",
                       "version": "0.1.0"},
        "capabilities": {"experimentalApi": True}}}


def _valid_id(value):
    return isinstance(value, str) and bool(_IDENTITY.fullmatch(value))


def _failure(request_id, reason):
    return {"id": request_id,
            "result": {"contentItems": [{"type": "inputText", "text": reason}],
                       "success": False}}


def _valid_wire_version(message):
    # The installed App Server's JSONL envelopes omit `jsonrpc`; tolerate an
    # explicit 2.0 field from older clients without requiring or emitting it.
    return "jsonrpc" not in message or message["jsonrpc"] == "2.0"


class CodexToolBridge:
    """Dispatch only one bound dynamic tool to a live ContainerWorker instance.

    One bridge belongs to one turn and one process. Its call-ID set refuses
    replay in that process; after a crash, neither a turn nor a command may be
    resumed without coordinator reconciliation of the worker ledger.
    """

    def __init__(self, worker, *, attempt_id, thread_id, turn_id):
        if not all(map(_valid_id, (attempt_id, thread_id, turn_id))):
            raise ValueError("bounded attempt, thread and turn IDs required")
        if not callable(getattr(worker, "execute", None)) or not callable(getattr(worker, "cancel", None)):
            raise ValueError("a coordinator-owned worker is required")
        self.worker = worker
        self.attempt_id = attempt_id
        self.thread_id = thread_id
        self.turn_id = turn_id
        self._seen_calls = set()
        self._unsafe_events = []
        self._tool_calls = []

    @property
    def turn_admission(self):
        """No current Codex API proves built-in tools absent before a turn."""
        return {"admitted": False, "reason": "exclusive native tool inventory is unverified"}

    def handle_tool_call(self, request):
        """Return an App Server JSONL response; never execute an unknown call."""
        if not isinstance(request, dict) or not _valid_wire_version(request) or request.get("method") != "item/tool/call":
            raise ValueError("expected item/tool/call App Server request")
        request_id = request.get("id")
        if type(request_id) is not int and not _valid_id(request_id):
            raise ValueError("bounded JSON-RPC request ID required")
        params = request.get("params")
        if not isinstance(params, dict):
            return _failure(request_id, "Invalid tool call parameters")
        call_id = params.get("callId")
        if not _valid_id(call_id) or call_id in self._seen_calls:
            return _failure(request_id, "Missing or repeated tool call identity")
        self._seen_calls.add(call_id)
        if (params.get("threadId") != self.thread_id or params.get("turnId") != self.turn_id
                or params.get("tool") != TOOL_NAME or "namespace" not in params
                or params["namespace"] is not None):
            return _failure(request_id, "Tool call is outside this worker turn")
        arguments = params.get("arguments")
        if not isinstance(arguments, dict) or set(arguments) != {"argv", "timeoutSeconds"}:
            return _failure(request_id, "Invalid worker arguments")
        argv, timeout = arguments["argv"], arguments["timeoutSeconds"]
        if (not isinstance(argv, list) or not 1 <= len(argv) <= 64
                or any(not isinstance(item, str) or not item or "\0" in item for item in argv)
                or sum(len(item) for item in argv) > 32768
                or type(timeout) is not int or not 1 <= timeout <= 120):
            return _failure(request_id, "Worker argv or timeout is out of bounds")
        arguments_hash = hashlib.sha256(json.dumps(arguments, sort_keys=True).encode()).hexdigest()
        try:
            result = self.worker.execute(self.attempt_id, argv, timeout=timeout)
            if (not isinstance(result, dict) or type(result.get("exit_code")) is not int
                    or not isinstance(result.get("stdout"), bytes)
                    or not isinstance(result.get("stderr"), bytes)
                    or type(result.get("number")) is not int
                    or len(result["stdout"]) > _MAX_CAPTURE or len(result["stderr"]) > _MAX_CAPTURE):
                raise ValueError("worker did not return a bounded command receipt")
            self._tool_calls.append({"call_id": call_id, "arguments_sha256": arguments_hash,
                                     "worker_command": result["number"],
                                     "exit_code": result["exit_code"]})
            output = {"worker_command": result["number"], "exit_code": result["exit_code"],
                      "stdout": result["stdout"].decode("utf-8", errors="replace"),
                      "stderr": result["stderr"].decode("utf-8", errors="replace"),
                      "task_pass": None}
            return {"id": request_id,
                    "result": {"contentItems": [{"type": "inputText", "text": json.dumps(output)}],
                               "success": result["exit_code"] == 0}}
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError):
            self._tool_calls.append({"call_id": call_id, "arguments_sha256": arguments_hash,
                                     "worker_command": None, "exit_code": None})
            return _failure(request_id, "Worker command failed; execution and usage may be unknown")

    def observe_notification(self, event):
        """Flag visible native tools; detection is not a preventative boundary."""
        if not isinstance(event, dict) or not _valid_wire_version(event):
            raise ValueError("expected App Server notification")
        if event.get("method") not in ("item/started", "item/completed"):
            return
        params = event.get("params")
        if not isinstance(params, dict):
            raise ValueError("item notification lacks params")
        if params.get("threadId") != self.thread_id or params.get("turnId") != self.turn_id:
            return
        item = params.get("item")
        kind = item.get("type") if isinstance(item, dict) else None
        own_dynamic_tool = (kind == "dynamicToolCall" and item.get("tool") == TOOL_NAME
                            and "namespace" in item and item["namespace"] is None
                            and _valid_id(item.get("id")))
        if kind not in _SAFE_EVENTS and not own_dynamic_tool:
            unsafe = {"method": event["method"], "type": kind}
            if isinstance(item, dict):
                for key in ("tool", "name", "namespace"):
                    if key in item:
                        unsafe[key] = item[key]
            self._unsafe_events.append(unsafe)

    def observation(self):
        return {"thread_id": self.thread_id, "turn_id": self.turn_id,
                "worker_tool_calls": list(self._tool_calls),
                "unsafe_native_events": list(self._unsafe_events),
                "exclusive_tool_inventory_verified": False,
                "host_tool_isolation_certified": False}

    def cancel_worker(self):
        return self.worker.cancel(self.attempt_id)

    def interrupt_request(self):
        """Coordinator must send this if a native-tool event or cancel is observed."""
        return {"id": 2, "method": "turn/interrupt",
                "params": {"threadId": self.thread_id, "turnId": self.turn_id}}


def validate_app_server_initialize(data):
    """Read-only handshake parser. A handshake cannot certify tool isolation."""
    if not isinstance(data, bytes):
        raise ValueError("captured stdout must be bytes")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate App Server JSON key")
            result[key] = value
        return result
    events = [json.loads(line, object_pairs_hook=unique)
              for line in data.decode("utf-8").splitlines() if line.strip()]
    matches = [event for event in events if isinstance(event, dict) and event.get("id") == 1]
    if (len(matches) != 1 or not _valid_wire_version(matches[0])
            or not isinstance(matches[0].get("result"), dict) or "error" in matches[0]):
        raise ValueError("App Server initialize response missing or failed")
    if not all(isinstance(matches[0]["result"].get(key), str) and matches[0]["result"][key]
               for key in ("userAgent", "codexHome", "platformFamily", "platformOs")):
        raise ValueError("App Server initialize response lacks required platform fields")
    return {"app_server_handshake": True, "dynamic_api_requested": True,
            "exclusive_tool_inventory_verified": False,
            "host_tool_isolation_certified": False}


def probe_app_server(executable, *, timeout=10):
    """Real, model-free stdio handshake against one installed Codex executable."""
    if type(timeout) not in (int, float) or not 0 < timeout <= 30:
        raise ValueError("bounded handshake timeout required")
    if not isinstance(executable, (str, Path)):
        raise ValueError("one absolute Codex executable required")
    cli = Path(executable)
    if not cli.is_absolute() or not cli.is_file() or os.name == "nt" and cli.suffix.lower() != ".exe":
        raise ValueError("one existing absolute executable required")
    environment = {key: value for key, value in os.environ.items() if key.upper() in _ENV_KEYS}
    request = (json.dumps(initialize_request(), separators=(",", ":")) + "\n").encode()
    try:
        process = subprocess.Popen([str(cli), "app-server", "--stdio"],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, env=environment)
    except OSError:
        raise RuntimeError("App Server model-free handshake did not start") from None
    captured = bytearray()
    response_found = False
    replies = queue.Queue()

    def read_lines():
        while True:
            line = process.stdout.readline(_MAX_CAPTURE + 1)
            replies.put(line)
            if not line or len(line) > _MAX_CAPTURE:
                return

    reader = threading.Thread(target=read_lines, daemon=True)
    try:
        process.stdin.write(request)
        process.stdin.flush()
        reader.start()
        deadline = time.monotonic() + timeout
        while not response_found:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("App Server model-free handshake timed out")
            try:
                line = replies.get(timeout=remaining)
            except queue.Empty:
                raise RuntimeError("App Server model-free handshake timed out") from None
            if not line or len(captured) + len(line) > _MAX_CAPTURE:
                raise RuntimeError("App Server model-free handshake did not complete")
            captured.extend(line)
            try:
                event = json.loads(line)
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ValueError("App Server emitted invalid JSONL") from None
            response_found = isinstance(event, dict) and event.get("id") == 1
    except OSError:
        raise RuntimeError("App Server model-free handshake did not complete") from None
    finally:
        try:
            process.stdin.close()
        except OSError:
            pass
        try:
            exit_code = process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            exit_code = process.wait(timeout=1)
        if reader.ident is not None:
            reader.join(timeout=1)
    if exit_code != 0:
        raise RuntimeError("App Server model-free handshake exited unsuccessfully")
    return validate_app_server_initialize(bytes(captured))
