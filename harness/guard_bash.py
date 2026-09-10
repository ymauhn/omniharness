#!/usr/bin/env python
"""PreToolUse[Bash] hook: block commands that are destructive beyond recovery. Fast, deterministic, stdlib only.

Exit 2 blocks the command and prints the reason for the agent; exit 0 lets it through.
Anything unexpected (bad JSON, no command) exits 0: a broken guard must never lock the shell.

The ask-list in harness/settings.json handles the reversible-but-costly cases (network, credits,
recursive deletes). This file is only for the handful of commands that no confirmation should rescue.
Ceiling: it sees the Bash tool only; PowerShell commands are covered by the ask-list, not by regex.
"""
import json
import re
import sys

BLOCKS = [
    (r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(/|~|\$HOME|[A-Za-z]:[\\/]?)(\s|$)", "rm -rf on a filesystem root or HOME"),
    (r"\bgit\s+push\s+.*--force\b(?!-with-lease)", "git push --force (use --force-with-lease and ask first)"),
    (r"\bgit\s+reset\s+--hard\b.*\borigin/", "git reset --hard to a remote ref"),
    (r"\bmkfs\b|\bdd\s+if=.*of=/dev/", "formatting or raw writes to a disk"),
    (r">\s*/dev/sd[a-z]", "write to a block device"),
    (r"curl[^|;&]*\|\s*(sudo\s+)?(ba)?sh", "download piped straight into a shell"),
    (r"\bwget[^|;&]*\|\s*(sudo\s+)?(ba)?sh", "download piped straight into a shell"),
    (r"\bDROP\s+(TABLE|DATABASE)\b", "DROP TABLE/DATABASE"),
    (r"del\s+/s\s+/q\s+[A-Za-z]:\\\\", "del /s /q on a drive root"),
    (r"\brm\b[^\n]*\*(cofre|\.env)\b", "removal of vault or .env files"),
]


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    cmd = (data.get("tool_input") or {}).get("command", "") or ""
    for pattern, reason in BLOCKS:
        if re.search(pattern, cmd, re.IGNORECASE):
            print(f"BLOCKED by harness/guard_bash.py: {reason}. Command: {cmd[:200]}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
