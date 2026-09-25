"""Live, model-free Docker containment acceptance in disposable Git worktrees.

Requires a locally installed official Python image pinned by digest. Never pulls,
reads Docker credentials, or alters existing containers. Failure is not a skip.
"""
import argparse
from contextlib import contextmanager
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from .swarm_worktrees import Worktrees

_CHILD_CHECKS = {"workspace_write", "root_write_denied", "outside_paths_inaccessible",
                 "docker_socket_absent", "no_capabilities", "no_new_privileges",
                 "non_root", "seccomp_active", "network_denied"}


def _unique_json(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate worker check")
        value[key] = item
    return value

WORKER = r'''
import errno,json,os,pathlib,sys
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
def can_read(path):
    try:
        with open(path,'rb') as stream:
            stream.read(1)
        return True
    except OSError:
        return False
def can_write(path):
    try:
        with open(path,'xb') as stream:
            stream.write(b'escape probe')
        return True
    except OSError:
        return False
checks['outside_paths_inaccessible']=(all(not can_read(path) for path in outside['read'])
                                      and all(not can_write(path) for path in outside['write']))
checks['docker_socket_absent']=not pathlib.Path('/var/run/docker.sock').exists()
status=pathlib.Path('/proc/self/status').read_text().splitlines()
checks['no_capabilities']=next(s.split()[1] for s in status if s.startswith('CapEff:'))=='0000000000000000'
checks['no_new_privileges']=next(s.split()[1] for s in status if s.startswith('NoNewPrivs:'))=='1'
checks['non_root']=os.getuid()!=0
checks['seccomp_active']=next(s.split()[1] for s in status if s.startswith('Seccomp:'))=='2'
interfaces={item.name for item in pathlib.Path('/sys/class/net').iterdir()}
routes=pathlib.Path('/proc/net/route').read_text().splitlines()[1:]
default_route=any(len(fields)>=2 and fields[1]=='00000000'
                  for fields in (line.split() for line in routes))
checks['network_denied']=interfaces=={'lo'} and not default_route
print(json.dumps(checks))
sys.exit(0 if all(checks.values()) else 1)
'''


def host_paths(path):
    value = path.as_posix()
    if os.name != "nt":
        return [value]
    drive, tail = value[0].lower(), value[2:]
    return [value, *[prefix + drive + tail for prefix in ("/mnt/", "/host_mnt/", "/run/desktop/mnt/host/")]]


@contextmanager
def _fixture(state):
    root = Path(tempfile.mkdtemp(prefix="omni-containment-")).resolve(strict=True)
    temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
    if not root.is_relative_to(temp_root) or not root.name.startswith("omni-containment-"):
        raise ValueError("disposable fixture path is outside the selected temp directory")
    try:
        yield root
    finally:
        if not state["preserve"]:
            if root.resolve(strict=True) != root or not root.is_relative_to(temp_root):
                raise ValueError("refusing to clean a redirected fixture")
            def retry_readonly(function, path, error):
                target = Path(path)
                if (not isinstance(error, PermissionError) or target.is_symlink()
                        or not target.resolve(strict=True).is_relative_to(root)):
                    raise error
                os.chmod(target, stat.S_IWRITE)
                function(path)
            shutil.rmtree(root, onexc=retry_readonly)


def probe(image, docker, endpoint):
    if not re.fullmatch(r"python@sha256:[0-9a-f]{64}", image):
        raise ValueError("use the local official Python image pinned as python@sha256:<digest>")
    if endpoint and not (endpoint.startswith("npipe://") or endpoint.startswith("unix://")):
        raise ValueError("only a local Docker engine is accepted")
    started = time.monotonic()
    fixture = {"preserve": False}
    with _fixture(fixture) as root:
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
        read_paths = [private / "home.txt", private / "ledger.txt", Path(b["path"]) / "src/base.txt",
                      source / "src/base.txt", source / ".git/HEAD"]
        write_paths = [private / "attempt.marker", Path(b["path"]) / "src/attempt.marker",
                       source / "src/attempt.marker", source / ".git/attempt.marker"]
        paths = {"read": [p for item in read_paths for p in host_paths(item)],
                 "write": [p for item in write_paths for p in host_paths(item)]}
        nonce = uuid.uuid4().hex
        name = "omni-probe-" + nonce
        cidfile = root / "cid"
        (root / "create-intent.json").write_text(json.dumps({"name": name, "nonce": nonce}), encoding="utf-8")
        cid = None
        owned = False
        try:
            cid = call("create", "--pull", "never", "--cidfile", str(cidfile), "--name", name,
                   "--label", "omniharness.fixture=containment", "--label", "omniharness.nonce=" + nonce,
                   "--network", "none", "--read-only",
                   "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--user", "65534:65534",
                   "--pids-limit", "64", "--memory", "256m", "--cpus", "1",
                   "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m", "--workdir", "/workspace",
                   "--mount", "type=bind,source=" + str(work) + ",target=/workspace",
                   "--entrypoint", "python", image, "-I", "-c", WORKER, json.dumps(paths)).strip()
            if not re.fullmatch(r"[0-9a-f]{64}", cid):
                raise ValueError("Docker did not return a container identity")
            info = json.loads(call("inspect", cid))[0]
            owned = (info["Id"] == cid and info["Name"] == "/" + name and
                     info["Config"]["Labels"].get("omniharness.nonce") == nonce)
            profile = info["HostConfig"]
            if not (owned and profile["NetworkMode"] == "none" and profile["ReadonlyRootfs"] and
                    len(info["Mounts"]) == 1 and info["Mounts"][0]["Destination"] == "/workspace" and
                    info["Mounts"][0]["Type"] == "bind" and info["Mounts"][0]["RW"]):
                raise ValueError("actual container profile differs from requested containment")
            checks = json.loads(call("start", "--attach", cid, timeout=45),
                                object_pairs_hook=_unique_json)
            state = json.loads(call("inspect", cid))[0]["State"]
            if (state["Running"] or state["ExitCode"] != 0 or not isinstance(checks, dict)
                    or set(checks) != _CHILD_CHECKS or not all(type(v) is bool and v for v in checks.values())):
                raise ValueError("worker acceptance failed")
            checks["host_artifact_verified"] = (work / "src/output.txt").read_text() == "contained worker\n"
            checks["source_and_sibling_unchanged"] = not git("status", "--porcelain") and not (Path(b["path"]) / "src/output.txt").exists()
            checks["private_sentinels_unchanged"] = ((private / "home.txt").read_text() == "synthetic home sentinel"
                                                      and (private / "ledger.txt").read_text() == "synthetic coordinator sentinel")
            checks["outside_markers_absent"] = all(not item.exists() for item in write_paths)
            audit = host.audit(a)
            checks["actual_scope_audited"] = audit["scope_ok"] and audit["changed_files"] == ["src/output.txt"]
            if not all(checks.values()):
                raise ValueError("host-side acceptance failed")
            return {"schema_version": 1, "backend": "docker-linux", "engine_version": server["Version"],
                    "image": image, "checks": checks, "passed": True,
                    "scope": "disposable offline worker; not a connected model executor or E1 control adapter",
                    "wall_seconds": round(time.monotonic()-started, 3)}
        finally:
            # A cold create can time out after Docker created the container.
            # Preserve the cidfile and name/nonce intent if its identity is uncertain.
            if owned:
                try:
                    call("rm", "--force", cid)
                except (OSError, RuntimeError, subprocess.SubprocessError):
                    fixture["preserve"] = True
                    raise
            else:
                fixture["preserve"] = True


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
