"""Fresh Claude CLI attempt on the native allowance, with offline-verifiable receipts.

This adapter does not establish OS isolation or approve a paid API channel. The
coordinator must establish worktree trust, tool permissions and containment for
the intended experiment before dispatch. Project settings are hash-pinned here
because Claude print mode bypasses the workspace trust dialog.
"""
import hashlib
import json
import os
import re
import subprocess
import uuid
from pathlib import Path

from harness.native_process import recover_attempt, run_attempt
from harness.swarm_accounting import unknown_receipt, usage_from_stream


_ENV_KEYS = {
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "COMSPEC",
    "HOMEDRIVE", "HOMEPATH", "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
    "XDG_CACHE_HOME", "LANG", "LC_ALL",
}
_ROLE = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")


def _reviewed_project_settings(worker, approved_sha256):
    settings = worker / ".claude" / "settings.json"
    if settings.is_file():
        contents = settings.read_bytes()
        try:
            parsed = json.loads(contents)
        except (UnicodeError, ValueError):
            raise ValueError("project Claude settings are not valid JSON") from None
        if not isinstance(parsed, dict):
            raise ValueError("project Claude settings must be a JSON object")
        if {"apiKeyHelper", "awsAuthRefresh", "awsCredentialExport"} & parsed.keys():
            raise ValueError("project Claude settings cannot override subscription credentials")
        if "env" in parsed:
            raise ValueError("project Claude env settings cannot override native routing")
        actual = hashlib.sha256(contents).hexdigest()
        if approved_sha256 != actual:
            raise ValueError("project Claude settings require the reviewed SHA-256")
    elif approved_sha256 is not None:
        raise ValueError("reviewed settings hash was supplied, but settings are absent")


def _preflight_auth(cli, worker, environment):
    """Read only the status summary; reject API-key/other accounts before launch."""
    try:
        status = subprocess.run(
            [cli, "auth", "status", "--json"], cwd=worker, env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, timeout=10, check=False,
        )
        info = json.loads(status.stdout)
    except (OSError, subprocess.TimeoutExpired, UnicodeError, ValueError):
        raise ValueError("Claude subscription auth preflight could not be confirmed") from None
    if (status.returncode != 0 or not isinstance(info, dict)
            or info.get("loggedIn") is not True or info.get("authMethod") != "claude.ai"
            or info.get("apiProvider") != "firstParty"
            or not isinstance(info.get("subscriptionType"), str)
            or not info["subscriptionType"]):
        raise ValueError("Claude subscription auth preflight did not confirm native allowance")


def _receipt(evidence_root, attempt_id, process):
    attempt = Path(evidence_root) / attempt_id
    identity = process.get("identity")
    session = identity.get("session_id") if isinstance(identity, dict) else None
    source = attempt / "stdout.bin"
    data = source.read_bytes() if source.is_file() else b""
    if (not isinstance(identity, dict) or identity.get("provider") != "claude-code"
            or not isinstance(identity.get("role"), str) or not _ROLE.fullmatch(identity["role"])
            or not isinstance(session, str) or not session):
        return unknown_receipt(data, session=session if isinstance(session, str) else None,
                               exit_code=process.get("exit_code"),
                               issue="launched Claude provider, role or session identity is missing")
    if (process.get("stdout_sha256") != hashlib.sha256(data).hexdigest()
            or process.get("stdout_bytes") != len(data)):
        return unknown_receipt(data, session=session, exit_code=process.get("exit_code"),
                               issue="captured Claude stream differs from process evidence")
    if process.get("state") == "unknown":
        return unknown_receipt(data, session=session, exit_code=process.get("exit_code"),
                               issue="process tree or recovered attempt remains unresolved")
    if type(process.get("exit_code")) is not int:
        return unknown_receipt(data, session=session, exit_code=process.get("exit_code"),
                               issue="process exit was not confirmed")
    try:
        receipt = usage_from_stream(data, session=session, exit_code=process["exit_code"])
    except (ValueError, UnicodeError) as error:
        return unknown_receipt(data, session=session, exit_code=process["exit_code"],
                               issue=f"Claude result could not be bound: {error}")
    if process.get("state") != "finished" or not process.get("process_ok"):
        receipt["process_ok"] = False
    return receipt


def recover_claude_attempt(evidence_root, attempt_id):
    """Read existing evidence once; never resume or re-launch an unknown attempt."""
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
            identity = process.get("identity")
            session = identity.get("session_id") if isinstance(identity, dict) else None
            receipt = unknown_receipt(data, session=session if isinstance(session, str) else None,
                                      exit_code=process.get("exit_code"),
                                      issue="persisted Claude receipt disagrees with current evidence")
    else:
        with saved.open("x", encoding="utf-8") as stream:
            json.dump(receipt, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    return {"process": process, "receipt": receipt}


def run_claude_attempt(cli_executable, prompt, *, cwd, evidence_root, attempt_id,
                       role, timeout, billing_channel, approved_settings_sha256=None,
                       cancel_event=None, restricted_mcp_config=None, session_id=None):
    """One print-mode input via stdin; no resume, inherited secrets or shell."""
    worker = Path(cwd).resolve(strict=True)
    if billing_channel != "native-allowance":
        raise ValueError("this adapter only admits the owner's native allowance channel")
    _reviewed_project_settings(worker, approved_settings_sha256)
    if not isinstance(cli_executable, (str, os.PathLike)) or not Path(cli_executable).is_absolute():
        raise ValueError("one absolute CLI executable is required")
    cli = Path(cli_executable)
    if not cli.is_file() or os.name == "nt" and cli.suffix.lower() != ".exe":
        raise ValueError("one existing native CLI executable is required")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("one nonempty prompt is required")
    if not isinstance(role, str) or not role or len(role) > 64 or not role.replace("-", "").replace("_", "").isalnum():
        raise ValueError("role must be a bounded name")
    if session_id is not None:
        try:
            if str(uuid.UUID(session_id)) != session_id:
                raise ValueError
        except (TypeError, AttributeError, ValueError):
            raise ValueError("session_id must be a canonical UUID") from None
    session = session_id or str(uuid.uuid4())
    command = [str(cli), "-p", "--session-id", session, "--output-format", "stream-json",
               "--verbose", "--strict-mcp-config", "--permission-mode", "manual",
               "--permission-prompts", "none"]
    if restricted_mcp_config is not None:
        config = Path(restricted_mcp_config)
        if (not config.is_absolute() or not config.is_file()
                or config.resolve() != config or config.resolve().is_relative_to(worker)):
            raise ValueError("reviewed MCP config must be a regular coordinator file outside the worker")
        command.extend(["--restricted", "--tools", "", "--mcp-config", str(config),
                        "--allowedTools", "mcp__omni_worker__worker_command",
                        "--no-chrome", "--disable-slash-commands", "--max-turns", "12"])
    else:
        command.extend(["--setting-sources", "project"])
    environment = {key: value for key, value in os.environ.items() if key.upper() in _ENV_KEYS}
    _preflight_auth(str(cli), worker, environment)
    run_attempt(command, cwd=worker, evidence_root=evidence_root, attempt_id=attempt_id,
                env=environment, input_bytes=prompt.encode("utf-8"), timeout=timeout,
                cancel_event=cancel_event,
                identity={"provider": "claude-code", "role": role, "session_id": session})
    return recover_claude_attempt(evidence_root, attempt_id)
