"""skill_installer.py: intake and installation routine for tools the harness knows (installers.toml).

plan <name>       zero network: what is done, what is todo (each with its gate entry and exact command), what only the owner can do (keys)
apply <name> --yes   run the runnable todo steps in order; refuses without --yes; never runs an owner-only step; stops at the first failure
env               every environment variable the manifest mentions: set or missing (names only, never values)
register <name>   append the tool as a [[node]] to skills-graph.toml with its measured status (the owner's yes is the apply itself)
list              the tools the manifest knows
"""
import argparse
import glob
import json
import os
import shlex
import shutil
import subprocess
import sys
import tomllib
from datetime import date

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.realpath(__file__)).replace("\\", "/")
SKILL_DIR = os.path.dirname(HERE)
GRAPH_TOML = os.path.dirname(SKILL_DIR) + "/skills-graph/skills-graph.toml"


def read_json(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def check(kind_value, home, env):
    """One state probe. Kinds: plugin:<name>, marketplace:<name>, mcp:<name>, env:<VAR>, path:<exe>, file:<glob>, manual."""
    kind, _, value = kind_value.partition(":")
    home = home.rstrip("/")
    if kind == "plugin":
        return any(k.split("@")[0] == value for k in read_json(f"{home}/.claude/plugins/installed_plugins.json").get("plugins", {}))
    if kind == "marketplace":
        return value in read_json(f"{home}/.claude/plugins/known_marketplaces.json")
    if kind == "mcp":
        cfg = read_json(f"{home}/.claude.json")
        servers = set(cfg.get("mcpServers", {})) | {s for p in cfg.get("projects", {}).values() for s in (p.get("mcpServers") or {})}
        servers |= set(read_json(".mcp.json").get("mcpServers", {}))
        return value in servers
    if kind == "env":
        return bool(env.get(value))
    if kind == "path":
        return shutil.which(value) is not None
    if kind == "file":
        return bool(glob.glob(os.path.expanduser(value).replace("~", home, 1) if value.startswith("~") else value, recursive=True))
    return False  # manual: never auto-satisfied


def load_manifest(path):
    with open(path, "rb") as f:
        return tomllib.load(f)


def status(tool, home, env):
    """[(step, state)] with state in done | todo | blocked | owner."""
    out = []
    for s in tool["steps"]:
        if s.get("check") and s["check"] != "manual" and check(s["check"], home, env):
            state = "done"
        elif s.get("owner_only"):
            state = "owner"
        elif any(not env.get(v) for v in s.get("requires_env", [])):
            state = "blocked"
        else:
            state = "todo"
        out.append((s, state))
    return out


def plan(name, tool, home, env):
    lines = [f"{name}: {tool.get('kind', '?')} · {tool.get('url', '')} · {tool.get('license', 'license not stated')}"]
    for s, state in status(tool, home, env):
        mark = {"done": "OK  ", "todo": "TODO", "blocked": "WAIT", "owner": "YOU "}[state]
        line = f"  {mark} {s['id']}"
        if s.get("run"):
            line += f": {s['run']}"
        if s.get("note"):
            line += f"  ({s['note']})"
        if state == "todo" and s.get("gate"):
            line += f"  [STOP: confirm: {s['gate']}]"
        if state == "blocked":
            line += "  [needs " + ", ".join(v for v in s.get("requires_env", []) if not env.get(v)) + "]"
        lines.append(line)
    return lines


def apply(name, tool, home, env, yes, log):
    if not yes:
        print("refusing: apply runs gated commands; rerun with --yes after the owner said yes to the plan")
        return 1
    for s, state in status(tool, home, env):
        if state != "todo" or not s.get("run"):
            continue
        cmd = os.path.expandvars(s["run"])
        print(f"running {s['id']}: {cmd}")
        r = subprocess.run(shlex.split(cmd, posix=os.name != "nt") if os.name != "nt" else cmd, shell=os.name == "nt",
                           capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
        print((r.stdout + r.stderr).strip()[-2000:])
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps({"date": date.today().isoformat(), "tool": name, "step": s["id"], "cmd": cmd, "exit": r.returncode}) + "\n")
        if r.returncode != 0:
            print(f"stopped at {s['id']} (exit {r.returncode}); nothing after it ran")
            return r.returncode
    return 0


def register(name, tool, home, env, graph_toml):
    states = status(tool, home, env)
    done = sum(st == "done" for _, st in states)
    verdict = "installed" if all(st == "done" for _, st in states if not _.get("owner_only")) else f"partial ({done}/{len(states)} steps)"
    ring = "installed" if verdict == "installed" else "catalog"
    block = (f"\n[[node]]  # registered by skill-installer {date.today().isoformat()}: {verdict}\n"
             f"id = {json.dumps(tool.get('graph_id', name))}\nring = {json.dumps(ring)}\nurl = {json.dumps(tool.get('url', ''))}\n"
             f"status = {json.dumps(verdict)}\n")
    with open(graph_toml, "a", encoding="utf-8") as f:
        f.write(block)
    print(f"registered {name} as {ring} ({verdict}) in {graph_toml}; run skills_graph.py build to refresh the snapshot")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--manifest", default=f"{SKILL_DIR}/installers.toml")
    ap.add_argument("--graph", default=GRAPH_TOML)
    ap.add_argument("--log", default=f"{SKILL_DIR}/install-log.jsonl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for c in ("plan", "register"):
        sub.add_parser(c).add_argument("name")
    ap_apply = sub.add_parser("apply"); ap_apply.add_argument("name"); ap_apply.add_argument("--yes", action="store_true")
    sub.add_parser("env"); sub.add_parser("list")
    a = ap.parse_args(argv)
    home = os.path.abspath(a.home).replace("\\", "/")
    env = dict(os.environ)
    m = load_manifest(a.manifest)
    if a.cmd == "list":
        for n, t in m.items():
            print(f"{n:16s} {t.get('kind', '?'):14s} {t.get('url', '')}")
        return 0
    if a.cmd == "env":
        names = sorted({v for t in m.values() for v in t.get("env", [])} | {v for t in m.values() for s in t["steps"] for v in s.get("requires_env", [])}
                       | {s["check"][4:] for t in m.values() for s in t["steps"] if str(s.get("check", "")).startswith("env:")})
        for v in names:
            print(f"{'set    ' if env.get(v) else 'missing'} {v}")
        return 0
    if a.name not in m:
        sys.exit(f"unknown tool {a.name!r}; known: {', '.join(m)}")
    tool = m[a.name]
    if a.cmd == "plan":
        print("\n".join(plan(a.name, tool, home, env)))
        return 0
    if a.cmd == "apply":
        return apply(a.name, tool, home, env, a.yes, a.log)
    return register(a.name, tool, home, env, a.graph)


if __name__ == "__main__":
    sys.exit(main())
