"""Real, model-free acceptance of the coordinator-owned Docker worker adapter.

Requires an existing pinned image and local Linux Docker engine. Creates only
disposable Git fixtures and one labelled container; no model or external code.
"""
import argparse
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
from pathlib import Path

from .container_worker import ContainerWorker
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


def _cleanup_fixture(root):
    """Delete only our verified temp fixture, including read-only Git objects."""
    temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
    if not root.is_relative_to(temp_root) or not root.name.startswith("omni-worker-acceptance-"):
        raise ValueError("refusing to clean an unexpected fixture path")

    def retry_readonly(function, path, error):
        target = Path(path)
        if (not isinstance(error, PermissionError) or target.is_symlink()
                or not target.resolve(strict=True).is_relative_to(root)):
            raise error
        os.chmod(target, stat.S_IWRITE)
        function(path)

    shutil.rmtree(root, onexc=retry_readonly)


def probe(*, docker, image, endpoint):
    started = time.monotonic()
    root = Path(tempfile.mkdtemp(prefix="omni-worker-acceptance-")).resolve(strict=True)
    if not root.is_relative_to(Path(tempfile.gettempdir()).resolve()) or not root.name.startswith("omni-worker-acceptance-"):
        raise ValueError("disposable fixture path is not inside the selected temp directory")
    evidence = root / "coordinator-evidence"
    worker = None
    issues = []
    checks = {}
    removed = False
    cancelled_clean = False
    create_uncertain = False
    had_cid = False
    try:
        source = root / "source"
        source.mkdir()

        def git(*args):
            return subprocess.run(
                ["git", "-c", "core.hooksPath=" + str(root / "no-hooks"), *args],
                cwd=source, capture_output=True, text=True, encoding="utf-8", check=True,
            ).stdout.strip()

        git("init")
        (source / "src").mkdir()
        (source / "src" / "base.txt").write_text("fixture\n", encoding="utf-8")
        git("add", "src")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
            "-c", "commit.gpgsign=false", "commit", "-m", "worker fixture")
        host = Worktrees(source, root / "workers")
        base = git("rev-parse", "HEAD")
        own = host.create("probe", "own", base, ["src/**"])
        sibling = host.create("probe", "sibling", base, ["src/**"])
        private = root / "private"
        private.mkdir()
        (private / "home.txt").write_text("synthetic home sentinel", encoding="utf-8")
        (private / "ledger.txt").write_text("synthetic ledger sentinel", encoding="utf-8")
        work = Path(own["path"])
        (work / "src").chmod(0o777)
        read_paths = [private / "home.txt", private / "ledger.txt",
                      Path(sibling["path"]) / "src" / "base.txt", source / "src" / "base.txt", source / ".git/HEAD"]
        write_paths = [private / "attempt.marker", Path(sibling["path"]) / "src/attempt.marker",
                       source / "src/attempt.marker", source / ".git/attempt.marker"]
        paths = {"read": [candidate for item in read_paths for candidate in host_paths(item)],
                 "write": [candidate for item in write_paths for candidate in host_paths(item)]}
        worker = ContainerWorker(host, own, evidence_root=evidence, docker=docker,
                                 image=image, endpoint=endpoint)
        worker.start("canary")
        result = worker.execute("canary", ["python", "-I", "-c", WORKER, json.dumps(paths)], timeout=30)
        try:
            child = json.loads(result["stdout"].decode("utf-8"), object_pairs_hook=_unique_json)
        except (UnicodeError, ValueError):
            child = None
        if isinstance(child, dict):
            checks.update(child)
        checks["command_exited_zero"] = result["exit_code"] == 0 and not result["stderr"]
        checks["child_report_boolean"] = (isinstance(child, dict) and set(child) == _CHILD_CHECKS
                                          and all(type(value) is bool for value in child.values()))
        checks["worker_artifact_verified"] = (work / "src" / "output.txt").read_text(encoding="utf-8") == "contained worker\n"
        checks["source_and_sibling_unchanged"] = (not git("status", "--porcelain")
                                                  and (Path(sibling["path"]) / "src" / "base.txt").read_text(encoding="utf-8") == "fixture\n"
                                                  and not (Path(sibling["path"]) / "src" / "output.txt").exists())
        checks["private_sentinels_unchanged"] = (
            (private / "home.txt").read_text(encoding="utf-8") == "synthetic home sentinel"
            and (private / "ledger.txt").read_text(encoding="utf-8") == "synthetic ledger sentinel")
        checks["outside_markers_absent"] = all(not path.exists() for path in write_paths)
        audit = host.audit(own)
        checks["actual_scope_audited"] = audit["scope_ok"] and audit["changed_files"] == ["src/output.txt"]
        checks["no_automatic_task_pass"] = result["task_pass"] is None
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        issues.append(f"probe failed: {type(error).__name__}")
    finally:
        state_path = evidence / "canary" / "state.json"
        cidfile = evidence / "canary" / "cid"
        if state_path.is_file():
            try:
                current = json.loads(state_path.read_text(encoding="utf-8"))
                create_uncertain = any("container may remain" in issue for issue in current.get("issues", []))
                had_cid = bool(current.get("cid"))
                if current.get("container_removed") is True:
                    removed = True
                    cancelled_clean = current.get("phase") == "cancelled"
                elif worker is not None and had_cid:
                    stopped = worker.cancel("canary")
                    removed = stopped.get("container_removed") is True
                    cancelled_clean = stopped.get("phase") == "cancelled"
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                issues.append(f"owned container cancellation unconfirmed: {type(error).__name__}")
                create_uncertain = True
        checks["exact_container_removed"] = removed and cancelled_clean
        preserve = (create_uncertain or ((had_cid or cidfile.is_file()) and not removed))
        if not preserve:
            try:
                _cleanup_fixture(root)
            except (OSError, ValueError) as error:
                issues.append(f"disposable fixture cleanup failed: {type(error).__name__}")
                preserve = True
    passed = bool(checks and all(value is True for value in checks.values()) and not issues)
    return {"schema_version": 1, "backend": "docker-container-worker",
            "passed": passed, "checks": checks, "issues": issues,
            "fixture_preserved_for_triage": preserve,
            "scope": "disposable worker adapter; no native model/tool bridge or E1 control adapter",
            "wall_seconds": round(time.monotonic() - started, 3)}


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
