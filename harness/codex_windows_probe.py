"""Model-free acceptance probe for one native Windows Codex command sandbox.

Only disposable synthetic files are touched. This proves at most that this
installed CLI can enforce one local command profile; it does not contain a
Codex model, subagents, MCP tools, browser, or Claude Code.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from .native_process import run_attempt


_CHILD_CHECKS = (
    "worker_read", "worker_write", "sibling_read_denied",
    "sibling_write_denied", "home_read_denied", "home_write_denied",
    "coordinator_read_denied", "coordinator_write_denied",
    "codex_home_read_denied", "codex_home_write_denied",
    "codex_sandbox_write_denied", "codex_tmp_write_denied",
)
_ALL_CHECKS = (*_CHILD_CHECKS, "worker_marker_verified", "host_artifacts_unchanged")
_SCOPE = "disposable model-free local command; no live agent or all-role containment"

_WORKER_SCRIPT = r'''param(
  [string]$Nonce, [string]$Worker, [string]$Sibling,
  [string]$HomeDir, [string]$Coordinator, [string]$CodexHome
)
$ErrorActionPreference = 'Stop'
function CanRead([string]$Path) {
  try {
    $file = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try { [void]$file.ReadByte(); return $true }
    finally { $file.Dispose() }
  } catch { return $false }
}
function CanWrite([string]$Path) {
  try { [System.IO.File]::WriteAllText($Path, 'escape probe'); return $true }
  catch { return $false }
}
$checks = [ordered]@{}
$checks.worker_read = CanRead (Join-Path $Worker 'sentinel.txt')
$checks.worker_write = CanWrite (Join-Path $Worker 'own.marker')
$checks.sibling_read_denied = -not (CanRead (Join-Path $Sibling 'sentinel.txt'))
$checks.sibling_write_denied = -not (CanWrite (Join-Path $Sibling 'attempt.marker'))
$checks.home_read_denied = -not (CanRead (Join-Path $HomeDir 'sentinel.txt'))
$checks.home_write_denied = -not (CanWrite (Join-Path $HomeDir 'attempt.marker'))
$checks.coordinator_read_denied = -not (CanRead (Join-Path $Coordinator 'sentinel.txt'))
$checks.coordinator_write_denied = -not (CanWrite (Join-Path $Coordinator 'attempt.marker'))
$checks.codex_home_read_denied = -not (CanRead (Join-Path $CodexHome 'config.toml'))
$checks.codex_home_write_denied = -not (CanWrite (Join-Path $CodexHome 'attempt.marker'))
$checks.codex_sandbox_write_denied = -not (CanWrite (Join-Path $CodexHome '.sandbox\attempt.marker'))
$checks.codex_tmp_write_denied = -not (CanWrite (Join-Path $CodexHome 'tmp\attempt.marker'))
[Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 3 -InputObject @{
  schema_version = 1; nonce = $Nonce; checks = $checks
}))
if ($checks.Values -contains $false) { exit 1 }
'''


def _native_windows():
    return os.name == "nt"


def _executable(path):
    candidate = Path(path)
    if not candidate.is_absolute() or not candidate.is_file() or candidate.suffix.lower() != ".exe":
        raise ValueError("an existing absolute .exe path is required")
    return candidate.resolve(strict=True)


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _reparse(path):
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def _safe_name(name):
    """Keep diagnostics relative to our fixture and bounded, never host paths."""
    clean = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return clean[:64] if len(clean) <= 64 else clean[:56] + "_" + hashlib.sha256(name.encode()).hexdigest()[:7]


def _stderr_diagnostic(data):
    if not data:
        return None
    lower = data.decode("utf-8", errors="replace").lower()
    if ("could not find home directory" in lower or "home directory" in lower
            or "no home dir" in lower):
        kind = "home-unavailable"
    elif ("restricted read-only access requires" in lower
          and "elevated windows sandbox backend" in lower):
        kind = "elevated-backend-required"
    elif "permission profile" in lower or "worker-probe" in lower:
        kind = "profile-rejected"
    elif "access is denied" in lower or "permission denied" in lower:
        kind = "access-denied"
    elif "unknown option" in lower or "unexpected argument" in lower or "unrecognized option" in lower:
        kind = "cli-option-rejected"
    elif "failed to parse" in lower or "invalid toml" in lower:
        kind = "config-invalid"
    elif "cannot find the path" in lower or "not found" in lower:
        kind = "path-unavailable"
    else:
        kind = "other-stderr"
    return {"kind": kind, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _child_report(data, nonce):
    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_json)
    except (UnicodeError, ValueError):
        return None
    if (not isinstance(value, dict) or set(value) != {"schema_version", "nonce", "checks"}
            or type(value["schema_version"]) is not int or value["schema_version"] != 1
            or value["nonce"] != nonce or not isinstance(value["checks"], dict)
            or set(value["checks"]) != set(_CHILD_CHECKS)
            or any(type(v) is not bool for v in value["checks"].values())):
        return None
    return value["checks"]


def _config(paths):
    """TOML JSON-quoted Windows paths; never extend :workspace or grant temp."""
    rules = [":root", ":minimal", "worker", "sibling", "home", "coordinator", "codex_home"]
    access = ["deny", "read", "write", "deny", "deny", "deny", "deny"]
    lines = [
        'default_permissions = "worker-probe"',
        '[windows]', 'sandbox = "unelevated"',
        '[permissions.worker-probe.filesystem]',
    ]
    for name, right in zip(rules, access):
        key = name if name.startswith(":") else str(paths[name])
        lines.append(f'{json.dumps(key)} = "{right}"')
    lines += ['[permissions.worker-probe.network]', 'enabled = false']
    return "\n".join(lines) + "\n"


def _environment(paths):
    allowed = {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC"}
    environment = {key.upper(): value for key, value in os.environ.items()
                   if key.upper() in allowed}
    environment.update(CODEX_HOME=str(paths["codex_home"]),
                       USERPROFILE=str(paths["home"]), HOME=str(paths["home"]),
                       TEMP=str(paths["worker_tmp"]), TMP=str(paths["worker_tmp"]))
    return environment


def _command(cli, powershell, paths, nonce):
    return [str(cli), "sandbox", "-P", "worker-probe", "-C", str(paths["worker"]),
            "--include-managed-config", "--", str(powershell), "-NoProfile",
            "-NonInteractive", "-File", str(paths["script"]), nonce,
            str(paths["worker"]), str(paths["sibling"]), str(paths["home"]),
            str(paths["coordinator"]), str(paths["codex_home"])]


def _host_checks(paths, baseline):
    root = paths["worker"].parent
    changes = set()
    try:
        marker = paths["worker"] / "own.marker"
        worker_ok = (not _reparse(marker) and marker.is_file()
                     and marker.read_text(encoding="utf-8") == "escape probe")
        for path, digest in baseline.items():
            name = path.relative_to(root).as_posix()
            if not path.is_file() or _reparse(path):
                changes.add(f"{name}:missing-or-reparse")
            elif _sha(path) != digest:
                changes.add(f"{name}:content-changed")
        for label, expected in (("sibling", {"sentinel.txt"}),
                                ("home", {"sentinel.txt"}),
                                ("coordinator", {"sentinel.txt"}),
                                ("codex_home", {"config.toml", ".sandbox", "tmp"})):
            directory = paths[label]
            if _reparse(directory) or not directory.is_dir():
                changes.add(f"{directory.name}:missing-or-reparse")
                continue
            actual = {item.name for item in directory.iterdir()}
            for name in actual - expected:
                changes.add(f"{directory.name}/{_safe_name(name)}:added")
            for name in expected - actual:
                changes.add(f"{directory.name}/{name}:missing")
        for name in (".sandbox", "tmp"):
            setup = paths["codex_home"] / name
            if _reparse(setup) or not setup.is_dir():
                changes.add(f"codex-home/{name}:missing-or-reparse")
                continue
            actual = {item.name for item in setup.iterdir()}
            for added in actual - {"sentinel.txt"}:
                changes.add(f"codex-home/{name}/{_safe_name(added)}:added")
            if "sentinel.txt" not in actual:
                changes.add(f"codex-home/{name}/sentinel.txt:missing")
        ordered = sorted(changes)
        if len(ordered) > 32:
            ordered = ordered[:32] + [f"more-changes:{len(changes) - 32}"]
        return worker_ok, not changes, ordered
    except OSError:
        return False, False, ["fixture:audit-error"]


def probe(cli_executable, powershell_executable, *, timeout=20):
    """Return a fail-closed receipt; a sandbox refusal is inconclusive."""
    if not _native_windows():
        raise ValueError("native Windows required")
    cli, powershell = _executable(cli_executable), _executable(powershell_executable)
    if type(timeout) not in (int, float) or not 0 < timeout <= 30:
        raise ValueError("timeout must be positive and at most 30 seconds")
    started = time.monotonic()
    nonce = uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix="omni-codex-windows-") as temporary:
        root = Path(temporary).resolve(strict=True)
        paths = {name: root / name.replace("_", "-") for name in
                 ("worker", "sibling", "home", "coordinator", "codex_home")}
        for path in paths.values():
            path.mkdir()
        paths["worker_tmp"] = paths["worker"] / "tmp"
        paths["worker_tmp"].mkdir()
        paths["script"] = paths["worker"] / "probe.ps1"
        paths["script"].write_text(_WORKER_SCRIPT, encoding="utf-8")
        for name in ("worker", "sibling", "home", "coordinator"):
            (paths[name] / "sentinel.txt").write_text(f"synthetic {name} sentinel {nonce}\n", encoding="utf-8")
        (paths["codex_home"] / "config.toml").write_text(_config(paths), encoding="utf-8")
        for name in (".sandbox", "tmp"):
            setup = paths["codex_home"] / name
            setup.mkdir()
            (setup / "sentinel.txt").write_text(f"synthetic {name} sentinel {nonce}\n", encoding="utf-8")
        baseline = {path: _sha(path) for path in
                    [paths["script"], *(paths[name] / "sentinel.txt" for name in
                      ("worker", "sibling", "home", "coordinator")),
                      paths["codex_home"] / "config.toml",
                      *(paths["codex_home"] / name / "sentinel.txt" for name in (".sandbox", "tmp"))]}
        evidence = root / "evidence"
        process = run_attempt(_command(cli, powershell, paths, nonce), cwd=paths["worker"],
                              evidence_root=evidence, attempt_id="canary",
                              env=_environment(paths), timeout=timeout,
                              identity={"provider": "codex", "role": "sandbox_probe"})
        capture = evidence / "canary"
        stdout = (capture / "stdout.bin").read_bytes()
        stderr = (capture / "stderr.bin").read_bytes()
        child = _child_report(stdout, nonce)
        worker_ok, artifacts_ok, synthetic_changes = _host_checks(paths, baseline)
        checks = {key: child[key] if child is not None else None for key in _CHILD_CHECKS}
        checks.update(worker_marker_verified=worker_ok, host_artifacts_unchanged=artifacts_ok)
        evidence_ok = (process.get("stdout_bytes") == len(stdout)
                       and process.get("stdout_sha256") == hashlib.sha256(stdout).hexdigest()
                       and process.get("stderr_bytes") == len(stderr)
                       and process.get("stderr_sha256") == hashlib.sha256(stderr).hexdigest())
        normal = (process.get("state") == "finished" and process.get("exit_code") == 0
                  and process.get("process_ok") is True and process.get("termination") is None
                  and not process.get("issues"))
        passed = bool(normal and evidence_ok and not stderr and all(v is True for v in checks.values()))
        child_violation = child is not None and any(v is False for v in child.values())
        escape_marker = any(change in (
            "sibling/attempt.marker:added", "home/attempt.marker:added",
            "coordinator/attempt.marker:added", "codex-home/attempt.marker:added",
            "codex-home/.sandbox/attempt.marker:added",
            "codex-home/tmp/attempt.marker:added",
        ) for change in synthetic_changes)
        violation = child_violation or escape_marker or (child is not None and not artifacts_ok)
        status = "passed" if passed else "failed" if violation else "inconclusive"
        if not synthetic_changes:
            change_class = "none"
        elif escape_marker:
            change_class = "forbidden-attempt-marker"
        elif child is None:
            change_class = "launcher-or-unattributed"
        else:
            change_class = "after-child-report"
        issues = []
        if not normal:
            issues.append("sandbox command did not finish successfully")
        if not evidence_ok:
            issues.append("captured stream differs from process evidence")
        if stderr:
            issues.append("sandbox command wrote to stderr")
        if child is None:
            issues.append("exact child report was not observed")
        if not worker_ok:
            issues.append("worker marker was not verified")
        if not artifacts_ok:
            issues.append("host artifacts changed or could not be verified")
        if child_violation:
            issues.append("a child filesystem boundary check failed")
        return {"schema_version": 1, "backend": "codex-windows-unelevated",
                "status": status, "passed": passed, "checks": checks,
                "process_state": process.get("state"), "exit_code": process.get("exit_code"),
                "stderr_diagnostic": _stderr_diagnostic(stderr),
                "synthetic_changes": synthetic_changes, "host_change_class": change_class,
                "issues": issues, "scope": _SCOPE,
                "wall_seconds": round(time.monotonic() - started, 3)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex", required=True, help="absolute path to codex.exe")
    parser.add_argument("--powershell", required=True, help="absolute path to powershell.exe")
    parser.add_argument("--timeout", type=float, default=20)
    args = parser.parse_args(argv)
    try:
        report = probe(args.codex, args.powershell, timeout=args.timeout)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        report = {"schema_version": 1, "backend": "codex-windows-unelevated",
                  "status": "inconclusive", "passed": False,
                  "checks": {key: None for key in _ALL_CHECKS},
                  "process_state": None, "exit_code": None,
                  "stderr_diagnostic": None, "synthetic_changes": [],
                  "host_change_class": "unavailable",
                  "issues": [f"probe could not complete: {type(error).__name__}"],
                  "scope": _SCOPE, "wall_seconds": None}
    print(json.dumps(report, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
