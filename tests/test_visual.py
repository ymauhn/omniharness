"""Visual TDD for the portal (zero tokens): Playwright renders site/public/index.html at two viewports and two colour
schemes and the assertions are measurements, not opinions: no console errors, no horizontal overflow, body contrast at
least 4.5:1 in both themes, the graph canvas has drawn pixels. Skipped when python-playwright is not installed.
The captures it leaves in site/showcase/v3/shots/ are the frames the showcase compares across versions."""
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
        cls.report = shoot.shoot(src, cls.tmp, "test")

    def test_measurements(self):
        for c in self.report["captures"]:
            with self.subTest(capture=c["file"]):
                self.assertEqual(c["errors"], [], f"{c['file']}: console errors {c['errors']}")
                self.assertLessEqual(c["overflow"], 0, f"{c['file']}: horizontal overflow {c['overflow']}px")
                self.assertGreaterEqual(c["contrast"], 4.5, f"{c['file']}: body contrast {c['contrast']}")
                self.assertTrue(c["inked"] and c["inked"] > 50, f"{c['file']}: graph canvas looks empty ({c['inked']} sampled inked pixels)")
                self.assertGreater(c["height"], 3000, f"{c['file']}: page unexpectedly short ({c['height']}px)")


if __name__ == "__main__":
    unittest.main()
