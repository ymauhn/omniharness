"""Live, model-free Docker containment acceptance in disposable Git worktrees.

Requires a locally installed official Python image pinned by digest. Never pulls,
reads Docker credentials, or alters existing containers. Failure is not a skip.
"""
import argparse
import json
import os
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from .swarm_worktrees import Worktrees

WORKER = r'''
import errno,json,os,pathlib,socket,sys
checks={}
p=pathlib.Path('/workspace/src/output.txt')
p.write_text('contained worker\n')
checks['workspace_write']=p.read_text()=='contained worker\n'
try:
    pathlib.Path('/escape.txt').write_text('must fail')
    checks['root_write_denied']=False
except OSError as e:
    checks['root_write_denied']=e.errno in (errno.EROFS,errno.EACCES)
outside=json.loads(sys.argv[1])
checks['outside_paths_inaccessible']=all(not pathlib.Path(p).exists() for p in outside)
checks['docker_socket_absent']=not pathlib.Path('/var/run/docker.sock').exists()
status=pathlib.Path('/proc/self/status').read_text().splitlines()
checks['no_capabilities']=next(s.split()[1] for s in status if s.startswith('CapEff:'))=='0000000000000000'
checks['no_new_privileges']=next(s.split()[1] for s in status if s.startswith('NoNewPrivs:'))=='1'
checks['non_root']=os.getuid()!=0
checks['seccomp_active']=next(s.split()[1] for s in status if s.startswith('Seccomp:'))=='2'
with socket.socket() as s:
    s.settimeout(2)
    try:
        s.connect(('198.51.100.1',443))
        checks['network_denied']=False
    except OSError as e:
        checks['network_denied']=e.errno in (errno.ENETUNREACH,errno.EHOSTUNREACH,errno.EPERM,errno.EACCES)
print(json.dumps(checks))
sys.exit(0 if all(checks.values()) else 1)
'''


def host_paths(path):
    value = path.as_posix()
    if os.name != "nt":
        return [value]
    drive, tail = value[0].lower(), value[2:]
    return [value, *[prefix + drive + tail for prefix in ("/mnt/", "/host_mnt/", "/run/desktop/mnt/host/")]]


def probe(image, docker, endpoint):
    if not re.fullmatch(r"python@sha256:[0-9a-f]{64}", image):
        raise ValueError("use the local official Python image pinned as python@sha256:<digest>")
    if endpoint and not (endpoint.startswith("npipe://") or endpoint.startswith("unix://")):
        raise ValueError("only a local Docker engine is accepted")
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="omni-containment-") as tmp:
        root = Path(tmp).resolve()
        config = root / "empty-docker-config"
        config.mkdir()
        command = [docker, "--config", str(config)] + (["--host", endpoint] if endpoint else [])
        # Never inherit a remote context, TLS credential path or connection override.
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith("DOCKER_")}
        def call(*args, timeout=30):
            result = subprocess.run([*command, *args], env=env, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
            if result.returncode:
                raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"Docker exit {result.returncode}")
            return result.stdout
        server = json.loads(call("version", "--format", "{{json .Server}}"))
        if server.get("Os") != "linux":
            raise ValueError("Linux Docker engine required")
        call("image", "inspect", image) # local presence required; create uses --pull never
        source = root / "source"
        source.mkdir()
        def git(*args):
            return subprocess.run(["git", "-c", "core.hooksPath=" + str(root / "no-hooks"), *args], cwd=source,
                                  capture_output=True, text=True, encoding="utf-8", check=True).stdout.strip()
        git("init")
        (source / "src").mkdir()
        (source / "src/base.txt").write_text("fixture\n")
        git("add", "src")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "containment fixture")
        host = Worktrees(source, root / "workers")
        base = git("rev-parse", "HEAD")
        a = host.create("probe", "a", base, ["src/**"])
        b = host.create("probe", "b", base, ["src/**"])
        private = root / "private"
        private.mkdir()
        (private / "home.txt").write_text("synthetic home sentinel")
        (private / "ledger.txt").write_text("synthetic coordinator sentinel")
        work = Path(a["path"])
        (work / "src").chmod(0o777) # only disposable fixture output; container uses nobody
        outside = [private / "home.txt", private / "ledger.txt", Path(b["path"]) / "src/base.txt", source / "src/base.txt", source / ".git"]
        paths = [p for item in outside for p in host_paths(item)]
        cid = call("create", "--pull", "never", "--name", "omni-probe-" + uuid.uuid4().hex,
                   "--label", "omniharness.fixture=containment", "--network", "none", "--read-only",
                   "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--user", "65534:65534",
                   "--pids-limit", "64", "--memory", "256m", "--cpus", "1",
                   "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m", "--workdir", "/workspace",
                   "--mount", "type=bind,source=" + str(work) + ",target=/workspace",
                   "--entrypoint", "python", image, "-I", "-c", WORKER, json.dumps(paths)).strip()
        if not re.fullmatch(r"[0-9a-f]{64}", cid):
            raise ValueError("Docker did not return a container identity")
        try:
            info = json.loads(call("inspect", cid))[0]
            profile = info["HostConfig"]
            if not (profile["NetworkMode"] == "none" and profile["ReadonlyRootfs"] and
                    len(info["Mounts"]) == 1 and info["Mounts"][0]["Destination"] == "/workspace" and
                    info["Mounts"][0]["Type"] == "bind" and info["Mounts"][0]["RW"]):
                raise ValueError("actual container profile differs from requested containment")
            checks = json.loads(call("start", "--attach", cid, timeout=45))
            state = json.loads(call("inspect", cid))[0]["State"]
            if state["Running"] or state["ExitCode"] != 0 or not checks or not all(v is True for v in checks.values()):
                raise ValueError("worker acceptance failed")
            checks["host_artifact_verified"] = (work / "src/output.txt").read_text() == "contained worker\n"
            checks["source_and_sibling_unchanged"] = not git("status", "--porcelain") and not (Path(b["path"]) / "src/output.txt").exists()
            audit = host.audit(a)
            checks["actual_scope_audited"] = audit["scope_ok"] and audit["changed_files"] == ["src/output.txt"]
            if not all(checks.values()):
                raise ValueError("host-side acceptance failed")
            return {"schema_version": 1, "backend": "docker-linux", "engine_version": server["Version"],
                    "image": image, "checks": checks, "passed": True,
                    "scope": "disposable offline worker; not a connected model executor or E1 control adapter",
                    "wall_seconds": round(time.monotonic()-started, 3)}
        finally:
            # Exact ID created above only; never prune or touch an existing user container.
            call("rm", "--force", cid)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--docker", default="docker")
    parser.add_argument("--endpoint")
    args = parser.parse_args()
    try:
        result = probe(args.image, args.docker, args.endpoint)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({"passed": False, "error": str(error)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
