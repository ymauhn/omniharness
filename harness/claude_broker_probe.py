"""Model-free MCP stdio -> trusted broker -> real Docker worker canary.

Requires a local Linux Docker engine and the pinned official Python image.
Creates only disposable Git fixtures and one exact-identity container. It does
not launch Claude or establish native-agent containment, usage or task quality.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from .claude_broker import broker_bootstrap, source_hashes
from .claude_native import _ENV_KEYS
from .claude_worker_bridge import _verify_events
from .container_worker import ContainerWorker
from .container_worker_probe import _cleanup_fixture
from .native_process import _terminate_tree
from .sandbox_probe import WORKER, host_paths
from .swarm_worktrees import Worktrees


_CHILD_CHECKS = {"workspace_write", "root_write_denied", "outside_paths_inaccessible",
                 "docker_socket_absent", "no_capabilities", "no_new_privileges",
                 "non_root", "seccomp_active", "network_denied"}


def _unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _request(number, method, params=None):
    value = {"jsonrpc": "2.0", "id": number, "method": method}
    if params is not None:
        value["params"] = params
    return value


def _mcp_input(paths):
    command = ["python", "-I", "-c", WORKER, json.dumps(paths)]
    messages = [
        _request(1, "initialize", {"protocolVersion": "2025-06-18",
                                   "capabilities": {},
                                   "clientInfo": {"name": "omniharness-canary", "version": "1"}}),
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        _request(2, "tools/list"),
        _request(3, "tools/call", {"name": "worker_command",
                                   "arguments": {"argv": command, "timeout_seconds": 30}}),
        _request(4, "tools/call", {"name": "host_shell",
                                   "arguments": {"argv": ["whoami"]}}),
    ]
    return ("\n".join(json.dumps(message) for message in messages) + "\n").encode("utf-8")


def _parse_mcp_output(stdout):
    """Reject missing, duplicate, malformed or additional MCP responses."""
    lines = stdout.decode("utf-8").splitlines()
    values = [json.loads(line, object_pairs_hook=_unique_json) for line in lines]
    if (len(values) != 4 or any(not isinstance(value, dict) or value.get("jsonrpc") != "2.0"
                                or value.get("id") != index or "error" in value
                                or not isinstance(value.get("result"), dict)
                                for index, value in enumerate(values, start=1))):
        raise ValueError("MCP response sequence is incomplete or invalid")
    return [value["result"] for value in values]


def _tool_result(result):
    if (result.get("isError") is not False or not isinstance(result.get("content"), list)
            or len(result["content"]) != 1 or not isinstance(result["content"][0], dict)
            or result["content"][0].get("type") != "text"
            or not isinstance(result["content"][0].get("text"), str)):
        raise ValueError("worker tool response is not a successful text result")
    return json.loads(result["content"][0]["text"], object_pairs_hook=_unique_json)


def _git(root, source, *args):
    return subprocess.run(["git", "-c", "core.hooksPath=" + str(root / "no-hooks"), *args],
                          cwd=source, capture_output=True, text=True, encoding="utf-8",
                          check=True).stdout.strip()


def _broker_process(binding_path, binding_digest, source_sha256, request_bytes, cwd):
    code_root = Path(__file__).resolve().parent.parent
    code = broker_bootstrap(code_root, binding_path, binding_digest, source_sha256)
    command = [sys.executable, "-I", "-u", "-c", code,
               "--binding", str(binding_path), "--sha256", binding_digest]
    environment = {key: value for key, value in os.environ.items() if key.upper() in _ENV_KEYS}
    process = subprocess.Popen(command, cwd=cwd, env=environment, shell=False,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE,
                               creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                               start_new_session=os.name != "nt")
    try:
        stdout, stderr = process.communicate(request_bytes, timeout=90)
        return process.returncode, stdout, stderr
    except BaseException as error:
        issues = _terminate_tree(process)
        if issues:
            raise RuntimeError("MCP broker communication failed; process-tree stop unconfirmed") from error
        raise


def _preserve_fixture(*, create_uncertain, state_exists, cid_exists, stop_confirmed):
    return create_uncertain or (state_exists or cid_exists) and not stop_confirmed


def probe(*, docker, image, endpoint):
    started = time.monotonic()
    root = Path(tempfile.mkdtemp(prefix="omni-worker-acceptance-claude-broker-")).resolve(strict=True)
    if (not root.is_relative_to(Path(tempfile.gettempdir()).resolve(strict=True))
            or not root.name.startswith("omni-worker-acceptance-claude-broker-")):
        raise ValueError("disposable fixture path is outside the selected temp directory")
    worker = None
    issues = []
    checks = {}
    had_cid = False
    removed = False
    create_uncertain = False
    process_exited = False
    task_pass = None
    try:
        source = root / "source"
        source.mkdir()
        _git(root, source, "init")
        (source / "src").mkdir()
        (source / "src" / "base.txt").write_text("fixture\n", encoding="utf-8")
        _git(root, source, "add", "src")
        _git(root, source, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
             "-c", "commit.gpgsign=false", "commit", "-m", "broker fixture")
        host = Worktrees(source, root / "workers")
        base = _git(root, source, "rev-parse", "HEAD")
        own = host.create("probe", "own", base, ["src/**"])
        sibling = host.create("probe", "sibling", base, ["src/**"])
        work = Path(own["path"])
        (work / "src").chmod(0o777)
        private = root / "private"
        private.mkdir()
        (private / "home.txt").write_text("synthetic home sentinel", encoding="utf-8")
        (private / "ledger.txt").write_text("synthetic ledger sentinel", encoding="utf-8")
        read_paths = [private / "home.txt", private / "ledger.txt",
                      Path(sibling["path"]) / "src/base.txt", source / "src/base.txt",
                      source / ".git/HEAD"]
        write_paths = [private / "attempt.marker", Path(sibling["path"]) / "src/attempt.marker",
                       source / "src/attempt.marker", source / ".git/attempt.marker"]
        paths = {"read": [candidate for path in read_paths for candidate in host_paths(path)],
                 "write": [candidate for path in write_paths for candidate in host_paths(path)]}
        evidence = root / "coordinator-evidence"
        worker = ContainerWorker(host, own, evidence_root=evidence, docker=docker,
                                 image=image, endpoint=endpoint)
        session = str(uuid.uuid4())
        attempt = "canary"
        events = root / "broker-events.jsonl"
        started_worker = worker.start(attempt)
        binding = {"schema_version": 1, "attempt_id": attempt, "session_id": session,
                   "cid": started_worker["cid"], "nonce": started_worker["nonce"],
                   "source_sha256": source_hashes(Path(__file__).resolve().parent.parent),
                   "source": str(host.source), "workers": str(host.workers), "record": own,
                   "worker_evidence_root": str(evidence), "docker": str(worker.docker),
                   "image": image, "endpoint": endpoint,
                   "lifetime_seconds": worker.lifetime_seconds,
                   "events_path": str(events)}
        binding_path = root / "broker-binding.json"
        with binding_path.open("x", encoding="utf-8") as stream:
            json.dump(binding, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        digest = hashlib.sha256(binding_path.read_bytes()).hexdigest()
        exit_code, stdout, stderr = _broker_process(binding_path, digest,
                                                    binding["source_sha256"], _mcp_input(paths), work)
        process_exited = True
        checks["mcp_process_exited_zero"] = exit_code == 0
        checks["mcp_stderr_empty"] = not stderr
        initialize, listed, called, rejected = _parse_mcp_output(stdout)
        checks["mcp_protocol_negotiated"] = (initialize.get("protocolVersion") == "2025-06-18"
                                             and "tools" in initialize.get("capabilities", {}))
        tools = listed.get("tools")
        checks["one_worker_tool_listed"] = (isinstance(tools, list) and len(tools) == 1
                                            and isinstance(tools[0], dict)
                                            and tools[0].get("name") == "worker_command")
        response = _tool_result(called)
        task_pass = response.get("task_pass")
        checks["tool_command_exited_zero"] = response.get("exit_code") == 0 and response.get("stderr") == ""
        checks["no_automatic_task_pass"] = "task_pass" in response and task_pass is None
        checks["unknown_host_tool_rejected"] = rejected.get("isError") is True
        child = json.loads(response["stdout"], object_pairs_hook=_unique_json)
        checks["child_report_boolean"] = (isinstance(child, dict) and set(child) == _CHILD_CHECKS
                                          and all(type(value) is bool for value in child.values()))
        if isinstance(child, dict):
            checks.update(child)
        checks["worker_artifact_verified"] = (work / "src/output.txt").read_text(encoding="utf-8") == "contained worker\n"
        checks["source_and_sibling_unchanged"] = (
            not _git(root, source, "status", "--porcelain")
            and (Path(sibling["path"]) / "src/base.txt").read_text(encoding="utf-8") == "fixture\n"
            and not (Path(sibling["path"]) / "src/output.txt").exists())
        checks["private_sentinels_unchanged"] = (
            (private / "home.txt").read_text(encoding="utf-8") == "synthetic home sentinel"
            and (private / "ledger.txt").read_text(encoding="utf-8") == "synthetic ledger sentinel")
        checks["outside_markers_absent"] = all(not path.exists() for path in write_paths)
        audit = host.audit(own)
        checks["actual_scope_audited"] = audit["scope_ok"] and audit["changed_files"] == ["src/output.txt"]
        command_state = json.loads((evidence / attempt / "state.json").read_text(encoding="utf-8"))
        broker = _verify_events(events, attempt_id=attempt, session_id=session,
                                worker_state=command_state)
        checks["broker_events_bound_to_worker"] = broker["verified"] and broker["calls"] == 1
        checks["one_worker_command_recorded"] = len(command_state.get("commands", [])) == 1
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError,
            UnicodeError, KeyError, TypeError) as error:
        issues.append(f"probe failed: {type(error).__name__}")
        if "process-tree stop unconfirmed" in str(error):
            create_uncertain = True
    finally:
        state_path = root / "coordinator-evidence" / "canary" / "state.json"
        cidfile = state_path.parent / "cid"
        if state_path.is_file():
            try:
                current = json.loads(state_path.read_text(encoding="utf-8"))
                create_uncertain |= any("container may remain" in item for item in current.get("issues", []))
                had_cid = bool(current.get("cid"))
                if current.get("container_removed") is True:
                    stopped = current
                elif worker is not None and had_cid:
                    stopped = worker.cancel("canary")
                else:
                    stopped = current
                removed = stopped.get("container_removed") is True
                checks["exact_container_removed"] = removed and stopped.get("phase") == "cancelled"
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                issues.append(f"owned container cancellation unconfirmed: {type(error).__name__}")
                create_uncertain = True
        else:
            checks["exact_container_removed"] = False
        preserve = _preserve_fixture(create_uncertain=create_uncertain,
                                     state_exists=state_path.is_file(),
                                     cid_exists=cidfile.is_file(),
                                     stop_confirmed=checks.get("exact_container_removed") is True)
        if not preserve:
            try:
                _cleanup_fixture(root)
            except (OSError, ValueError) as error:
                issues.append(f"disposable fixture cleanup failed: {type(error).__name__}")
                preserve = True
        checks["disposable_fixture_removed"] = not preserve and not root.exists()
    passed = bool(checks and all(value is True for value in checks.values()) and not issues)
    report = {"schema_version": 1, "backend": "claude-mcp-container-worker",
              "image": image, "endpoint_kind": "npipe" if endpoint.startswith("npipe:") else "unix",
              "passed": passed, "checks": checks, "issues": issues,
              "task_pass": task_pass, "model_invoked": False, "tokens": None,
              "broker_process_exited": process_exited,
              "fixture_preserved_for_triage": preserve,
              "scope": "model-free MCP dispatch to disposable Docker worker; no native Claude agent containment or provider usage",
              "wall_seconds": round(time.monotonic() - started, 3)}
    if preserve:
        report["triage_path"] = str(root)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--endpoint", required=True)
    args = parser.parse_args(argv)
    result = probe(docker=args.docker, image=args.image, endpoint=args.endpoint)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
