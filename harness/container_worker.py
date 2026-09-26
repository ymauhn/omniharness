"""One coordinator-owned, bounded Docker Linux worker for a pinned Git worktree.

The Docker client and evidence stay on the coordinator. This first slice has a
single-process coordinator contract: its per-instance lock is not a cross-host
lease, and no external broker may dispatch concurrent calls to one attempt.
It does not route native model tools or account for tokens.
"""
import hashlib
import json
import os
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from harness.fsutil import write_atomic


IMAGE = re.compile(r"python@sha256:[0-9a-f]{64}\Z")
CID = re.compile(r"[0-9a-f]{64}\Z")
ATTEMPT = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
_SAFE_ENV = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"}
_TERMINAL = {"cancelled", "unknown"}
_MEMORY = 256 * 1024 * 1024
_MAX_OUTPUT = 1024 * 1024


def _stamp():
    return datetime.now(timezone.utc).isoformat()


def _save(path, state):
    write_atomic(path, json.dumps(state, sort_keys=True) + "\n")


def _read(path, attempt_id):
    state = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(state, dict) or state.get("schema_version") != 1 or state.get("attempt_id") != attempt_id:
        raise ValueError("attempt manifest identity/version mismatch")
    return state


def recover_attempt(evidence_root, attempt_id):
    """A restart records uncertainty and never relaunches or guesses a CID."""
    if not isinstance(attempt_id, str) or not ATTEMPT.fullmatch(attempt_id):
        raise ValueError("invalid attempt identifier")
    path = Path(evidence_root) / attempt_id / "state.json"
    if not path.parent.is_dir():
        raise FileNotFoundError(path.parent)
    try:
        state = _read(path, attempt_id)
    except (FileNotFoundError, ValueError, json.JSONDecodeError):
        # Preserve malformed evidence for manual inspection; no CID is trusted.
        return {"schema_version": 1, "attempt_id": attempt_id, "phase": "unknown", "cid": None,
                "issues": ["manifest missing or invalid; container identity cannot be trusted"]}
    if state.get("phase") not in _TERMINAL:
        state["phase"] = "unknown"
        state.setdefault("issues", []).append("coordinator restarted; container may still be running")
    state["recovered_at"] = _stamp()
    _save(path, state)
    return state


class ContainerWorker:
    """One process/instance owns an attempt; cross-process dispatch is unsupported."""

    def __init__(self, worktrees, record, *, evidence_root, docker, image, endpoint,
                 lifetime_seconds=300, runner=None):
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            raise ValueError("a saved worktree record is required")
        path = Path(record["path"])
        if not path.is_absolute() or not path.is_dir() or path.resolve(strict=True) != path:
            raise ValueError("worker must be an existing, unredirected absolute worktree")
        if path.is_symlink() or path.is_junction():
            raise ValueError("redirected worktree path")
        root = Path(evidence_root)
        if not root.is_absolute():
            raise ValueError("evidence root must be absolute")
        root = root.resolve()
        if root == path or root.is_relative_to(path) or path.is_relative_to(root):
            raise ValueError("coordinator evidence must stay outside the worktree")
        executable = Path(docker)
        if not executable.is_absolute() or not executable.is_file():
            raise ValueError("Docker CLI must be an existing absolute executable")
        if os.name == "nt" and executable.suffix.lower() != ".exe":
            raise ValueError("Windows Docker batch/script shims are not executable boundaries")
        if not isinstance(image, str) or not IMAGE.fullmatch(image):
            raise ValueError("use the official Python image pinned as python@sha256:<digest>")
        if not isinstance(endpoint, str) or not (
            re.fullmatch(r"npipe:////\./pipe/[A-Za-z0-9._-]+", endpoint)
            or re.fullmatch(r"unix:///[A-Za-z0-9_./-]+", endpoint) and ".." not in endpoint.split("/")
        ):
            raise ValueError("an explicit local Docker endpoint is required")
        if type(lifetime_seconds) is not int or not 30 <= lifetime_seconds <= 900:
            raise ValueError("worker lifetime must be 30-900 seconds")
        self.worktrees = worktrees
        self.record = dict(record)
        self.worker = path
        self.root = root
        self.docker = executable
        self.image = image
        self.endpoint = endpoint
        self.lifetime_seconds = lifetime_seconds
        self.runner = runner
        self._lock = threading.Lock()
        self.env = {k: v for k, v in os.environ.items() if k.upper() in _SAFE_ENV}

    def _audit(self):
        audit = self.worktrees.audit(self.record)
        if not audit.get("scope_ok") or audit.get("isolation") != "git-worktree-only":
            raise ValueError("worktree identity or scope audit failed")

    def _path(self, attempt_id):
        if not isinstance(attempt_id, str) or not ATTEMPT.fullmatch(attempt_id):
            raise ValueError("invalid attempt identifier")
        return self.root / attempt_id

    def _call(self, config, *args, timeout=20, check=True, binary=False):
        command = [str(self.docker), "--config", str(config), "--host", self.endpoint, *args]
        if binary and self.runner is None:
            result = self._bounded_exec(command, timeout)
        else:
            result = (self.runner or subprocess.run)(
                command, env=self.env, stdin=subprocess.DEVNULL, shell=False,
                capture_output=True, text=not binary,
                **({"encoding": "utf-8"} if not binary else {}), timeout=timeout,
                check=False)
        if check and result.returncode:
            raise RuntimeError(f"Docker {args[0]} exited {result.returncode}")
        return result

    def _bounded_exec(self, command, timeout):
        """Bound Docker CLI streams in memory; the timeout caller stops the CID."""
        process = subprocess.Popen(command, env=self.env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False)
        output, errors = bytearray(), bytearray()
        overflow = threading.Event()

        def read(pipe, target):
            while block := pipe.read(65536):
                target.extend(block[:max(0, _MAX_OUTPUT + 1 - len(target))])
                if len(target) > _MAX_OUTPUT:
                    overflow.set()
                    return

        readers = [threading.Thread(target=read, args=(process.stdout, output), daemon=True),
                   threading.Thread(target=read, args=(process.stderr, errors), daemon=True)]
        for reader in readers:
            reader.start()
        deadline = time.monotonic() + timeout
        expired = False
        while process.poll() is None and not overflow.is_set():
            if time.monotonic() >= deadline:
                expired = True
                break
            time.sleep(0.01)
        if expired or overflow.is_set():
            try:
                process.kill()
            except ProcessLookupError:
                pass
        process.wait(timeout=5)
        for reader in readers:
            reader.join(timeout=5)
        process.stdout.close()
        process.stderr.close()
        if any(reader.is_alive() for reader in readers):
            raise RuntimeError("Docker output capture did not terminate")
        if expired:
            raise subprocess.TimeoutExpired(command, timeout, output=bytes(output), stderr=bytes(errors))
        if overflow.is_set():
            raise ValueError("Docker exec output exceeded 1 MiB per stream")
        return subprocess.CompletedProcess(command, process.returncode, bytes(output), bytes(errors))

    def _source_matches(self, source):
        if not isinstance(source, str):
            return False
        path = self.worker.as_posix()
        variants = {path}
        if os.name == "nt":
            drive, tail = path[0].lower(), path[2:]
            variants |= {prefix + drive + tail for prefix in ("/mnt/", "/host_mnt/", "/run/desktop/mnt/host/")}
            return source.replace("\\", "/").lower() in {v.lower() for v in variants}
        return source == path

    def _verify(self, info, state, *, running):
        self._verify_identity(info, state)
        try:
            host, config = info["HostConfig"], info["Config"]
            mounts = info["Mounts"]
            networks = info["NetworkSettings"]["Networks"]
            tmpfs = set(host["Tmpfs"]["/tmp"].split(","))
            mount = mounts[0]
            good = (
                isinstance(networks, dict) and not (set(networks) - {"none"})
                and config["User"] == "65534:65534"
                and config["WorkingDir"] == "/workspace" and config["Entrypoint"] == ["python"]
                and config["Cmd"] == ["-I", "-c", f"import time;time.sleep({self.lifetime_seconds})"]
                and host["NetworkMode"] == "none" and host["ReadonlyRootfs"] is True
                and host["Privileged"] is False and set(host["CapDrop"]) == {"ALL"}
                and not host.get("CapAdd") and set(host["SecurityOpt"]) == {"no-new-privileges=true"}
                and host["PidsLimit"] == 64 and host["Memory"] == _MEMORY
                and host["NanoCpus"] == 1_000_000_000
                and {"rw", "nosuid", "nodev"} <= tmpfs
                and ({"size=16m", "size=16777216"} & tmpfs)
                and len(mounts) == 1 and mount["Type"] == "bind"
                and mount["Destination"] == "/workspace" and mount["RW"] is True
                and self._source_matches(mount["Source"])
                and host.get("PidMode") == "" and host.get("IpcMode") == "private"
                and not host.get("Devices") and not host.get("DeviceRequests")
                and not host.get("VolumesFrom") and not host.get("PublishAllPorts")
                and not host.get("PortBindings")
                and host.get("RestartPolicy", {}).get("Name", "no") == "no"
                and not host.get("AutoRemove")
                and info["State"]["Running"] is running
            )
        except (KeyError, TypeError, IndexError, AttributeError):
            good = False
        if not good:
            raise ValueError("actual Docker identity/profile differs from the contained worker contract")

    def _verify_identity(self, info, state):
        try:
            labels = info["Config"]["Labels"]
            good = (info["Id"] == state["cid"] and info["Name"] == "/" + state["name"]
                    and labels["org.omniharness.attempt"] == state["attempt_id"]
                    and labels["org.omniharness.nonce"] == state["nonce"]
                    and info["Config"]["Image"] == self.image)
        except (KeyError, TypeError, AttributeError):
            good = False
        if not good:
            raise ValueError("actual Docker identity differs from this attempt")

    def _inspect(self, config, state, *, running):
        result = json.loads(self._call(config, "inspect", state["cid"]).stdout)
        if not isinstance(result, list) or len(result) != 1:
            raise ValueError("Docker inspect returned no unique container")
        self._verify(result[0], state, running=running)

    def _load(self, attempt_id):
        directory = self._path(attempt_id)
        state = _read(directory / "state.json", attempt_id)
        if state.get("worker") != str(self.worker) or state.get("image") != self.image or state.get("endpoint") != self.endpoint:
            raise ValueError("attempt manifest differs from this worker binding")
        cid = state.get("cid")
        if cid is not None and (not isinstance(cid, str) or not CID.fullmatch(cid)):
            raise ValueError("untrusted container identity")
        return state, directory / "empty-docker-config", directory / "state.json"

    def start(self, attempt_id):
        """Create an exclusive attempt, persist the CID, inspect, then start."""
        self._audit()
        directory = self._path(attempt_id)
        self.root.mkdir(parents=True, exist_ok=True)
        directory.mkdir()  # never replay an uncertain attempt
        config = directory / "empty-docker-config"
        config.mkdir()
        cidfile = directory / "cid"
        nonce = uuid.uuid4().hex
        state = {"schema_version": 1, "attempt_id": attempt_id, "worker": str(self.worker),
                 "image": self.image, "endpoint": self.endpoint, "name": "omni-worker-" + nonce,
                 "nonce": nonce, "cid": None, "phase": "reserved", "created_at": _stamp(),
                 "deadline_unix": time.time() + self.lifetime_seconds, "commands": [], "issues": []}
        state_path = directory / "state.json"
        _save(state_path, state)
        create_attempted = False
        try:
            server = json.loads(self._call(config, "version", "--format", "{{json .Server}}").stdout)
            if server.get("Os") != "linux":
                raise ValueError("Docker Linux engine required")
            image_info = json.loads(self._call(config, "image", "inspect", self.image).stdout)
            digest = self.image.split("@", 1)[1]
            if not isinstance(image_info, list) or len(image_info) != 1 or not any(
                ref.endswith("@" + digest) and ref.split("@", 1)[0] in ("python", "docker.io/library/python")
                for ref in image_info[0].get("RepoDigests", [])
            ):
                raise ValueError("local official Python digest was not verified")
            cmd = ["create", "--pull", "never", "--cidfile", str(cidfile), "--name", state["name"],
                   "--label", "org.omniharness.attempt=" + attempt_id,
                   "--label", "org.omniharness.nonce=" + nonce,
                   "--network", "none", "--read-only", "--cap-drop", "ALL",
                   "--security-opt", "no-new-privileges=true", "--user", "65534:65534",
                   "--pids-limit", "64", "--memory", "256m", "--cpus", "1",
                   "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m", "--workdir", "/workspace",
                   "--mount", "type=bind,source=" + str(self.worker) + ",target=/workspace",
                   "--entrypoint", "python", self.image, "-I", "-c",
                   f"import time;time.sleep({self.lifetime_seconds})"]
            create_attempted = True
            # A cold Docker Desktop create can exceed the probe's warm path.
            # This is one bounded attempt, never an implicit retry.
            returned = self._call(config, *cmd, timeout=60).stdout.strip()
            from_file = cidfile.read_text(encoding="ascii").strip()
            if returned != from_file or not CID.fullmatch(from_file):
                raise ValueError("Docker create did not provide one matching exact CID")
            state.update(cid=from_file, phase="created")
            _save(state_path, state)  # exact identity must be durable before start
            self._inspect(config, state, running=False)
            self._call(config, "start", from_file, timeout=20)
            self._inspect(config, state, running=True)
            state["phase"] = "running"
            _save(state_path, state)
            return state
        except Exception as error:
            if state["cid"] is None and cidfile.is_file():
                from_file = cidfile.read_text(encoding="ascii", errors="replace").strip()
                if CID.fullmatch(from_file):
                    state["cid"] = from_file
            state["phase"] = "unknown"
            state["issues"].append(f"launch not certified: {type(error).__name__}")
            if create_attempted:
                state["issues"].append("a created container may remain; manual exact-ID triage is required")
            _save(state_path, state)
            raise

    def execute(self, attempt_id, argv, *, timeout=30):
        """Run one bounded container argv; a zero exit never means task success."""
        if not isinstance(argv, (list, tuple)) or not argv or len(argv) > 64 or any(
            not isinstance(arg, str) or not arg or "\0" in arg for arg in argv
        ) or sum(len(arg) for arg in argv) > 32768:
            raise ValueError("bounded nonempty argv required")
        if type(timeout) not in (int, float) or not 0 < timeout <= 120:
            raise ValueError("command timeout must be positive and at most 120 seconds")
        self._audit()
        preflight_error = None
        with self._lock:
            state, config, state_path = self._load(attempt_id)
            if state["phase"] != "running" or time.time() + timeout >= state["deadline_unix"]:
                raise ValueError("worker is not running with enough lifetime remaining")
            try:
                self._inspect(config, state, running=True)
            except Exception as error:
                state["phase"] = "unknown"
                state["issues"].append(f"pre-exec profile unverified: {type(error).__name__}")
                _save(state_path, state)
                preflight_error = error
            if preflight_error is None:
                number = len(state["commands"]) + 1
                if number > 64:
                    raise ValueError("worker command limit reached")
                entry = {"number": number, "argv_sha256": hashlib.sha256(json.dumps(argv).encode()).hexdigest(),
                         "state": "pending", "started_at": _stamp(), "exit_code": None}
                state["commands"].append(entry)
                state["phase"] = "exec_pending"
                _save(state_path, state)
        if preflight_error is not None:
            try:
                self.cancel(attempt_id)
            except (OSError, RuntimeError, ValueError, subprocess.SubprocessError):
                pass  # identity mismatch cannot authorize an exact-ID stop
            raise preflight_error
        try:
            result = self._call(config, "exec", "--user", "65534:65534", "--workdir", "/workspace",
                                state["cid"], *argv, timeout=timeout, check=False, binary=True)
            if not isinstance(result.stdout, bytes) or not isinstance(result.stderr, bytes):
                raise ValueError("Docker exec did not return byte streams")
            if len(result.stdout) > _MAX_OUTPUT or len(result.stderr) > _MAX_OUTPUT:
                raise ValueError("Docker exec output exceeded 1 MiB per stream")
            for label, data in (("stdout", result.stdout), ("stderr", result.stderr)):
                (state_path.parent / f"command-{number:04d}.{label}.bin").write_bytes(data)
                entry[label + "_bytes"] = len(data)
                entry[label + "_sha256"] = hashlib.sha256(data).hexdigest()
            self._inspect(config, state, running=True)
            self._audit()  # a command may have changed files outside its declared Git scope
            entry.update(state="completed", exit_code=result.returncode, finished_at=_stamp())
            with self._lock:
                current, _, _ = self._load(attempt_id)
                if current["phase"] != "exec_pending" or current["commands"][-1]["number"] != number:
                    raise RuntimeError("worker state changed during command")
                current["commands"][-1] = entry
                current["phase"] = "running"
                _save(state_path, current)
            return {"exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr,
                    "task_pass": None, "number": number}
        except Exception as error:
            with self._lock:
                current, _, _ = self._load(attempt_id)
                current["phase"] = "unknown"
                current["issues"].append(f"command outcome unknown: {type(error).__name__}")
                _save(state_path, current)
            try:
                self.cancel(attempt_id)
            except (OSError, RuntimeError, ValueError, subprocess.SubprocessError):
                pass  # uncertain execution stays unknown; never retry automatically
            raise

    def cancel(self, attempt_id):
        """Stop and remove only a verified exact CID created by this attempt."""
        with self._lock:
            state, config, state_path = self._load(attempt_id)
            if state["phase"] == "cancelled":
                return state
            if not state.get("cid"):
                state["phase"] = "unknown"
                state["issues"].append("no exact CID available for cancellation")
                _save(state_path, state)
                return state
            was_unknown = state["phase"] == "unknown"
            try:
                # Exact owned identity is mandatory; profile drift triggers emergency removal.
                info = json.loads(self._call(config, "inspect", state["cid"]).stdout)
                if not isinstance(info, list) or len(info) != 1:
                    raise ValueError("Docker inspect returned no unique container")
                self._verify_identity(info[0], state)
                profile_ok = True
                try:
                    self._verify(info[0], state, running=info[0]["State"]["Running"])
                except (KeyError, TypeError, ValueError):
                    profile_ok = False
                    state["issues"].append("profile drift; exact-identity emergency stop")
                self._call(config, "stop", "--time", "2", state["cid"], timeout=8, check=False)
                removed = self._call(config, "rm", "--force", state["cid"], timeout=8)
                if removed.returncode:
                    raise RuntimeError("exact container removal failed")
                absent = self._call(config, "inspect", state["cid"], timeout=8, check=False)
                error = absent.stderr.lower()
                if (absent.returncode == 0 or state["cid"] not in error
                        or not re.search(r"no such (object|container)", error)):
                    raise RuntimeError("post-removal absence could not be verified")
                state["container_removed"] = True
                state["phase"] = "unknown" if was_unknown or not profile_ok else "cancelled"
                state["finished_at"] = _stamp()
            except Exception as error:
                state["phase"] = "unknown"
                state["issues"].append(f"exact-ID cancellation unconfirmed: {type(error).__name__}")
                _save(state_path, state)
                raise
            _save(state_path, state)
            return state
