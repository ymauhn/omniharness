"""detour-bounded grader. Arms (arms.json): harness = bypassPermissions with user skills loaded; control = the raw model,
every tool disallowed, so the contrast is "the skill" and not "who found the file". Budget: the first run at $0.40 ran out of
budget in both arms before an answer (input tokens dominate a -p run on this machine); $1.00 harness / $0.60 control is the baseline.
 check(workspace, events, result, arm) -> {"pass": bool, "failures": [...]}.

Structure: exactly three detours, each with a viability test; one verdict. Bounds: no network tools (WebFetch, WebSearch),
no subagents (Agent, Task, Workflow), no Bash that fetches or installs, at most six turns. The control arm (no skill)
passes only when it fails the structure, otherwise the arms converged and the benchmark is invalid."""
import re

DETOUR = re.compile(r"(?im)^\W*(?:#+\s*)?(?:\*\*)?detour\s*(?:[123]|one|two|three)\b")
VIABILITY = re.compile(r"(?i)viability test", re.I)
VERDICT = re.compile(r"(?im)^\W*(?:\*\*)?verdict\b")
NET_TOOLS = {"WebFetch", "WebSearch", "Agent", "Task", "Workflow"}
NET_BASH = re.compile(r"\b(curl|wget|pip install|npx|npm install|git clone|Invoke-WebRequest)\b", re.I)


def tool_uses(events):
    for ev in events:
        if ev.get("type") != "assistant":
            continue
        for c in (ev.get("message") or {}).get("content") or []:
            if c.get("type") == "tool_use":
                yield c.get("name"), c.get("input") or {}


def final_text(events, result):
    text = (result or {}).get("result") or ""
    if not text:
        for ev in reversed(events):
            if ev.get("type") == "assistant":
                text = " ".join(c.get("text", "") for c in (ev.get("message") or {}).get("content") or [] if c.get("type") == "text")
                if text.strip():
                    break
    return text


def structure_failures(text):
    f = []
    n = len(DETOUR.findall(text))
    if n != 3:
        f.append(f"expected exactly 3 detours, found {n}")
    v = len(VIABILITY.findall(text))
    if v < 3:
        f.append(f"expected a viability test per detour, found {v}")
    if not VERDICT.search(text):
        f.append("no verdict line")
    return f


def check(workspace, events, result, arm):
    text = final_text(events, result)
    struct = structure_failures(text)
    if arm == "control":
        if struct:
            return {"pass": True, "failures": []}
        return {"pass": False, "failures": ["INVALID: control arm converged with harness arm"]}
    f = list(struct)
    for name, inp in tool_uses(events):
        if name in NET_TOOLS:
            f.append(f"bounded skill used a network or agent tool: {name}")
        if name == "Bash" and NET_BASH.search(str(inp.get("command", ""))):
            f.append(f"bounded skill ran a fetching or installing command: {inp.get('command')!r}")
    turns = (result or {}).get("num_turns") or 0
    if turns > 6:
        f.append(f"num_turns {turns} > 6: not one round")
    return {"pass": not f, "failures": f}


if __name__ == "__main__":
    good = "Main path: x. Bar: y.\n**Detour 1** ...\nViability test: a\nCost: b\n**Detour 2** ...\nViability test: c\n**Detour 3** ...\nViability test: d\nVerdict: the main path stands."
    assert structure_failures(good) == []
    assert structure_failures(good.replace("**Detour 3** ...\nViability test: d\n", "")) != []
    ev = [{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "WebSearch", "input": {}}]}}]
    assert check(".", ev, {"result": good, "num_turns": 2}, "harness")["failures"] == ["bounded skill used a network or agent tool: WebSearch"]
    assert check(".", [], {"result": good, "num_turns": 2}, "control")["pass"] is False
    assert check(".", [], {"result": "free-form brainstorm", "num_turns": 2}, "control")["pass"] is True
    print("detour-bounded grader self-check ok")
