"""Zero-token tests for .agents/skills/skills-graph/scripts/skills_graph.py: a synthetic home + root, then the real repo."""
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents" / "skills" / "skills-graph" / "scripts" / "skills_graph.py"
spec = importlib.util.spec_from_file_location("skills_graph", SCRIPT)
sg = importlib.util.module_from_spec(spec); spec.loader.exec_module(sg)


def skill(dir_, name, body):
    dir_.mkdir(parents=True)
    (dir_ / "SKILL.md").write_text(f"---\nname: {name}\ndescription: >\n  {name} does {name} things.\nlicense: MIT\n---\n\n{body}\n", encoding="utf-8")


class Synthetic(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sg-"))
        self.home, self.root, self.data = self.tmp / "home", self.tmp / "root", self.tmp / "data"
        skill(self.root / ".agents" / "skills" / "alpha", "alpha", 'Then call the Skill tool with "beta". Run /gamma when done. Not /nothere.')
        skill(self.home / ".claude" / "skills" / "beta", "beta", "Standalone. Mentions /beta itself only.")
        skill(self.home / ".claude" / "skills" / "gamma", "gamma", "Call the Skill tool twice, for \"alpha\" and \"beta\".")
        mp = self.home / sg.MARKET
        mp.parent.mkdir(parents=True)
        mp.write_text(json.dumps({"plugins": [{"name": "frontend-design", "category": "design", "description": "Design frontends", "source": "./plugins/frontend-design"},
                                              {"name": "delta", "category": "development", "description": "x", "source": {"url": "https://example.invalid/delta"}}]}), encoding="utf-8")
        cat = self.root / "docs" / "catalog"; cat.mkdir(parents=True)
        (cat / "community-skills.md").write_text("# C\n\n## Design\n\n| Skill or collection | Layer | URL | Notes |\n|---|---|---|---|\n"
                                                "| pbakaus/impeccable | execution | https://github.com/pbakaus/impeccable | design harness |\n", encoding="utf-8")
        self.data.mkdir()
        (self.data / "skills-graph.toml").write_text(
            '[remote]\nsources = ["https://example.invalid/list"]\n\n[[node]]\nid = "impeccable"\nring = "catalog"\nurl = "https://github.com/pbakaus/impeccable"\n'
            'description = "design language harness"\n\n[[edge]]\nfrom = "frontend-design"\ntype = "alternative-to"\nto = "impeccable"\n\n'
            '[[edge]]\nfrom = "alpha"\ntype = "precedes"\nto = "ghost"\n', encoding="utf-8")
        (self.data / "remote.json").write_text(json.dumps({"fetched": "2026-09-10", "entries": [{"id": "owner/repo", "url": "https://github.com/owner/repo", "list": "l", "description": "remote thing"}]}), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_cli(self, *args):
        return sg.main(["--home", str(self.home), "--root", str(self.root), "--data", str(self.data), *args])

    def test_rings_edges_and_render(self):
        g = sg.build(str(self.home), str(self.root), str(self.data))
        by = {n["id"]: n for n in g["nodes"]}
        self.assertEqual(g["rings"], {"installed": 3, "catalog": 3, "remote": 1, "missing": 1})
        self.assertEqual(by["alpha"]["calls"], ["beta", "gamma"])       # quoted after "Skill tool" and /gamma; /nothere unresolved
        self.assertEqual(by["gamma"]["calls"], ["alpha", "beta"])       # "twice, for X and Y"
        self.assertEqual(by["beta"]["calls"], [])                        # self mention is not an edge
        self.assertEqual(by["alpha"]["description"], "alpha does alpha things.")  # folded scalar joined
        self.assertEqual(by["impeccable"]["source"], "docs/catalog/community-skills.md")  # curated id claimed the table row
        self.assertNotIn("pbakaus/impeccable", by)
        self.assertEqual(by["ghost"]["ring"], "missing")
        self.assertEqual(by["owner/repo"]["ring"], "remote")
        types = sorted((e["from"], e["type"], e["to"]) for e in g["edges"])
        self.assertEqual(types, [("alpha", "calls", "beta"), ("alpha", "calls", "gamma"), ("alpha", "precedes", "ghost"),
                                 ("frontend-design", "alternative-to", "impeccable"), ("gamma", "calls", "alpha"), ("gamma", "calls", "beta")])
        self.assertEqual(len(g["warnings"]), 1)
        md = sg.mermaid(g)
        self.assertIn("n_alpha -->|calls| n_beta", md)
        self.assertIn("n_frontend_design -.->|alternative-to| n_impeccable", md)
        self.assertNotIn("n_delta", md)                                  # unlinked catalog node stays out of the render
        self.assertIn('subgraph catalog["catalog: 2 of 3 linked"]', md)

    def test_route_and_cli(self):
        g = sg.build(str(self.home), str(self.root), str(self.data))
        self.assertEqual(sg.route(g, "design a frontend harness")[0][1]["id"], "frontend-design")
        self.assertEqual(sg.route(g, "beta things")[0][1]["id"], "beta")
        self.assertEqual(sg.route(g, "zzz"), [])
        self.assertEqual(self.run_cli("build", "--out", str(self.tmp / "out")), 0)
        self.assertTrue((self.tmp / "out" / "graph.json").is_file() and (self.tmp / "out" / "graph.md").is_file())
        self.assertEqual(self.run_cli("check"), 0)                       # a dangling endpoint warns, does not fail
        (self.data / "skills-graph.toml").open("a", encoding="utf-8").write('\n[[edge]]\nfrom = "alpha"\ntype = "bogus"\nto = "beta"\n')
        self.assertEqual(self.run_cli("check"), 1)

    def test_propose_approve_reject(self):
        self.assertEqual(self.run_cli("propose", "gamma", "feeds", "alpha", "--evidence", "PLAN.md 2026-09-10"), 0)
        self.assertEqual(self.run_cli("propose", "beta", "candidate-for", "owner/repo", "--evidence", "gap"), 0)
        g = sg.build(str(self.home), str(self.root), str(self.data))
        self.assertEqual([e["source"] for e in g["edges"] if e["source"].startswith("proposal")], ["proposal:1", "proposal:2"])
        self.assertEqual(self.run_cli("approve", "1"), 0)
        self.assertEqual(self.run_cli("reject", "2"), 0)
        toml = (self.data / "skills-graph.toml").read_text(encoding="utf-8")
        self.assertIn('from = "gamma"\ntype = "feeds"\nto = "alpha"', toml)
        g = sg.build(str(self.home), str(self.root), str(self.data))
        self.assertEqual([e["source"] for e in g["edges"] if e["from"] == "gamma" and e["type"] == "feeds"], ["curated"])
        self.assertFalse(any(e["type"] == "candidate-for" for e in g["edges"]))
        with self.assertRaises(SystemExit):
            self.run_cli("propose", "a", "bogus", "b", "--evidence", "x")


class RealRepo(unittest.TestCase):
    def test_build_reference_checkout(self):
        """The shipped TOML must resolve against the repo's own skills; edges to skills this machine lacks only warn."""
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(sg.main(["build", "--out", out]), 0)
            g = json.load(open(Path(out) / "graph.json", encoding="utf-8"))
        ids = {n["id"] for n in g["nodes"]}
        self.assertTrue({"skills-graph", "omniharness", "thesis-review", "impeccable", "magic-mcp"} <= ids)
        self.assertTrue(any(e["type"] == "guided-by" and e["from"] == "magic-mcp" for e in g["edges"]))
        self.assertFalse(any(w.startswith("unknown edge type") for w in g["warnings"]))


if __name__ == "__main__":
    unittest.main()
