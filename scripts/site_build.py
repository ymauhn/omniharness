"""site_build.py: one source, two editions of the community portal.

Reads site/index.html and injects: the skills graph (docs/skills-graph/graph.json, installed ring plus every linked node),
the member guides (SKILL.md bodies and the portal plan, as escaped markdown inside <template data-members>), and the showcase
metrics (site/showcase/06-metrics.json into data-metric elements). Writes site/public/index.html (public edition: member
templates removed, data-edition="public") and, with --artifact <path>, the members edition as an artifact fragment (no
doctype/html/head/body wrappers). --report prints the weight of each edition. Stdlib only; the source keeps its placeholders.
"""
import argparse
import html
import json
import os
import re
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
SRC = ROOT + "/site/index.html"
GUIDES = {"omniharness": ".agents/skills/omniharness/SKILL.md", "skills-graph": ".agents/skills/skills-graph/SKILL.md",
          "scout": ".agents/skills/scout/SKILL.md", "detour": ".agents/skills/detour/SKILL.md",
          "skill-installer": ".agents/skills/skill-installer/SKILL.md", "plan-example": "docs/scout/portal-v2/PLAN.md"}
GITHUB = "https://github.com/ymauhn/omniharness/blob/master/"
PLUGIN_URL = {"mattpocock-skills": "https://github.com/mattpocock/skills", "ponytail": "https://github.com/ponytail-dev/ponytail"}


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def href(n):
    for p in n.get("paths", []):
        if p.startswith(ROOT + "/"):
            return GITHUB + p[len(ROOT) + 1:]
    for h in n.get("hosts", []):
        if h.startswith("plugin:") and h[7:] in PLUGIN_URL:
            return PLUGIN_URL[h[7:]]
    return n.get("url", "")


def graph_payload(graph):
    linked = {e["from"] for e in graph["edges"]} | {e["to"] for e in graph["edges"]}
    nodes = [n for n in graph["nodes"] if n["ring"] == "installed" or n["id"] in linked]
    ids = {n["id"] for n in nodes}
    def group(n):
        hosts = n.get("hosts", [])
        plug = next((h[7:] for h in hosts if h.startswith("plugin:")), None)
        return plug or ("repo" if "repo" in hosts else (hosts[0] if hosts else n["ring"]))
    return {"generated": graph["generated"],
            "nodes": [{"id": n["id"], "ring": n["ring"], "group": group(n), "d": (n.get("description") or "")[:140], "href": href(n)} for n in nodes],
            "edges": [{"s": e["from"], "t": e["to"], "type": e["type"]} for e in graph["edges"] if e["from"] in ids and e["to"] in ids]}


def strip_frontmatter(md):
    return re.sub(r"\A---\n.*?\n---\n", "", md, count=1, flags=re.S)


def build(src, graph, guides, metrics):
    out = re.sub(r'(<script id="graph-data" type="application/json">).*?(</script>)',
                 lambda m: m.group(1) + json.dumps(graph, ensure_ascii=False, separators=(",", ":")) + m.group(2), src, count=1, flags=re.S)
    for key, text in guides.items():
        out, n = re.subn(rf'(<template data-members data-guide="{key}">).*?(</template>)',
                         lambda m: m.group(1) + html.escape(strip_frontmatter(text)) + m.group(2), out, count=1, flags=re.S)
        if not n:
            print(f"warning: no <template data-guide=\"{key}\"> in the source", file=sys.stderr)
    for key, val in metrics.items():
        out = re.sub(rf'(<[a-z]+[^>]*data-metric="{re.escape(key)}"[^>]*>).*?(</[a-z]+>)', lambda m: m.group(1) + html.escape(str(val)) + m.group(2), out, flags=re.S)  # every element that carries the key
    return out


def edition(built, kind):
    out = built.replace('<html lang="en">', f'<html lang="en" data-edition="{kind}">', 1)
    if kind == "public":
        out = re.sub(r"<template data-members[^>]*>.*?</template>\s*", "", out, flags=re.S)
    return out


def fragment(doc):
    head = re.search(r"<head>(.*?)</head>", doc, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", doc, re.S).group(1)
    keep = [ln for ln in head.split("\n") if not ln.strip().startswith("<meta")]
    return "\n".join(keep).strip() + "\n" + body


def weight(doc):
    return len(doc.encode("utf-8")), len(zlib.compress(doc.encode("utf-8"), 9)), doc.count("<link rel=\"stylesheet\"") + doc.count("<script src=")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--artifact", help="write the members edition as an artifact fragment to this path")
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args(argv)
    src = read(SRC)
    graph = graph_payload(json.load(open(ROOT + "/docs/skills-graph/graph.json", encoding="utf-8")))
    guides = {k: read(f"{ROOT}/{p}") for k, p in GUIDES.items() if os.path.isfile(f"{ROOT}/{p}")}
    mpath = ROOT + "/site/showcase/06-metrics.json"
    metrics = json.load(open(mpath, encoding="utf-8")) if os.path.isfile(mpath) else {}
    built = build(src, graph, guides, metrics)
    os.makedirs(ROOT + "/site/public", exist_ok=True)
    pub = edition(built, "public")
    with open(ROOT + "/site/public/index.html", "w", encoding="utf-8", newline="\n") as f:
        f.write(pub)
    members = edition(built, "members")
    if a.artifact:
        with open(a.artifact, "w", encoding="utf-8", newline="\n") as f:
            f.write(fragment(members))
    print(f"graph: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges; guides: {', '.join(guides)}; metrics: {len(metrics)} keys")
    if a.report:
        for name, doc in (("public", pub), ("members", members)):
            b, z, req = weight(doc)
            print(f"{name:8s} {b/1024:7.1f} KB raw, {z/1024:6.1f} KB deflated, {req} external requests declared (fonts CSS + scripts)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
