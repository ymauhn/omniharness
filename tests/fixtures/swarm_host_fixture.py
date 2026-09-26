"""Offline SwarmHost fixture: real ledger, Git worktrees and ContainerWorker over FakeDocker.

Never calls a model, a network service or real Docker. As a script it serves the
driver callbacks as JSON lines on stdio for tests/test_swarm_host.js:
first line {"ready": {"base": ...}}, last line {"summary": {...}}.
"""
import faulthandler
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]

from harness import swarm_host  # noqa: E402
from harness.claude_broker import SERVER, TOOL_NAME  # noqa: E402
from harness.claude_native import recover_claude_attempt  # noqa: E402
from harness.container_worker import ContainerWorker  # noqa: E402
from harness.swarm_accounting import Ledger  # noqa: E402
from harness.swarm_worktrees import Worktrees  # noqa: E402
from test_container_worker import ENDPOINT, IMAGE, FakeDocker  # noqa: E402

RUN = "fixture"
SCOPES = {"a": ["src/a/**"], "b": ["src/b/**"]}
ARGV = ["python", "-V"]


def driver_prompt(task):
    """Same tail as swarm.workflow.js: the task JSON is the last prompt line."""
    return "Implement only this task.\n" + json.dumps({"id": task, "prompt": task.upper(), "scope": SCOPES[task]})


class Fixture:
    def __init__(self, root, *, usd=2, tokens=10_000):
        self.root = Path(root)
        self.repo = self.root / "repo"
        (self.repo / "src").mkdir(parents=True)
        (self.repo / "src" / "base.txt").write_text("fixture\n")
        self.git("init", "-q")
        self.git("add", "src")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.worktrees = Worktrees(self.repo, self.root / "workers")
        self.ledger = Ledger(self.root / "control" / "ledger.sqlite")
        self.ledger.create(RUN, estimated_usd=usd, tokens=tokens, approval="fixture-only")
        self.docker = self.root / ("docker.exe" if os.name == "nt" else "docker")
        self.docker.write_text("fake CLI boundary")
        self.dockers = {}   # worktree path -> FakeDocker: one daemon view per container
        self.workers = {}   # worktree path -> latest ContainerWorker
        self.launches = []  # Docker attempt IDs whose fake model turn ran
        self.behavior = {}  # task id -> {"tokens", "subtype", "outside", "crash", "cancel"}
        self.cancel_event = threading.Event()

    def git(self, *args):
        return subprocess.run(["git", "-c", "core.hooksPath=" + str(self.root / "no-hooks"), *args],
                              cwd=self.repo, capture_output=True, text=True, encoding="utf-8",
                              check=True).stdout

    def make_worker(self, record):
        fake = self.dockers.get(record["path"])
        if fake is None:
            fake = self.dockers[record["path"]] = FakeDocker(Path(record["path"]))
            fake.cid = hashlib.sha256(record["path"].encode()).hexdigest()
        worker = ContainerWorker(self.worktrees, record, evidence_root=self.root / "containers",
                                 docker=self.docker, image=IMAGE, endpoint=ENDPOINT, runner=fake)
        self.workers[record["path"]] = worker
        return worker

    def host(self):
        return swarm_host.SwarmHost(self.ledger, RUN, worktrees=self.worktrees,
                                    make_worker=self.make_worker, process_root=self.root / "process",
                                    cli=sys.executable, timeout=60, cancel_event=self.cancel_event)

    def native(self, cli, prompt, *, cwd, evidence_root, attempt_id, role, session_id,
               restricted_mcp_config, cancel_event=None, **_):
        """Fake Claude turn: one real worker command, one in-scope edit, a whole-tree result."""
        task = json.loads(prompt.rsplit("\n", 1)[1])
        behavior = self.behavior.get(task["id"], {})
        self.launches.append(attempt_id)
        worker = self.workers[str(cwd)]
        worker.execute(attempt_id, ARGV)
        target = Path(cwd) / task["scope"][0].replace("/**", "/file.py")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"# {attempt_id}\n")
        if behavior.get("outside"):
            (Path(cwd) / "outside.txt").write_text("out of scope\n")
        server = json.loads(Path(restricted_mcp_config).read_text())["mcpServers"][SERVER]
        binding = json.loads(Path(server["args"][server["args"].index("--binding") + 1]).read_text())
        Path(binding["events_path"]).write_text("".join(json.dumps(event) + "\n" for event in [
            {"event": "server_started", "attempt_id": attempt_id, "session_id": session_id},
            {"event": "tool_completed", "number": 1, "attempt_id": attempt_id, "session_id": session_id,
             "command_number": 1, "argv_sha256": hashlib.sha256(json.dumps(ARGV).encode()).hexdigest(),
             "exit_code": 0}]))
        claimed = {"task": task["id"], "worktree": "C:/forged", "branch": "codex/forged",
                   "base_commit": "f" * 40, "changed_files": ["secrets.txt"], "net_lines": 999,
                   "worker_identity": "forged", "execution_valid": True,
                   "tests": {"command": "python -m unittest", "exit_code": 0, "passed": True, "count": 1}}
        tokens = behavior.get("tokens", 15)
        events = [
            {"type": "system", "subtype": "init", "session_id": session_id, "tools": [TOOL_NAME],
             "mcp_servers": [{"name": SERVER, "status": "connected"}]},
            {"type": "assistant", "session_id": session_id, "message": {"content": [
                {"type": "tool_use", "id": "tool-1", "name": TOOL_NAME, "input": {"argv": ARGV}}]}},
            {"type": "user", "session_id": session_id, "message": {"content": [
                {"type": "tool_result", "tool_use_id": "tool-1", "content": "Python 3.12"}]}}]
        interrupted = behavior.get("crash") or behavior.get("cancel")
        if not interrupted:
            events.append({"type": "result", "subtype": behavior.get("subtype", "success"),
                           "is_error": False, "session_id": session_id, "result": json.dumps(claimed),
                           "total_cost_usd": 0.01, "modelUsage": {"fixture-model": {
                               "inputTokens": tokens - 5, "outputTokens": 5,
                               "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0}}})
        stdout = "".join(json.dumps(event) + "\n" for event in events).encode()
        attempt = Path(evidence_root) / attempt_id
        attempt.mkdir(parents=True)
        (attempt / "stdout.bin").write_bytes(stdout)
        (attempt / "stderr.bin").write_bytes(b"")
        state = {"schema_version": 1, "attempt_id": attempt_id,
                 "identity": {"provider": "claude-code", "role": role, "session_id": session_id},
                 "state": "finished", "termination": None, "exit_code": 0, "process_ok": True,
                 "usage_tokens": None, "stdout_bytes": len(stdout),
                 "stdout_sha256": hashlib.sha256(stdout).hexdigest(),
                 "stderr_bytes": 0, "stderr_sha256": hashlib.sha256(b"").hexdigest(), "issues": []}
        if behavior.get("crash"):  # coordinator died mid-turn: nothing terminal was recorded
            state.update(state="running", exit_code=None, process_ok=False,
                         stdout_bytes=None, stdout_sha256=None)
        elif behavior.get("cancel"):
            assert cancel_event is self.cancel_event, "host must pass its cancel event to the turn"
            cancel_event.set()
            state.update(state="interrupted", termination="cancel", exit_code=1, process_ok=False)
        (attempt / "state.json").write_text(json.dumps(state))
        return recover_claude_attempt(evidence_root, attempt_id)

    def summary(self):
        with self.ledger.db() as db:
            rows = db.execute("""SELECT a.label, a.state, a.session, a.receipt, w.docker_id, w.worker_identity
                                 FROM attempts a LEFT JOIN workers w ON w.lease = a.id
                                 WHERE a.run=? ORDER BY a.label""", (RUN,)).fetchall()
        attempts = []
        for row in rows:
            receipt = json.loads(row["receipt"]) if row["receipt"] else {}
            attempts.append({"label": row["label"], "state": row["state"], "session": row["session"],
                             "docker_id": row["docker_id"], "worker_identity": row["worker_identity"],
                             "source_sha256": receipt.get("source_sha256"),
                             "reservation_exceeded": receipt.get("reservation_exceeded")})
        return {"attempts": attempts, "launches": self.launches,
                "containers": sum(fake.profile is not None for fake in self.dockers.values()),
                "removed": sum(fake.removed for fake in self.dockers.values()),
                "blocked": self.ledger.status(RUN)["blocked"]}


def main(scenario):
    faulthandler.dump_traceback_later(120, exit=True)  # a stalled fixture dumps stacks instead of hanging
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        fixture = Fixture(temp, usd=0.15 if scenario == "small" else 2)
        fixture.behavior = {"crash": {"a": {"crash": True}},
                            "over": {"a": {"tokens": 500}}}.get(scenario, {})
        if scenario == "retry":  # an earlier coordinator already launched this label
            lease = fixture.ledger.reserve(RUN, "implement:a:0", estimated_usd=0.1, tokens=100)
            fixture.ledger.start(lease, session="earlier-session")
        print(json.dumps({"ready": {"base": fixture.base}}), flush=True)
        with patch.object(swarm_host, "MANAGED_ADMISSION", scenario != "closed"), \
                patch("harness.claude_worker_bridge.run_claude_attempt", new=fixture.native):
            swarm_host.serve(fixture.host(), sys.stdin, sys.stdout)
        print(json.dumps({"summary": fixture.summary()}), flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
