"""Local session policy and CLI. Does not execute commands or replace host sandboxing."""
import argparse
import hashlib
import json
import math
import re
import shlex
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
if __package__:
    from .swarm_accounting import usage_from_stream
else:
    from swarm_accounting import usage_from_stream

MODES = ("balanced", "swarm", "strict")
HARD_STOPS = (
    (r"\bgit\s+(?:push|reset\s+--hard)\b", "push or hard reset is outside every envelope"),
    (r"\brm\b[^\n]*(?:-[a-z]*r|--recursive)|\brmdir\b|\bdel\s+/s|Remove-Item[^\n]*-Recurse|\brmtree\b", "recursive deletion requires owner triage"),
    (r"(?:curl|wget)[^\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b", "download piped into a shell"),
    (r"\bmkfs\b|\bdd\s+if=.*of=/dev/|>\s*/dev/sd|\bDROP\s+(?:TABLE|DATABASE)\b", "destructive disk/database operation"),
    (r"(?:^|[\s/\\'\"])(?:\.env(?:\b|\.)|\.ssh\b)|\.(?:pem|key)\b|cofre[^\s]*\.json|\b(?:AWS_SECRET_ACCESS_KEY|password|api[_-]?key)\b", "credentials are outside every envelope"),
    (r"\b(?:stripe|paypal)\b.*\b(?:charge|payment|transfer)", "payments are outside every envelope"),
)


def now():
    return datetime.now(timezone.utc)


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def session_path(root):
    path = root / ".omniharness/session.json"
    if not path.resolve().is_relative_to(root):
        raise ValueError("session storage escapes the project root")
    return path


def load_session(root, session_id):
    try:
        envelope = json.loads(session_path(root).read_text(encoding="utf-8"))
        if envelope["version"] != 1 or envelope["mode"] not in MODES or envelope["session_id"] != session_id:
            raise ValueError("session identity or schema mismatch")
        if Path(envelope["root"]).resolve() != root or not envelope["approval_reference"].strip():
            raise ValueError("root/approval mismatch")
        expiry = datetime.fromisoformat(envelope["expires_at"])
        if expiry.tzinfo is None or expiry <= now():
            raise ValueError("session expired")
        if not envelope["scope"] or any(not Path(p).resolve().is_relative_to(root) for p in envelope["scope"]):
            raise ValueError("invalid scope")
        if not isinstance(envelope["scope"], list) or not all(isinstance(envelope[k], list) and all(isinstance(v, str) for v in envelope[k]) for k in ("hosts", "installs")):
            raise ValueError("invalid scope/hosts/installs")
        budget = envelope["budget"]
        if set(budget) != {"usd", "tokens"} or not number(budget["usd"]) or budget["usd"] <= 0 or (budget["tokens"] is not None and (type(budget["tokens"]) is not int or budget["tokens"] <= 0)) or envelope["warn_at"] != 0.8:
            raise ValueError("invalid budget")
        return envelope, "active envelope"
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        return None, f"Strict fallback: {exc}"


def decision(kind, reason, mode, **extra):
    return {"decision": kind, "reason": reason, "mode": mode, "warnings": [], **extra}


def local_read(command):
    if re.search(r"[;&|<>`$\r\n]", command):
        return False
    try:
        args = shlex.split(command)
    except ValueError:
        return False
    if args[:2] in (["git", "status"], ["git", "log"], ["git", "diff"]):
        if args[1] == "diff" and not {"--no-ext-diff", "--no-textconv"} <= set(args[2:]):
            return False
        return all(a in ("--short", "--porcelain", "--oneline", "--stat", "--name-only", "--cached", "--no-ext-diff", "--no-textconv") for a in args[2:])
    return args in (["ls"], ["ls", "-la"], ["pwd"], ["Get-Location"])


def usage_from_transcript(envelope, request):
    unknown = {"usd": None, "tokens": None}
    path = (envelope or {}).get("transcript_path")
    if not path or (request.get("transcript_path") and Path(request["transcript_path"]).resolve() != Path(path).resolve()):
        return unknown
    try:
        # Whole-tree result only. Assistant output counters can be placeholders;
        # top-level usage excludes subagents. Neither certifies remaining budget.
        receipt = usage_from_stream(Path(path).read_bytes(), session=envelope["session_id"], exit_code=-1)
        return {"usd": receipt["estimated_usd"], "tokens": receipt["total_tokens"]}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return unknown


def network_command(command, envelope, root):
    """Finite unauthenticated GET/install forms; no shell evaluation or redirect following."""
    if re.search(r"[;&|<>`$\r\n]", command): return None
    try:
        args = shlex.split(command)
    except ValueError:
        return None
    if not args: return None
    if args[:2] == ["curl", "-q"] and len(args) >= 3:
        try:
            url = urlsplit(args[-1])
            if url.scheme != "https" or not url.hostname or url.username or url.password or url.port not in (None, 443) or url.query or url.fragment: return None
        except ValueError:
            return None
        if any(a not in ("--fail", "--silent", "--show-error", "--head") for a in args[2:-1]): return None
        return {"host": url.hostname, "approved": url.hostname in envelope["hosts"], "estimate_usd": 0}
    if args[:3] == ["python", "-m", "pip"]: args = ["pip"] + args[3:]
    if len(args) == 5 and args[:3] == ["pip", "install", "--target"]:
        target = (root / args[3]).resolve()
        approved = (args[4] in envelope["installs"] and set(("pypi.org", "files.pythonhosted.org")) <= set(envelope["hosts"])
                    and any(target.is_relative_to(Path(p).resolve()) for p in envelope["scope"]))
        # Package build scripts may contact other hosts: the host must still ask.
        return {"host": "pypi.org", "approved": False, "listed_install": approved, "estimate_usd": 0}
    return None


def evaluate(root, request):
    root = Path(root).resolve()
    if not isinstance(request, dict):
        return decision("deny", "malformed request", "strict")
    envelope, state = load_session(root, request.get("session_id"))
    mode = envelope["mode"] if envelope else "strict"
    tool = request.get("tool_name", "Bash")
    inp = request.get("tool_input") or {}
    if not isinstance(inp, dict):
        return decision("deny", "malformed tool input", mode)
    command = inp.get("command", "")
    if not isinstance(command, str):
        return decision("deny", "malformed command", mode)
    file_path = inp.get("file_path") or inp.get("path")
    surface = command if tool in ("Bash", "PowerShell") else str(file_path or tool)
    for pattern, reason in HARD_STOPS:
        if re.search(pattern, surface, re.I):
            return decision("deny", reason, mode)
    if file_path and any(part in (".omniharness", ".claude", ".codex") for part in Path(file_path).parts) and tool in ("Write", "Edit"):
        return decision("deny", "policy files cannot be changed by envelope authority", mode)
    cwd = Path(request.get("cwd") or root).resolve()
    if not cwd.is_relative_to(root):
        return decision("ask", "working directory outside project", mode)
    if tool in ("Bash", "PowerShell") and local_read(command):
        return decision("allow", "recognised local read", mode)
    if envelope and tool == "Bash":
        network = network_command(command, envelope, cwd)
        if network:
            if not network["approved"] or mode == "strict" or (mode == "balanced" and request.get("is_fallback")):
                return decision("ask", "network/install or fallback is outside this approval", mode, resource="network", **network)
            return decision("allow", "network/install covered by approved envelope", mode, resource="network", **network)
    if tool in ("Read", "Glob", "Grep", "Write", "Edit"):
        if tool in ("Write", "Edit", "Read") and not isinstance(file_path, str):
            return decision("deny", "missing file path", mode)
        target = (cwd / (file_path or ".")).resolve()
        for pattern, reason in HARD_STOPS:
            if re.search(pattern, str(target), re.I):
                return decision("deny", reason, mode)
        if tool == "Glob":
            pattern = inp.get("pattern", "")
            if not isinstance(pattern, str) or Path(pattern).is_absolute() or ".." in pattern.replace("\\", "/").split("/"):
                return decision("ask", "glob can escape the approved path", mode)
        if tool == "Grep" and not target.is_file():
            return decision("ask", "recursive content search needs explicit scope/credential exclusions", mode)
        policy = target.name.lower() == "agents.md" or target in (Path(__file__).resolve(), Path(__file__).with_name("guard_bash.py").resolve(), Path(__file__).with_name("settings.json").resolve())
        if tool in ("Write", "Edit") and (policy or any(part.lower() in (".omniharness", ".claude", ".codex") for part in target.parts)):
            return decision("deny", "policy files cannot be changed by envelope authority", mode)
        scopes = envelope["scope"] if envelope else [str(root)]
        if not any(target.is_relative_to(Path(p).resolve()) for p in scopes):
            return decision("ask", "path outside approved scope", mode)
        if tool in ("Read", "Glob", "Grep"):
            return decision("allow", "local read inside scope", mode)
        if envelope and mode != "strict":
            return decision("allow", "local edit inside approved scope", mode)
    return decision("ask", "unclassified operation or " + state, mode)


def check(root, request):
    result = evaluate(root, request)
    if not isinstance(request, dict) or not isinstance(request.get("tool_input", {}), dict):
        return result
    root = Path(root).resolve()
    envelope, _ = load_session(root, request.get("session_id"))
    usage = usage_from_transcript(envelope, request)
    path = session_path(root)
    log = path.with_name("session.log")
    if not log.resolve().is_relative_to(root):
        raise ValueError("log path escapes project root")
    floor = {"usd": 0, "tokens": 0}
    if log.exists():
        for line in log.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            if row.get("session_id") == request.get("session_id"):
                for unit in floor:
                    value = row.get("usage", {}).get(unit)
                    if number(value): floor[unit] = max(floor[unit], value)
    warnings = []
    if envelope:
        for unit, limit in envelope["budget"].items():
            used = max(floor[unit], usage.get(unit) or 0)
            if number(limit) and number(used):
                if used >= limit:
                    result = decision("deny", f"{unit} budget exhausted", envelope["mode"])
                elif used >= limit * envelope["warn_at"]:
                    warnings.append(f"{unit} budget at or above 80%")
        if result["decision"] == "allow" and result.get("resource") == "network":
            if any(limit is not None and not number(usage.get(unit)) for unit, limit in envelope["budget"].items()):
                result["decision"], result["reason"] = "ask", "budget usage unavailable; remaining budget cannot be certified"
    result.update(usage=usage, usage_floor=floor, warnings=warnings)
    if path.exists():
        # Log identities and decisions, not arguments that may contain credentials.
        action = (request.get("tool_input") or {}).get("command", request.get("tool_name", "unknown"))
        row = {"at": now().isoformat(), "session_id": request.get("session_id"),
               "tool": request.get("tool_name", "Bash"), "command_sha256": hashlib.sha256(str(action).encode()).hexdigest(), **result}
        with log.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    return result


def start(args):
    root = Path(args.root).resolve()
    if not number(args.budget_usd) or args.budget_usd <= 0:
        raise ValueError("budget must be positive and finite")
    if args.token_budget is not None and args.token_budget <= 0:
        raise ValueError("token budget must be positive")
    if not args.approval_reference.strip() or not args.session_id.strip():
        raise ValueError("session identity and explicit approval reference are required")
    if not 0 < args.hours <= 24:
        raise ValueError("expiry must be between 0 and 24 hours")
    scope = [str((root / p).resolve()) for p in (args.scope or ["."])]
    if any(not Path(p).is_relative_to(root) for p in scope):
        raise ValueError("scope must stay inside the project root")
    envelope = {"version": 1, "session_id": args.session_id, "mode": args.mode, "root": str(root),
                "scope": scope, "hosts": args.host, "installs": args.install,
                "budget": {"usd": args.budget_usd, "tokens": args.token_budget}, "warn_at": 0.8,
                "approved_at": now().isoformat(), "expires_at": (now() + timedelta(hours=args.hours)).isoformat(),
                "approval_reference": args.approval_reference,
                "transcript_path": str(Path(args.transcript).resolve()) if args.transcript else None}
    path = session_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Explicit creation never silently replaces a signed scope. Mode changes use a separate command.
    if path.exists() and args.replace:
        backup = path.with_name("session." + now().strftime("%Y%m%dT%H%M%S%f") + ".json")
        path.rename(backup)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(envelope, stream, indent=2)
    return envelope


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("menu", "start", "check", "explain", "status"):
        sub = commands.add_parser(name)
        sub.add_argument("--root", default=".")
        if name == "start":
            sub.add_argument("--session-id", required=True)
            sub.add_argument("--approval-reference", required=True)
            sub.add_argument("--mode", choices=MODES, default="balanced")
            sub.add_argument("--budget-usd", type=float, default=2)
            sub.add_argument("--token-budget", type=int)
            sub.add_argument("--hours", type=float, default=4)
            sub.add_argument("--scope", action="append", default=[])
            sub.add_argument("--host", action="append", default=[])
            sub.add_argument("--install", action="append", default=[])
            sub.add_argument("--transcript")
            sub.add_argument("--replace", action="store_true", help="archive prior approval before creating the newly approved envelope")
        if name == "status":
            sub.add_argument("--session-id", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command in ("check", "explain"):
            result = check(args.root, json.load(sys.stdin))
            print(json.dumps(result, ensure_ascii=False))
            return {"allow": 0, "ask": 3, "deny": 2}[result["decision"]]
        if args.command == "status":
            envelope, reason = load_session(Path(args.root).resolve(), args.session_id)
            print(json.dumps({"active": envelope is not None, "mode": envelope["mode"] if envelope else "strict", "reason": reason, "envelope": envelope, "usage": usage_from_transcript(envelope, {})}))
            return 0
        result = start(args) if args.command == "start" else {
            "modes": list(MODES), "default_mode": "balanced", "budget_usd": 2,
            "token_budget": None, "warning_percent": 80, "scope": str(Path(args.root).resolve()),
            "hosts": [], "installs": [], "expires_in_hours": 4,
            "approval_required": True}
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
