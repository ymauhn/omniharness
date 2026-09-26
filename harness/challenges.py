#!/usr/bin/env python
"""Practice challenges (V1 pillar 4): run a submission against a challenge's hidden tests and keep member progress.

  verify <challenge> <submission>            structured verdict as JSON; exit 0 PASS, 1 FAIL
  progress show [--member M]                 what a member completed, from the progress file
  progress record <challenge> <submission>   verify, then append the verdict; exit 0 PASS, 1 FAIL, 3 conflict

verify copies the submission as mod.py beside challenges/<id>/hidden/ in a fresh temp directory and runs the suite
in a child Python with a timeout. PASS needs a clean exit and a result file with at least one test run and no
failure, error, skip or expected failure; a timeout, crash or accidental early exit is FAIL.

Progress is one JSON file per member at $OMNIFORGE_DATA_DIR/progress/<member>.json (default
%LOCALAPPDATA%/OmniForge/data/progress). Writes are atomic and revisioned: a writer whose revision went stale while
it verified gets a conflict and writes nothing, so concurrent writers never silently overwrite each other.

NOT A SANDBOX. The submission runs as the local user, with that user's files and network. Verify only your own
code until V-04 (docs/omniforge/VALIDATION-PENDING.md) establishes a verified isolation boundary. The submission
also runs inside the suite's process, so it can tamper with the verdict (write the result file itself, patch
unittest) and forge a PASS that progress record then stores: a PASS trusts the submission not to tamper.
"""
import argparse
import contextlib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO not in sys.path:  # this file also runs as a standalone script, where REPO is not on sys.path yet
    sys.path.insert(0, REPO)
from harness.fsutil import write_atomic  # noqa: E402

CHALLENGES = os.path.join(REPO, "challenges")
NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
MEMBER = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")  # lowercase: Windows file names are case-insensitive
# The child gets only what Python needs to start; no tokens or keys from the caller's environment.
ENV_KEYS = ("PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR")
DRIVER = """import json, sys, unittest
r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover('.', pattern='test_*.py'))
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'ran': r.testsRun, 'bad': len(r.failures) + len(r.errors) + len(r.skipped)
               + len(r.expectedFailures) + len(r.unexpectedSuccesses)}, f)
"""


class Conflict(Exception):
    """The progress file changed under this writer; nothing was written."""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def challenge(cid):
    if not NAME.fullmatch(cid) or not os.path.isfile(os.path.join(CHALLENGES, cid, "challenge.json")):
        raise ValueError(f"unknown challenge: {cid!r}")
    with open(os.path.join(CHALLENGES, cid, "challenge.json"), encoding="utf-8") as f:
        return json.load(f)


def verify(cid, submission, timeout=None):
    meta = challenge(cid)
    timeout = timeout or meta["timeoutSeconds"]
    hidden = os.path.join(CHALLENGES, cid, "hidden")
    with open(submission, "rb") as f:
        code = f.read()
    verifier = hashlib.sha256(DRIVER.encode())
    with tempfile.TemporaryDirectory(prefix="omniforge-challenge-", ignore_cleanup_errors=True) as tmp:
        work, result = os.path.join(tmp, "work"), os.path.join(tmp, "result.json")
        os.mkdir(work)
        for name in sorted(os.listdir(hidden)):
            if name.endswith(".py"):
                shutil.copyfile(os.path.join(hidden, name), os.path.join(work, name))
                with open(os.path.join(hidden, name), "rb") as f:
                    verifier.update(name.encode() + b"\0" + f.read())
        with open(os.path.join(work, "mod.py"), "wb") as f:
            f.write(code)
        started, ran = time.monotonic(), None
        # Output goes to a file, not a pipe: a pipe inherited by a grandchild would hang the post-timeout read.
        with open(os.path.join(tmp, "output.txt"), "w+b") as out:
            try:
                # ponytail: a timeout kills this child only; its own descendants survive until V-04 gives a Job Object.
                proc = subprocess.run([sys.executable, "-B", "-E", "-s", "-X", "utf8", "-c", DRIVER, result], cwd=work,
                                      env={k: os.environ[k] for k in ENV_KEYS if k in os.environ},
                                      stdout=out, stderr=subprocess.STDOUT, timeout=timeout)
            except subprocess.TimeoutExpired:
                proc = None
            out.seek(0)
            output = out.read()[-4000:].decode("utf-8", "replace").replace("\r\n", "\n")
        if proc is None:
            reason = f"timeout after {timeout}s"
        else:
            try:
                with open(result, encoding="utf-8") as f:
                    res = json.load(f)
                ran = res["ran"]
            except (OSError, ValueError, KeyError):
                res = None
            if res is None:
                reason = f"no test result: the run ended early (exit code {proc.returncode})"
            elif proc.returncode:
                reason = f"exit code {proc.returncode}"
            elif not ran:
                reason = "no test ran"
            elif res["bad"]:
                reason = f"{res['bad']} failed check(s) in {ran} tests"
            else:
                reason = None
    return {"challenge": cid, "version": meta["version"], "verdict": "FAIL" if reason else "PASS",
            "reason": reason or f"{ran} tests passed", "testsRun": ran, "submissionSha256": sha256(code),
            "verifierSha256": verifier.hexdigest(), "seconds": round(time.monotonic() - started, 2), "output": output}


def progress_path(member):
    if not MEMBER.fullmatch(member):
        raise ValueError(f"invalid member label: {member!r} (lowercase letters, digits, - and _)")
    base = os.environ.get("OMNIFORGE_DATA_DIR") or os.path.join(
        os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.local/share"), "OmniForge", "data")
    return os.path.join(base, "progress", member + ".json")


def load(member):
    path = progress_path(member)
    if not os.path.exists(path):
        return {"schema": 1, "member": member, "revision": 0, "challenges": {}}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)  # a corrupt file raises here and is never overwritten
    if data.get("schema") != 1 or data.get("member") != member or not isinstance(data.get("revision"), int):
        raise ValueError(f"unrecognised progress file, left untouched: {path}")
    return data


@contextlib.contextmanager
def locked(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lock = path + ".lock"
    for _ in range(100):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            time.sleep(0.05)
    else:
        # ponytail: a crash inside the few-millisecond write leaves a stale lock for the owner to remove by hand.
        raise Conflict(f"progress is locked by another writer: {lock} (if none is running, the lock is stale)")
    try:
        yield
    finally:
        os.close(fd)
        os.remove(lock)


def record(cid, submission, member="local-owner", expected_revision=None, timeout=None):
    path = progress_path(member)
    with locked(path):
        start = load(member)["revision"]
    if expected_revision is not None and expected_revision != start:
        raise Conflict(f"expected revision {expected_revision}, found {start}; nothing written")
    verdict = verify(cid, submission, timeout)
    with locked(path):
        data = load(member)
        if data["revision"] != start:
            raise Conflict(f"progress moved from revision {start} to {data['revision']} while verifying; nothing written")
        # ponytail: attempts grow without a cap; trim old FAILs if a file ever gets large.
        data["challenges"].setdefault(cid, []).append({
            "version": verdict["version"], "verdict": verdict["verdict"], "reason": verdict["reason"],
            "recordedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "submissionSha256": verdict["submissionSha256"], "verifierSha256": verdict["verifierSha256"]})
        data["revision"] += 1
        # Windows refuses the replace while a reader holds the file open; retry rather than fail the write.
        write_atomic(path, json.dumps(data, indent=2), max_replace_attempts=40, retry_delay=0.05)
    return verdict, data


def show(member):
    data = load(member)
    print(f"{member}: revision {data['revision']} ({progress_path(member)})")
    for cid, attempts in sorted(data["challenges"].items()):
        passed = next((a for a in attempts if a["verdict"] == "PASS"), None)
        state = (f"completed v{passed['version']} at {passed['recordedAt']}" if passed
                 else f"not completed (last {attempts[-1]['verdict']} at {attempts[-1]['recordedAt']})")
        print(f"{cid}: {state}; {len(attempts)} attempt(s)")


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify")
    v.add_argument("challenge")
    v.add_argument("submission")
    v.add_argument("--timeout", type=float)
    p = sub.add_parser("progress")
    psub = p.add_subparsers(dest="action", required=True)
    s = psub.add_parser("show")
    s.add_argument("--member", default="local-owner")
    r = psub.add_parser("record")
    r.add_argument("challenge")
    r.add_argument("submission")
    r.add_argument("--member", default="local-owner")
    r.add_argument("--expected-revision", type=int)
    r.add_argument("--timeout", type=float)
    a = ap.parse_args(argv)
    try:
        if a.cmd == "progress" and a.action == "show":
            show(a.member)
            return 0
        if a.cmd == "verify":
            verdict = verify(a.challenge, a.submission, a.timeout)
        else:
            verdict, _ = record(a.challenge, a.submission, a.member, a.expected_revision, a.timeout)
    except Conflict as e:
        print(f"conflict: {e}", file=sys.stderr)
        return 3
    except (ValueError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps(verdict, indent=2))
    return 0 if verdict["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
