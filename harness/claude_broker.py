"""Coordinator-configured MCP stdio bridge to one already-started ContainerWorker.

The Claude process hosts this trusted server, but the model sees only the
worker_command tool. Every command is checked and executed by ContainerWorker;
the broker never accepts host paths, Docker options, or a second attempt ID.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

from harness.container_worker import ContainerWorker
from harness.swarm_worktrees import Worktrees


SERVER = "omni_worker"
TOOL = "worker_command"
TOOL_NAME = "mcp__omni_worker__worker_command"
_MAX_REQUEST = 65536
_MAX_VISIBLE = 32768


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value


def _write_json(stream, value):
    stream.write((json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8"))
    stream.flush()


class Broker:
    def __init__(self, worker, *, attempt_id, session_id, events_path):
        self.worker = worker
        self.attempt_id = attempt_id
        self.session_id = session_id
        self.events_path = Path(events_path)
        self.negotiated = False
        self.initialized = False
        self.calls = 0
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        with self.events_path.open("x", encoding="utf-8") as stream:
            self._event(stream, {"event": "server_started", "attempt_id": attempt_id,
                                 "session_id": session_id})

    @staticmethod
    def _event(stream, event):
        stream.write(json.dumps(event, sort_keys=True) + "\n")
        stream.flush()
        os.fsync(stream.fileno())

    def _append(self, event):
        with self.events_path.open("a", encoding="utf-8") as stream:
            self._event(stream, event)

    def _tool(self, params):
        if not isinstance(params, dict) or params.get("name") != TOOL:
            raise ValueError("unknown tool")
        args = params.get("arguments")
        if not isinstance(args, dict) or set(args) - {"argv", "timeout_seconds"}:
            raise ValueError("worker_command accepts only argv and timeout_seconds")
        argv = args.get("argv")
        timeout = args.get("timeout_seconds", 30)
        if (not isinstance(argv, list) or not argv or len(argv) > 64
                or any(not isinstance(v, str) or not v or "\0" in v for v in argv)
                or sum(map(len, argv)) > 32768 or type(timeout) is not int
                or not 1 <= timeout <= 120):
            raise ValueError("bounded argv and timeout_seconds are required")
        self.calls += 1
        digest = hashlib.sha256(json.dumps(argv).encode()).hexdigest()
        try:
            result = self.worker.execute(self.attempt_id, argv, timeout=timeout)
        except Exception as error:
            self._append({"event": "tool_failed", "number": self.calls,
                          "attempt_id": self.attempt_id, "session_id": self.session_id,
                          "argv_sha256": digest, "error_type": type(error).__name__})
            raise
        self._append({"event": "tool_completed", "number": self.calls,
                      "attempt_id": self.attempt_id, "session_id": self.session_id,
                      "command_number": result["number"], "argv_sha256": digest,
                      "exit_code": result["exit_code"]})
        stdout = result["stdout"].decode("utf-8", errors="replace")[:_MAX_VISIBLE]
        stderr = result["stderr"].decode("utf-8", errors="replace")[:_MAX_VISIBLE]
        return {"content": [{"type": "text", "text": json.dumps({
            "command_number": result["number"], "exit_code": result["exit_code"],
            "stdout": stdout, "stderr": stderr, "task_pass": None,
            "output_truncated": len(result["stdout"]) > _MAX_VISIBLE or len(result["stderr"]) > _MAX_VISIBLE,
        })}], "isError": result["exit_code"] != 0}

    def handle(self, request):
        if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
            raise ValueError("JSON-RPC 2.0 object required")
        method = request.get("method")
        request_id = request.get("id")
        if request_id is not None and (type(request_id) not in (int, str)
                                       or isinstance(request_id, str) and len(request_id) > 128):
            raise ValueError("invalid request ID")
        if request_id is None:
            if method == "notifications/initialized" and self.negotiated:
                self.initialized = True
            return None  # notifications never dispatch tools
        if method == "initialize":
            params = request.get("params")
            if not isinstance(params, dict) or not isinstance(params.get("protocolVersion"), str):
                raise ValueError("initialize protocolVersion required")
            if self.negotiated:
                raise ValueError("session already initialized")
            self.negotiated = True
            requested = params["protocolVersion"]
            protocol = requested if requested in {"2024-11-05", "2025-03-26", "2025-06-18"} else "2025-06-18"
            result = {"protocolVersion": protocol,
                      "capabilities": {"tools": {"listChanged": False}},
                      "serverInfo": {"name": SERVER, "version": "1.0.0"}}
        elif not self.initialized:
            raise ValueError("initialize before tool requests")
        elif method == "tools/list":
            result = {"tools": [{"name": TOOL,
                        "description": "Run a bounded argv inside this attempt's isolated worker container. No host access; exit code is not task approval.",
                        "inputSchema": {"type": "object", "properties": {
                            "argv": {"type": "array", "minItems": 1, "maxItems": 64,
                                     "items": {"type": "string"}},
                            "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 120}},
                            "required": ["argv"], "additionalProperties": False}}]}
        elif method == "tools/call":
            try:
                result = self._tool(request.get("params"))
            except Exception as error:
                result = {"content": [{"type": "text", "text":
                           f"worker command rejected or failed: {type(error).__name__}"}],
                          "isError": True}
        elif method == "ping":
            result = {}
        else:
            return {"jsonrpc": "2.0", "id": request_id,
                    "error": {"code": -32601, "message": "method unavailable"}}
        return {"jsonrpc": "2.0", "id": request_id, "result": result}


def serve(broker, input_stream, output_stream):
    for raw in iter(lambda: input_stream.readline(_MAX_REQUEST + 1), b""):
        if len(raw) > _MAX_REQUEST:
            raise ValueError("MCP request exceeded 64 KiB")
        try:
            request = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
            response = broker.handle(request)
        except (UnicodeError, ValueError, TypeError):
            response = {"jsonrpc": "2.0", "id": None,
                        "error": {"code": -32600, "message": "invalid request"}}
        if response is not None:
            _write_json(output_stream, response)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binding", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args(argv)
    data = args.binding.read_bytes()
    if hashlib.sha256(data).hexdigest() != args.sha256:
        raise ValueError("broker binding changed after coordinator setup")
    binding = json.loads(data, object_pairs_hook=_unique_object)
    if not isinstance(binding, dict) or binding.get("schema_version") != 1:
        raise ValueError("unsupported broker binding")
    worktrees = Worktrees(binding["source"], binding["workers"])
    worker = ContainerWorker(worktrees, binding["record"],
                             evidence_root=binding["worker_evidence_root"],
                             docker=binding["docker"], image=binding["image"],
                             endpoint=binding["endpoint"],
                             lifetime_seconds=binding["lifetime_seconds"])
    broker = Broker(worker, attempt_id=binding["attempt_id"],
                    session_id=binding["session_id"], events_path=binding["events_path"])
    serve(broker, sys.stdin.buffer, sys.stdout.buffer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
