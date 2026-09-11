"""Visual TDD for the portal (zero tokens): Playwright renders site/public/index.html at two viewports and two colour
schemes; the assertions are measurements, not opinions (the owner's Q6 set, plan gate of 2026-09-11): no console errors,
no horizontal overflow, body contrast at least 4.5:1 in both themes, the graph canvas has drawn pixels, the rendered node
count equals the embedded graph data, a node tooltip appears within 300 ms, a click opens the drawer, the library filter
and the copy button respond. Skipped when python-playwright is not installed. The captures it leaves are the frames the
showcase compares across versions."""
import importlib.util
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
sys.path.insert(0, ROOT + "/tests/visual")

HAS_PW = importlib.util.find_spec("playwright") is not None


@unittest.skipUnless(HAS_PW, "python-playwright not installed")
class Visual(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import shoot
        src = ROOT + "/site/public/index.html"
        if not os.path.isfile(src):
            raise unittest.SkipTest("site/public/index.html not built (python scripts/site_build.py)")
        cls.tmp = tempfile.mkdtemp(prefix="visual-")
        cls.report = shoot.shoot(src, cls.tmp, "test", with_states=True)

    def test_pages(self):
        for c in self.report["captures"]:
            with self.subTest(capture=c["file"]):
                self.assertEqual(c["errors"], [], f"{c['file']}: console errors {c['errors']}")
                self.assertLessEqual(c["overflow"], 0, f"{c['file']}: horizontal overflow {c['overflow']}px")
                self.assertGreaterEqual(c["contrast"], 4.5, f"{c['file']}: body contrast {c['contrast']}")
                self.assertTrue(c["inked"] and c["inked"] > 2000, f"{c['file']}: graph canvas looks empty ({c['inked']} inked pixels)")
                self.assertGreater(c["height"], 3000, f"{c['file']}: page unexpectedly short ({c['height']}px)")
                self.assertIsNotNone(c["nodes_data"], f"{c['file']}: window.__portal hook missing")
                self.assertEqual(c["nodes_rendered"], c["nodes_data"], f"{c['file']}: rendered nodes {c['nodes_rendered']} != data {c['nodes_data']}")

    def test_states(self):
        s = self.report["states"]
        self.assertIsNotNone(s, "state captures did not run")
        self.assertEqual(s.get("errors_after"), [], f"console errors during interaction: {s.get('errors_after')}")
        self.assertIsNotNone(s.get("tooltip_ms"), "no tooltip on node hover")
        self.assertLessEqual(s["tooltip_ms"], 300, f"tooltip took {s['tooltip_ms']} ms")
        self.assertTrue(s.get("drawer"), "node click did not open the drawer")
        self.assertTrue(s.get("filter_count") and s["filter_count"] < 20, f"library filter did not narrow the rows ({s.get('filter_count')})")
        self.assertEqual((s.get("copy_label") or "").strip().lower(), "copied", f"copy button did not confirm ({s.get('copy_label')!r})")


if __name__ == "__main__":
    unittest.main()
