"""skills_graph.py: a three-ring graph of every skill the hosts can reach, at zero model tokens.

Rings: installed (SKILL.md scan of the repo, ~/.claude/skills, ~/.agents/skills, ~/.codex/skills, ~/.hermes/skills
and the plugins in ~/.claude/plugins/installed_plugins.json), catalog (the official marketplace.json on disk plus the
tables in docs/catalog/), remote (remote.json, written by the skill after the owner approved the fetch).
Edges: `calls` is parsed from SKILL.md bodies ("call the Skill tool with \"x\"", "/x"); every other type comes from
skills-graph.toml (curated) or proposals.jsonl (queued for the owner). Commands: build, check, neighbors, route,
propose, approve, reject. Stdlib only (tomllib needs Python 3.11+).
"""
import argparse
import glob
import json
import math
import os
import re
import shutil
import sys
import tomllib
from datetime import date
from pathlib import Path

HERE = os.path.dirname(os.path.realpath(__file__)).replace("\\", "/")
SKILL_DIR = os.path.dirname(HERE)
EDGE_TYPES = ("calls", "precedes", "feeds", "alternative-to", "candidate-for", "guided-by")
DASHED = ("alternative-to", "candidate-for")
MARKET = ".claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json"
SKILL_TOOL = re.compile(r"skill tool[^\n]*", re.I)
QUOTED = re.compile(r"[\"'`]([a-z0-9][a-z0-9:_-]*)[\"'`]")
SLASH = re.compile(r"(?<![\w/])/([a-z][a-z0-9_-]{2,})\b")
STOP = set("a an the and or of to for in on with by from is are be use when this that it its as at into your you".split())


def read(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read()


def frontmatter(text):
    """name/description/... from a SKILL.md; folded scalars are joined, nested keys are swallowed by their parent."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    out, key = {}, None
    for ln in text[3:end].splitlines():
        m = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", ln)
        if m:
            key, val = m.group(1), m.group(2).strip()
            out[key] = "" if val in (">", "|", ">-", "|-") else val.strip("\"'")
        elif key and ln[:1] in (" ", "\t"):
            out[key] = (out[key] + " " + ln.strip()).strip()
    return out


def skill_files(home, root):
    """(path, host) for every reachable SKILL.md; plugins come from installed_plugins.json, not from cache globs."""
    out = [(p, host) for pat, host in ((f"{root}/.agents/skills/*/SKILL.md", "repo"),
                                       (f"{home}/.claude/skills/*/SKILL.md", "claude"),
                                       (f"{home}/.agents/skills/*/SKILL.md", "agents"),
                                       (f"{home}/.codex/skills/*/SKILL.md", "codex"),
                                       (f"{home}/.hermes/skills/*/SKILL.md", "hermes"))
           for p in glob.glob(pat)]
    reg = f"{home}/.claude/plugins/installed_plugins.json"
    if os.path.isfile(reg):
        for pname, installs in json.loads(read(reg)).get("plugins", {}).items():
            for inst in installs:
                base = inst.get("installPath", "")
                for d, dirs, files in os.walk(base):
                    dirs[:] = [x for x in dirs if not x.startswith(".") and x != "node_modules"]
                    if "SKILL.md" in files:
                        out.append((os.path.join(d, "SKILL.md"), "plugin:" + pname.split("@")[0]))
    return [(p.replace("\\", "/"), h) for p, h in out]


def scan_installed(home, root):
    nodes = {}
    for path, host in skill_files(home, root):
        fm = frontmatter(read(path))
        name = fm.get("name") or os.path.basename(os.path.dirname(path))
        n = nodes.setdefault(name, {"id": name, "ring": "installed", "description": "", "hosts": [], "paths": [], "calls": []})
        n["description"] = n["description"] or fm.get("description", "")[:300]
        if host not in n["hosts"]:
            n["hosts"].append(host)
        real = os.path.realpath(path).replace("\\", "/")
        if real not in n["paths"]:
            n["paths"].append(real)
    names = set(nodes)
    for n in nodes.values():
        found = set()
        for p in n["paths"]:
            body = read(p)
            for line in SKILL_TOOL.findall(body):
                found.update(t for t in QUOTED.findall(line) if t in names)
            found.update(t for t in SLASH.findall(body) if t in names)
        found.discard(n["id"])
        n["calls"] = sorted(found)
    return nodes


def slug(cell):
    return re.sub(r"[^a-z0-9/._-]+", "-", re.sub(r"\(.*?\)", "", cell.replace("`", "")).lower()).strip("-")


def catalog_tables(root):
    """One node per row of the docs/catalog tables: id = slug of the first cell, url = the first http cell."""
    nodes = {}
    for f in ("community-skills.md", "mcp-servers.md", "free-tiers.md"):
        path = f"{root}/docs/catalog/{f}"
        if not os.path.isfile(path):
            continue
        lines, section = read(path).splitlines(), ""
        for i, ln in enumerate(lines):
            if ln.startswith("## "):
                section = ln[3:].strip()
            if not ln.startswith("|") or ln.startswith("|---") or (i + 1 < len(lines) and lines[i + 1].startswith("|---")):
                continue
            cells = [c.strip() for c in ln.strip("|").split("|")]
            sid = slug(cells[0])
            if sid:
                url = next((c for c in cells if c.startswith("http")), "")
                nodes[sid] = {"id": sid, "ring": "catalog", "source": f"docs/catalog/{f}", "section": section,
                              "description": cells[-1][:300], "url": url}
    return nodes


def scan_catalog(home, root):
    nodes = {}
    mp = f"{home}/{MARKET}"
    if os.path.isfile(mp):
        for p in json.loads(read(mp)).get("plugins", []):
            nodes[p["name"]] = {"id": p["name"], "ring": "catalog", "source": "marketplace:claude-plugins-official",
                                "category": p.get("category", ""), "description": p.get("description", "")[:300],
                                "url": p.get("homepage") or (p["source"].get("url", "") if isinstance(p.get("source"), dict) else str(p.get("source", "")))}
    nodes.update(catalog_tables(root))
    return nodes


def load_curated(data):
    path = f"{data}/skills-graph.toml"
    return tomllib.loads(read(path)) if os.path.isfile(path) else {}


def load_proposals(data):
    path = f"{data}/proposals.jsonl"
    return [json.loads(ln) for ln in read(path).splitlines() if ln.strip()] if os.path.isfile(path) else []


def build(home, root, data):
    curated = load_curated(data)
    nodes = scan_installed(home, root)
    nodes.update({k: v for k, v in scan_catalog(home, root).items() if k not in nodes})
    rpath = f"{data}/remote.json"
    remote = json.loads(read(rpath)) if os.path.isfile(rpath) else {}
    for e in remote.get("entries", []):
        nodes.setdefault(e["id"], {**e, "ring": "remote", "fetched": remote.get("fetched", "")})
    for cn in curated.get("node", []):  # curated nodes win over table rows that point at the same url
        for k in [k for k, v in nodes.items() if cn.get("url") and v.get("url") == cn["url"] and k != cn["id"]]:
            cn.setdefault("source", nodes[k].get("source")); del nodes[k]
        nodes[cn["id"]] = {**nodes.get(cn["id"], {"ring": cn.get("ring", "catalog")}), **cn}
    edges = [{"from": n["id"], "type": "calls", "to": t, "source": "parsed"} for n in nodes.values() for t in n.get("calls", [])]
    edges += [{**e, "source": "curated"} for e in curated.get("edge", [])]
    edges += [{"from": p["from"], "type": p["type"], "to": p["to"], "source": f"proposal:{p['n']}"}
              for p in load_proposals(data) if p.get("status") == "proposed"]
    warnings = []
    for e in edges:
        if e["type"] not in EDGE_TYPES:
            warnings.append(f"unknown edge type {e['type']!r} on {e['from']} -> {e['to']}")
        for end in (e["from"], e["to"]):
            if end not in nodes:
                nodes[end] = {"id": end, "ring": "missing", "description": "referenced by an edge, not reachable on this machine"}
                warnings.append(f"{e['source']} edge {e['from']} -{e['type']}-> {e['to']}: {end!r} is not reachable here")
    rings = {}
    for n in nodes.values():
        rings[n["ring"]] = rings.get(n["ring"], 0) + 1
    graph = {"generated": date.today().isoformat(), "home": home, "root": root, "rings": rings,
             "remote_sources": curated.get("remote", {}).get("sources", []), "remote_fetched": remote.get("fetched", ""),
             "nodes": sorted(nodes.values(), key=lambda n: (n["ring"], n["id"])), "edges": edges, "warnings": warnings}
    return graph


def mid(s):
    return "n_" + re.sub(r"[^A-Za-z0-9]", "_", s)


def mermaid(g):
    linked = {e["from"] for e in g["edges"]} | {e["to"] for e in g["edges"]}
    byring = {}
    for n in g["nodes"]:
        if n["ring"] == "installed" or n["id"] in linked:
            byring.setdefault(n["ring"], []).append(n)
    out = ["```mermaid", "flowchart LR"]
    for ring in ("installed", "catalog", "remote", "missing"):
        if ring not in byring:
            continue
        total = g["rings"].get(ring, 0)
        title = ring if ring == "installed" else f"{ring}: {len(byring[ring])} of {total} linked"
        out.append(f'  subgraph {ring}["{title}"]')
        out += [f'    {mid(n["id"])}["{n["id"]}"]' for n in byring[ring]]
        out.append("  end")
    for e in g["edges"]:
        arrow = "-.->" if e["type"] in DASHED else "-->"
        out.append(f'  {mid(e["from"])} {arrow}|{e["type"]}| {mid(e["to"])}')
    out.append("```")
    head = [f"# Skills graph ({g['generated']})", "",
            "Generated by `skills_graph.py build`; do not edit. Installed nodes are all shown; catalog and remote nodes only when an edge touches them. "
            f"Rings: {', '.join(f'{k} {v}' for k, v in sorted(g['rings'].items()))}. Edges: {len(g['edges'])} "
            f"({sum(e['type'] == 'calls' for e in g['edges'])} parsed `calls`). Remote snapshot: {g['remote_fetched'] or 'none'}.", ""]
    if g["warnings"]:
        head += ["Warnings:", ""] + [f"- {w}" for w in g["warnings"]] + [""]
    return "\n".join(head + out) + "\n"


def score(node, words):
    text = (node.get("description", "") + " " + node["id"]).lower()
    return sum(3 if w in node["id"].lower() else 1 for w in words if w in text)


def measured(node, unit="usd"):
    cost = node.get("cost", {})
    if not isinstance(cost, dict): return None
    value = cost.get(unit)
    try:
        dated = date.fromisoformat(cost.get("date", "")) <= date.today()
    except (ValueError, TypeError):
        dated = False
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 and isinstance(cost.get("benchmark"), str) and cost["benchmark"].strip() and dated else None


def cost_key(node, unit):
    value = measured(node, unit)
    return (value is None, value or 0)


def unmet(needs, g, root):
    """Inspect presence only; never print environment values or execute a binary."""
    if not isinstance(needs, dict): return ["invalid needs object"]
    missing = []
    root = Path(root).resolve()
    installed = {n["id"] for n in g["nodes"] if n["ring"] == "installed"}
    for kind, values in needs.items():
        if kind not in ("files", "env", "skills", "binaries") or not isinstance(values, list) or not all(isinstance(v, str) and v for v in values):
            missing.append("invalid needs:" + kind)
            continue
        for value in values:
            path = (root / value).resolve()
            present = {"files": lambda: path.is_relative_to(root) and path.is_file(),
                       "env": lambda: bool(os.environ.get(value)), "skills": lambda: value in installed,
                       "binaries": lambda: shutil.which(value) is not None}[kind]()
            if not present: missing.append(kind + ":" + value)
    return missing


def alternatives(g, node_id, root, unit="usd", excluded=()):
    neighbours = {e["to"] if e["from"] == node_id else e["from"] for e in g["edges"]
                  if e["type"] == "alternative-to" and e["source"] == "curated" and node_id in (e["from"], e["to"])}
    return sorted((n for n in g["nodes"] if n["id"] in neighbours and n["id"] not in excluded and n["ring"] == "installed"
                   and not unmet(n.get("needs", {}), g, root)), key=lambda n: (*cost_key(n, unit), n["id"]))


def plan_status(g, plan, root, mode="strict", unit="usd", remaining=None):
    steps = plan.get("steps")
    if mode not in ("strict", "balanced", "swarm") or not isinstance(steps, list) or not steps:
        raise ValueError("a mode and nonempty steps list are required")
    if any(not isinstance(s, dict) or not isinstance(s.get("id"), str) or not isinstance(s.get("skill"), str) or s.get("status") not in ("done", "pending", "failed") for s in steps):
        raise ValueError("steps require id, skill and status (done/pending/failed)")
    if len({s["id"] for s in steps}) != len(steps): raise ValueError("duplicate step ids")
    step = next((s for s in steps if s["status"] != "done"), None)
    if step is None: return {"action": "complete"}
    out = {"step": step["id"], "skill": step["skill"], "mode": mode, "executes": False}
    if step.get("stop"): return {**out, "action": "ask", "reason": str(step["stop"])}
    nodes = {n["id"]: n for n in g["nodes"]}
    node = nodes.get(step["skill"], {})
    missing = unmet(step.get("needs", {}), g, root) + unmet(node.get("needs", {}), g, root)
    if node.get("ring") != "installed": missing.append("skills:" + step["skill"])
    if step["status"] != "failed":
        return {**out, "action": "blocked" if missing else "next", "unmet": missing}
    attempts = step.get("attempted", [])
    if not isinstance(attempts, list) or not all(isinstance(v, str) for v in attempts): raise ValueError("invalid attempted alternatives")
    # Routine needs are prerequisites shared by every implementation.
    if unmet(step.get("needs", {}), g, root): return {**out, "action": "blocked", "unmet": missing}
    choices = alternatives(g, step["skill"], root, unit, [step["skill"], *attempts])
    if not choices: return {**out, "action": "detour", "reason": "no untried eligible explicit alternative", "unmet": missing}
    choice = choices[0]
    value = measured(choice, unit)
    free = measured(choice, "usd") == 0 and measured(choice, "tokens") == 0 and choice.get("network") is False
    within = value is not None and type(remaining) in (int, float) and math.isfinite(remaining) and 0 <= value <= remaining
    automatic = (mode == "balanced" and free) or (mode == "swarm" and within)
    return {**out, "action": "reroute" if automatic else "ask", "alternative": choice["id"],
            "cost": choice.get("cost"), "reason": "eligible measured alternative; envelope check still required" if automatic else "mode or missing cost/budget evidence requires owner decision"}


def route(g, intent, limit=8, unit="usd"):
    words = [w for w in re.findall(r"[a-z0-9]+", intent.lower()) if w not in STOP and len(w) > 2]
    ranked = sorted(((score(n, words), n) for n in g["nodes"] if n["ring"] != "missing"), key=lambda t: (-t[0], *cost_key(t[1], unit), t[1]["ring"] != "installed", t[1]["id"]))
    return [(s, n) for s, n in ranked if s > 0][:limit]


def append_proposal(data, rec):
    with open(f"{data}/proposals.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def set_status(data, n, status):
    props = load_proposals(data)
    hit = next((p for p in props if p["n"] == n), None)
    if hit is None:
        sys.exit(f"no proposal {n}")
    hit["status"] = status
    with open(f"{data}/proposals.jsonl", "w", encoding="utf-8") as f:
        f.writelines(json.dumps(p, ensure_ascii=False) + "\n" for p in props)
    return hit


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.dirname(SKILL_DIR))), help="OmniHarness checkout")
    ap.add_argument("--data", default=SKILL_DIR, help="dir holding skills-graph.toml, proposals.jsonl, remote.json")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="scan the rings, merge curated edges, write graph.json and graph.md")
    b.add_argument("--out", default=None, help="output dir (default <root>/docs/skills-graph)")
    sub.add_parser("check", help="validate curated edges and proposals against the rings; exit 1 on a bad edge type")
    nb = sub.add_parser("neighbors", help="edges in and out of one node"); nb.add_argument("id")
    rt = sub.add_parser("route", help="rank nodes for an intent by keyword overlap (zero tokens)"); rt.add_argument("intent"); rt.add_argument("--limit", type=int, default=8)
    rt.add_argument("--unit", choices=("usd", "tokens"), default="usd")
    alt = sub.add_parser("alternatives", help="eligible explicit alternatives; no execution")
    alt.add_argument("id")
    alt.add_argument("--unit", choices=("usd", "tokens"), default="usd")
    status = sub.add_parser("plan-status", help="read one omniharness-plan JSON fence from PLAN.md")
    status.add_argument("plan")
    status.add_argument("--mode", choices=("strict", "balanced", "swarm"), default="strict")
    status.add_argument("--unit", choices=("usd", "tokens"), default="usd")
    status.add_argument("--remaining", type=float)
    pr = sub.add_parser("propose", help="queue a learned edge for the owner")
    for a in ("from_", "type", "to"):
        pr.add_argument(a)
    pr.add_argument("--evidence", required=True, help="PLAN.md path, session date, what worked")
    for name in ("approve", "reject"):
        sub.add_parser(name).add_argument("n", type=int)
    a = ap.parse_args(argv)
    home, root = a.home.replace("\\", "/").rstrip("/"), os.path.realpath(a.root).replace("\\", "/")
    g = build(home, root, a.data)
    if a.cmd == "build":
        out = a.out or f"{root}/docs/skills-graph"
        os.makedirs(out, exist_ok=True)
        with open(f"{out}/graph.json", "w", encoding="utf-8") as f:
            json.dump(g, f, indent=1, ensure_ascii=False)
        with open(f"{out}/graph.md", "w", encoding="utf-8") as f:
            f.write(mermaid(g))
        print(f"rings: {g['rings']}; edges: {len(g['edges'])}; warnings: {len(g['warnings'])}; wrote {out}/graph.json and graph.md")
        for w in g["warnings"]:
            print("  warning:", w)
    elif a.cmd == "check":
        bad = [w for w in g["warnings"] if w.startswith("unknown edge type")]
        for w in g["warnings"]:
            print(("ERROR " if w in bad else "warn  ") + w)
        queue = [p for p in load_proposals(a.data) if p.get("status") == "proposed"]
        for p in queue:
            print(f"proposed {p['n']}: {p['from']} -{p['type']}-> {p['to']} ({p['evidence']})")
        print(f"{len(g['nodes'])} nodes, {len(g['edges'])} edges, {len(queue)} proposals waiting, {len(bad)} errors")
        return 1 if bad else 0
    elif a.cmd == "neighbors":
        for e in g["edges"]:
            if a.id in (e["from"], e["to"]):
                print(f"{e['from']} -{e['type']}-> {e['to']}  [{e['source']}]")
    elif a.cmd == "route":
        for s, n in route(g, a.intent, a.limit, a.unit):
            print(f"{s:2d}  {n['ring']:9s} {n['id']:32s} {n.get('description', '')[:90]}")
    elif a.cmd == "alternatives":
        print(json.dumps(alternatives(g, a.id, root, a.unit), ensure_ascii=False))
    elif a.cmd == "plan-status":
        fences = re.findall(r"```omniharness-plan\s*\n(.*?)\n```", read(a.plan), re.S)
        if len(fences) != 1: raise ValueError("PLAN.md needs exactly one omniharness-plan JSON fence")
        print(json.dumps(plan_status(g, json.loads(fences[0]), root, a.mode, a.unit, a.remaining), ensure_ascii=False))
    elif a.cmd == "propose":
        if a.type not in EDGE_TYPES:
            sys.exit(f"type must be one of {EDGE_TYPES}")
        rec = {"n": len(load_proposals(a.data)) + 1, "from": a.from_, "type": a.type, "to": a.to, "evidence": a.evidence,
               "date": date.today().isoformat(), "status": "proposed"}
        append_proposal(a.data, rec)
        print(f"proposal {rec['n']} queued; the owner approves with: skills_graph.py approve {rec['n']}")
    elif a.cmd == "approve":
        p = set_status(a.data, a.n, "approved")
        with open(f"{a.data}/skills-graph.toml", "a", encoding="utf-8") as f:
            f.write(f"\n[[edge]]  # approved {date.today().isoformat()} from proposal {p['n']}\nfrom = {json.dumps(p['from'])}\n"
                    f"type = {json.dumps(p['type'])}\nto = {json.dumps(p['to'])}\nwhy = {json.dumps(p['evidence'])}\n")
        print(f"proposal {p['n']} approved and written to skills-graph.toml")
    elif a.cmd == "reject":
        set_status(a.data, a.n, "rejected")
        print(f"proposal {a.n} rejected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
