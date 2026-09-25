"""Pinned, auditable Git worktrees. This is NOT an operating-system sandbox."""
import argparse
import json
import re
import subprocess
from pathlib import Path

PROTECTED = {".git", ".agents", ".claude", ".codex", ".omniharness", "agents.md", "claude.md"}


def scope_path(value):
    if not isinstance(value, str):
        raise ValueError("scope must be a relative path")
    value = value.replace("\\", "/")
    plain = value[:-3] if value.endswith("/**") else value
    parts = plain.split("/")
    if not plain or any(p in ("", ".", "..") or p.lower() in PROTECTED for p in parts) or any(c in plain for c in "*?:\0"):
        raise ValueError("scope escapes its worktree or includes harness policy")
    return value


class Worktrees:
    def __init__(self, source, workers):
        self.source = Path(source).resolve(strict=True)
        self.workers = Path(workers).resolve()
        if self.workers.is_relative_to(self.source) or self.source.is_relative_to(self.workers):
            raise ValueError("worker storage must be outside the source checkout")
        self.control = self.workers / ".control"
        self.control.mkdir(parents=True, exist_ok=True)
        self.hooks = self.control / "empty-hooks"
        self.hooks.mkdir(exist_ok=True)
        if Path(self.git(self.source, "rev-parse", "--show-toplevel").strip()).resolve() != self.source:
            raise ValueError("source must be a Git checkout root")

    def git(self, path, *args):
        result = subprocess.run(["git", "-c", "core.hooksPath=" + str(self.hooks), "-c", "core.fsmonitor=false", *args],
                                cwd=path, capture_output=True, text=True, encoding="utf-8", check=True)
        return result.stdout

    def key(self, run, task):
        if any(not isinstance(v, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", v) for v in (run, task)):
            raise ValueError("run/task require short lowercase identifiers")
        return self.control / run / (task + ".json")

    def create(self, run, task, base, scopes):
        manifest = self.key(run, task)
        if not isinstance(scopes, list) or not scopes:
            raise ValueError("explicit nonempty scope required")
        scopes = [scope_path(s) for s in scopes]
        if not isinstance(base, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", base):
            raise ValueError("pin the full base commit SHA")
        if self.git(self.source, "rev-parse", "--verify", base + "^{commit}").strip() != base:
            raise ValueError("base must identify a commit")
        if self.git(self.source, "status", "--porcelain", "--untracked-files=all"):
            raise ValueError("source checkout must be clean; preserve owner changes first")
        path = self.workers / run / task
        if path.exists() or path.is_symlink() or manifest.exists():
            raise ValueError("worker path or manifest already exists")
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.resolve() != path or path.parent.is_junction():
            raise ValueError("redirected worker path")
        branch = "codex/swarm-" + run + "-" + task
        self.git(self.source, "worktree", "add", "-b", branch, "--", str(path), base)
        record = {"run": run, "task": task, "path": str(path), "source": str(self.source),
                  "branch": branch, "base": base, "scopes": scopes}
        manifest.parent.mkdir(parents=True, exist_ok=True)
        with manifest.open("x", encoding="utf-8") as output:
            json.dump(record, output, indent=2)
        return record

    def audit(self, record):
        manifest = self.key(record.get("run"), record.get("task"))
        saved = json.loads(manifest.read_text(encoding="utf-8"))
        if saved != record or saved["source"] != str(self.source):
            raise ValueError("worker metadata does not match coordinator manifest")
        path = Path(saved["path"])
        if path.resolve() != path or not path.is_relative_to(self.workers) or path == self.source:
            raise ValueError("worker path redirected")
        if Path(self.git(path, "rev-parse", "--show-toplevel").strip()).resolve() != path:
            raise ValueError("worker is not its own checkout")
        def common(root):
            return Path(self.git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").strip()).resolve()
        if common(path) != common(self.source) or self.git(path, "symbolic-ref", "--short", "HEAD").strip() != saved["branch"]:
            raise ValueError("worker Git identity changed")
        self.git(path, "merge-base", "--is-ancestor", saved["base"], "HEAD")
        # No rename collapsing; both deleted source and new destination must pass.
        changed = set(self.git(path, "diff", "--no-ext-diff", "--no-textconv", "--name-only", "--no-renames", "-z", saved["base"], "--").split("\0"))
        changed.update(self.git(path, "diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-only", "--no-renames", "-z", saved["base"], "--").split("\0"))
        # Deliberately omit --exclude-standard: ignored output is still worker output.
        changed.update(self.git(path, "ls-files", "--others", "-z").split("\0"))
        changed.discard("")
        violations = []
        for name in sorted(changed):
            relative = Path(name)
            redirected = any((path / parent).is_symlink() or (path / parent).is_junction() for parent in [relative, *relative.parents])
            allowed = any(name == scope or (scope.endswith("/**") and name.startswith(scope[:-2])) for scope in saved["scopes"])
            protected = any(part.lower() in PROTECTED for part in relative.parts)
            if protected or redirected or not (path / name).resolve().is_relative_to(path) or not allowed:
                violations.append(name)
        return {"run": saved["run"], "task": saved["task"], "base": saved["base"],
                "head": self.git(path, "rev-parse", "HEAD").strip(), "changed_files": sorted(changed),
                "violations": violations, "scope_ok": not violations,
                "isolation": "git-worktree-only", "os_sandbox_verified": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--workers", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create")
    create.add_argument("run")
    create.add_argument("task")
    create.add_argument("--base", required=True)
    create.add_argument("--scope", action="append", required=True)
    audit = commands.add_parser("audit")
    audit.add_argument("manifest", type=Path)
    args = parser.parse_args()
    try:
        host = Worktrees(args.source, args.workers)
        result = host.create(args.run, args.task, args.base, args.scope) if args.command == "create" else host.audit(json.loads(args.manifest.read_text(encoding="utf-8")))
        print(json.dumps(result))
        return 0 if result.get("scope_ok", True) else 1
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
