"""Offline Docker contract tests using real disposable Git worktrees."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from harness.container_worker import ContainerWorker, recover_attempt
from harness.swarm_worktrees import Worktrees


IMAGE = "python@sha256:" + "2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9"
CID = "a" * 64
ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine" if os.name == "nt" else "unix:///var/run/docker.sock"


class FakeDocker:
    def __init__(self, worker):
        self.worker = worker
        self.calls = []
        self.profile = None
        self.running = False
        self.removed = False
        self.timeout_exec = False
        self.timeout_create = False
        self.mutate_profile = None
        self.returncode = 0
        self.cid = CID
        self.during_exec = None

    def __call__(self, command, **kwargs):
        self.calls.append((command, kwargs))
        assert kwargs["shell"] is False
        assert kwargs["stdin"] == subprocess.DEVNULL
        assert "DOCKER_HOST" not in kwargs["env"]
        assert "OPENAI_API_KEY" not in kwargs["env"]
        assert command[1] == "--config" and command[3] == "--host"
        args = command[5:]
        action = args[0]
        if action == "version":
            out = json.dumps({"Os": "linux", "Version": "29.6.2"})
        elif action == "image":
            out = json.dumps([{"RepoDigests": ["docker.io/library/" + IMAGE]}])
        elif action == "create":
            assert kwargs["timeout"] == 60
            cidfile = Path(args[args.index("--cidfile") + 1])
            if self.timeout_create:
                cidfile.write_text("", encoding="ascii")
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            self.profile = self._profile(args)
            cidfile.write_text(self.cid + "\n", encoding="ascii")
            out = self.cid + "\n"
        elif action == "inspect":
            assert args[1] == self.cid
            if self.removed:
                return subprocess.CompletedProcess(command, 1, "", "Error: No such object: " + self.cid)
            info = copy.deepcopy(self.profile)
            info["State"] = {"Running": self.running}
            if self.mutate_profile:
                self.mutate_profile(info)
            out = json.dumps([info])
        elif action == "start":
            assert args[1] == self.cid
            evidence = Path(command[2]).parent / "state.json"
            saved = json.loads(evidence.read_text(encoding="utf-8"))
            assert saved["cid"] == self.cid and saved["phase"] == "created"
            self.running = True
            out = self.cid + "\n"
        elif action == "exec":
            assert args[:6] == ["exec", "--user", "65534:65534", "--workdir", "/workspace", self.cid]
            if self.timeout_exec:
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            if self.during_exec:
                self.during_exec()
            return subprocess.CompletedProcess(command, self.returncode, b"worker output\n", b"")
        elif action == "stop":
            assert args == ["stop", "--time", "2", self.cid]
            self.running = False
            out = self.cid + "\n"
        elif action == "rm":
            assert args == ["rm", "--force", self.cid]
            self.removed = True
            out = self.cid + "\n"
        else:
            raise AssertionError(f"unexpected Docker command: {args}")
        return subprocess.CompletedProcess(command, 0, out, "")

    def _profile(self, args):
        def option(name):
            return args[args.index(name) + 1]
        labels = dict(item.split("=", 1) for item in (args[i + 1] for i, item in enumerate(args) if item == "--label"))
        return {"Id": self.cid, "Name": "/" + option("--name"), "State": {"Running": False},
                "NetworkSettings": {"Networks": {"none": {}}},
                "Config": {"Labels": labels, "Image": IMAGE, "User": "65534:65534",
                           "WorkingDir": "/workspace", "Entrypoint": ["python"],
                           "Cmd": args[-3:]},
                "Mounts": [{"Type": "bind", "Source": str(self.worker),
                            "Destination": "/workspace", "RW": True}],
                "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True,
                               "Privileged": False, "CapDrop": ["ALL"], "CapAdd": None,
                               "SecurityOpt": ["no-new-privileges=true"], "PidsLimit": 64,
                               "Memory": 256 * 1024 * 1024, "NanoCpus": 1_000_000_000,
                               "Tmpfs": {"/tmp": "rw,nosuid,nodev,size=16m"},
                               "PidMode": "", "IpcMode": "private", "Devices": [],
                               "DeviceRequests": [], "VolumesFrom": [],
                               "PublishAllPorts": False, "PortBindings": {},
                               "RestartPolicy": {"Name": "no"}, "AutoRemove": False}}


class ContainerWorkerContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init")
        (self.repo / "src").mkdir()
        (self.repo / "src" / "base.txt").write_text("fixture\n")
        self.git("add", "src")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "-m", "fixture")
        base = self.git("rev-parse", "HEAD").strip()
        self.worktrees = Worktrees(self.repo, self.root / "workers")
        self.record = self.worktrees.create("contract", "one", base, ["src/**"])
        self.worker = Path(self.record["path"])
        self.evidence = self.root / "coordinator-evidence"
        self.docker = self.root / ("docker.exe" if os.name == "nt" else "docker")
        self.docker.write_text("fake CLI boundary")
        self.fake = FakeDocker(self.worker)
        self.runtime = self.make_runtime()

    def git(self, *args):
        return subprocess.run(["git", "-c", "core.hooksPath=" + str(self.root / "no-hooks"), *args],
                              cwd=self.repo, capture_output=True, text=True, encoding="utf-8", check=True).stdout

    def make_runtime(self, **overrides):
        args = {"evidence_root": self.evidence, "docker": self.docker, "image": IMAGE,
                "endpoint": ENDPOINT, "runner": self.fake}
        args.update(overrides)
        return ContainerWorker(self.worktrees, self.record, **args)

    def actions(self):
        return [command[5] for command, _ in self.fake.calls]

    def test_persist_before_start_execute_argv_then_cancel_exact_container(self):
        os.environ["DOCKER_HOST"] = "tcp://remote.invalid:2376"
        os.environ["OPENAI_API_KEY"] = "must-not-leak"
        self.addCleanup(os.environ.pop, "DOCKER_HOST", None)
        self.addCleanup(os.environ.pop, "OPENAI_API_KEY", None)
        self.runtime = self.make_runtime()
        state = self.runtime.start("attempt_1")
        self.assertEqual(state["phase"], "running")
        self.assertEqual(state["cid"], CID)
        result = self.runtime.execute("attempt_1", ["python", "-I", "-c", "print('ok')"])
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(result["stdout"], b"worker output\n")
        self.assertIsNone(result["task_pass"])
        self.assertEqual(self.runtime.cancel("attempt_1")["phase"], "cancelled")
        self.assertTrue(self.fake.removed)
        self.assertEqual(self.actions().count("create"), 1)
        self.assertEqual(self.actions().count("start"), 1)
        self.assertEqual(self.actions().count("exec"), 1)
        self.assertEqual(self.actions().count("stop"), 1)
        self.assertEqual(self.actions().count("rm"), 1)
        self.assertEqual(self.actions()[-1], "inspect")
        saved = json.loads((self.evidence / "attempt_1" / "state.json").read_text())
        self.assertEqual(saved["commands"][0]["state"], "completed")
        self.assertEqual(saved["commands"][0]["stdout_bytes"], len(b"worker output\n"))
        self.assertEqual((self.evidence / "attempt_1" / "command-0001.stdout.bin").read_bytes(), b"worker output\n")
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_scope_violation_and_redirected_worker_fail_before_docker(self):
        (self.worker / "outside.txt").write_text("bad")
        with self.assertRaisesRegex(ValueError, "scope"):
            self.runtime.start("bad_scope")
        self.assertFalse(self.fake.calls)
        with self.assertRaisesRegex(ValueError, "outside"):
            self.make_runtime(evidence_root=self.worker / "evidence")
        forged = {**self.record, "path": str(self.repo)}
        with self.assertRaises(ValueError):
            ContainerWorker(self.worktrees, forged, evidence_root=self.evidence, docker=self.docker,
                            image=IMAGE, endpoint=ENDPOINT, runner=self.fake).start("forged")

    def test_forged_container_identity_never_starts_or_removes(self):
        self.fake.mutate_profile = lambda info: info["Config"]["Labels"].update({"org.omniharness.nonce": "forged"})
        with self.assertRaisesRegex(ValueError, "identity"):
            self.runtime.start("forged_id")
        self.assertNotIn("start", self.actions())
        self.assertNotIn("stop", self.actions())
        self.assertNotIn("rm", self.actions())
        self.assertEqual(recover_attempt(self.evidence, "forged_id")["phase"], "unknown")

    def test_extra_mount_blocks_start_and_profile_drift_emergency_removes_exact_id(self):
        self.fake.mutate_profile = lambda info: info["Mounts"].append(
            {"Type": "bind", "Source": str(self.repo), "Destination": "/other", "RW": True})
        with self.assertRaisesRegex(ValueError, "identity/profile"):
            self.runtime.start("extra_mount")
        self.assertNotIn("start", self.actions())
        self.assertNotIn("rm", self.actions())
        self.fake.mutate_profile = None
        self.runtime.start("valid")
        self.fake.mutate_profile = lambda info: info["HostConfig"].update({"NetworkMode": "bridge"})
        self.assertEqual(self.runtime.cancel("valid")["phase"], "unknown")
        self.assertTrue(self.fake.removed)
        self.assertEqual(self.actions().count("stop"), 1)

    def test_live_network_attachment_blocks_exec_and_removes_owned_container(self):
        self.runtime.start("network_drift")
        self.fake.mutate_profile = lambda info: info["NetworkSettings"]["Networks"].update({"bridge": {}})
        with self.assertRaisesRegex(ValueError, "identity/profile"):
            self.runtime.execute("network_drift", ["python", "-V"])
        self.assertNotIn("exec", self.actions())
        self.assertTrue(self.fake.removed)
        state = recover_attempt(self.evidence, "network_drift")
        self.assertEqual(state["phase"], "unknown")
        self.assertTrue(state["container_removed"])
        self.assertIn("profile drift; exact-identity emergency stop", state["issues"])

    def test_joined_pid_or_ipc_namespace_blocks_start(self):
        for mode, value in (("PidMode", "container:other"), ("IpcMode", "container:other")):
            with self.subTest(mode=mode):
                self.fake.mutate_profile = lambda info: info["HostConfig"].update({mode: value})
                with self.assertRaisesRegex(ValueError, "identity/profile"):
                    self.runtime.start("joined_" + mode.lower())
                self.assertNotIn("start", self.actions())
                self.fake.mutate_profile = None

    def test_network_attachment_during_exec_invalidates_command_evidence(self):
        self.runtime.start("network_mid_exec")
        self.fake.during_exec = lambda: setattr(
            self.fake, "mutate_profile",
            lambda info: info["NetworkSettings"]["Networks"].update({"bridge": {}}))
        with self.assertRaisesRegex(ValueError, "identity/profile"):
            self.runtime.execute("network_mid_exec", ["python", "-V"])
        self.assertEqual(self.actions().count("exec"), 1)
        self.assertTrue(self.fake.removed)
        state = recover_attempt(self.evidence, "network_mid_exec")
        self.assertEqual(state["phase"], "unknown")
        self.assertTrue(state["container_removed"])
        self.assertEqual(state["commands"][0]["state"], "pending")

    def test_forged_identity_at_cancel_never_stops_another_container(self):
        self.runtime.start("forged_cancel")
        self.fake.mutate_profile = lambda info: info["Config"]["Labels"].update(
            {"org.omniharness.nonce": "wrong"})
        with self.assertRaisesRegex(ValueError, "identity"):
            self.runtime.cancel("forged_cancel")
        self.assertFalse(self.fake.removed)
        self.assertEqual(self.actions().count("stop"), 0)

    def test_exec_timeout_is_unknown_and_exact_container_is_removed(self):
        self.runtime.start("slow")
        self.fake.timeout_exec = True
        with self.assertRaises(subprocess.TimeoutExpired):
            self.runtime.execute("slow", ["python", "-c", "while True: pass"], timeout=1)
        self.assertTrue(self.fake.removed)
        state = recover_attempt(self.evidence, "slow")
        self.assertEqual(state["phase"], "unknown")
        self.assertTrue(state["container_removed"])
        with self.assertRaisesRegex(ValueError, "running"):
            self.runtime.execute("slow", ["python", "-V"])

    def test_cold_create_timeout_is_unknown_without_replay_or_start(self):
        self.fake.timeout_create = True
        with self.assertRaises(subprocess.TimeoutExpired):
            self.runtime.start("cold")
        state = recover_attempt(self.evidence, "cold")
        self.assertEqual(state["phase"], "unknown")
        self.assertIsNone(state["cid"])
        self.assertEqual(self.actions().count("create"), 1)
        self.assertNotIn("start", self.actions())
        self.assertNotIn("rm", self.actions())
        with self.assertRaises(FileExistsError):
            self.runtime.start("cold")

    def test_recovery_marks_running_attempt_unknown_without_relaunch(self):
        self.runtime.start("crashed")
        before = len(self.fake.calls)
        state = recover_attempt(self.evidence, "crashed")
        self.assertEqual(state["phase"], "unknown")
        self.assertEqual(len(self.fake.calls), before)
        self.assertEqual(self.runtime.cancel("crashed")["phase"], "unknown")
        self.assertTrue(self.fake.removed)
        self.assertEqual(self.actions().count("start"), 1)

    def test_cancel_during_exec_never_restores_running_or_task_pass(self):
        self.runtime.start("race")
        self.fake.during_exec = lambda: self.runtime.cancel("race")
        with self.assertRaises(RuntimeError):
            self.runtime.execute("race", ["python", "-V"])
        saved = json.loads((self.evidence / "race" / "state.json").read_text())
        self.assertEqual(saved["phase"], "unknown")
        self.assertTrue(saved["container_removed"])
        self.assertEqual(self.actions().count("start"), 1)

    def test_out_of_scope_command_artifact_fails_after_exec(self):
        self.runtime.start("scope_escape")
        self.fake.during_exec = lambda: (self.worker / "outside.txt").write_text("outside scope")
        with self.assertRaisesRegex(ValueError, "scope"):
            self.runtime.execute("scope_escape", ["python", "-V"])
        self.assertTrue(self.fake.removed)
        self.assertEqual(recover_attempt(self.evidence, "scope_escape")["phase"], "unknown")

    def test_real_process_capture_caps_output_and_timeout(self):
        command = [sys.executable, "-c", "import sys;sys.stdout.buffer.write(b'x'*2000000)"]
        with self.assertRaisesRegex(ValueError, "1 MiB"):
            self.runtime._bounded_exec(command, timeout=5)
        sleepy = [sys.executable, "-c", "import time;time.sleep(2)"]
        with self.assertRaises(subprocess.TimeoutExpired):
            self.runtime._bounded_exec(sleepy, timeout=0.05)

    def test_nonzero_exec_does_not_approve_task_and_cannot_use_remote_endpoint(self):
        self.runtime.start("failure")
        self.fake.returncode = 7
        result = self.runtime.execute("failure", ["/bin/sh", "-c", "exit 7"])
        self.assertEqual(result["exit_code"], 7)
        self.assertIsNone(result["task_pass"])
        self.assertEqual(self.runtime.cancel("failure")["phase"], "cancelled")
        with self.assertRaisesRegex(ValueError, "local Docker"):
            self.make_runtime(endpoint="tcp://remote.invalid:2376")
        with self.assertRaisesRegex(ValueError, "pinned"):
            self.make_runtime(image="python:latest")


if __name__ == "__main__":
    unittest.main()
