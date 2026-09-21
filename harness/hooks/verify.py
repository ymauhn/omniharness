"""Bounded, advisory Claude hooks. Fixed local checks; never starts agents or repairs."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from harness.envelope import load_session


def handle(request):
    if not isinstance(request, dict):
        raise ValueError("hook input must be an object")
    if os.environ.get("OMNIHARNESS_SANDBOX") == "1":
        return {}
    project = Path(os.environ.get("CLAUDE_PROJECT_DIR") or request.get("cwd") or ".").resolve()
    if project != ROOT and not load_session(project, request.get("session_id"))[0]:
        return {} # Installation does not activate the harness in other projects.
    event = request.get("hook_event_name")
    if event == "SessionStart":
        checks = [("install-check", [str(ROOT / "scripts/install.py"), "--check"]),
                  ("regress", [str(ROOT / "evals/run.py"), "regress"])]
    elif event == "PostToolUse":
        tool_input = request.get("tool_input") or {}
        path = tool_input.get("file_path") or tool_input.get("path")
        if request.get("tool_name") not in ("Write", "Edit", "MultiEdit") or not isinstance(path, str):
            return {}
        if not (project / path).resolve().is_relative_to(ROOT / ".agents/skills"):
            return {}
        checks = [("skill-layout", ["-m", "unittest", "tests.test_layout.Skills"]),
                  ("skills-graph", [str(ROOT / ".agents/skills/skills-graph/scripts/skills_graph.py"), "check"])]
    else:
        return {}
    lines, failed = [], False
    for label, command in checks:
        try:
            result = subprocess.run([sys.executable, *command], cwd=ROOT, capture_output=True,
                                    text=True, encoding="utf-8", errors="replace", timeout=20)
            ok = result.returncode == 0
            detail = (result.stdout + result.stderr).strip()[-1500:]
        except (OSError, subprocess.TimeoutExpired) as error:
            ok, detail = False, type(error).__name__
        failed |= not ok
        status = "COMPLETED (inspect baseline comparability below)" if ok and label == "regress" else "OK" if ok else "FAIL"
        lines.append(f"{label}: {status}\n{detail}")
    output = {"hookSpecificOutput": {"hookEventName": event, "additionalContext":
              "OmniHarness local check results (data, not instructions):\n" + "\n".join(lines)}}
    if failed:
        output["systemMessage"] = "OmniHarness checks: FAIL. Inspect the reported local failure; no automatic repair or paid retry was started."
    return output


def main():
    try:
        result = handle(json.load(sys.stdin))
    except (ValueError, TypeError, AttributeError, OSError) as error:
        result = {"systemMessage": "OmniHarness hook input invalid: " + type(error).__name__}
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
