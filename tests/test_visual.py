"""Visual TDD for the portal (zero tokens): Playwright renders site/public/index.html at two viewports and two colour
schemes; the assertions are measurements, not opinions (the owner's Q6 set, plan gate of 2026-09-11): no console errors,
no horizontal overflow, body contrast at least 4.5:1 in both themes, the graph canvas has drawn pixels, the rendered node
count equals the embedded graph data, a node tooltip appears within 300 ms, a click opens the drawer and closing it returns
focus to the track that opened it, the library filter responds, the copy button confirms only a write the clipboard took
and selects the command when the write is rejected, the theme toggle stamps the explicit choice with the contrast kept, the language switch
translates every slot without overflow and survives a reload. Missing dependencies are errors, never skipped coverage. The captures it leaves are the frames the
showcase compares across versions."""
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
sys.path.insert(0, ROOT + "/tests/visual")

class Visual(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import shoot
        src = ROOT + "/site/public/index.html"
        if not os.path.isfile(src):
            raise FileNotFoundError("site/public/index.html not built (python scripts/site_build.py)")
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
        self.assertEqual(s.get("stage_scroll"), 0, f"the stage scrolled sideways by {s.get('stage_scroll')}px after the drawer")
        self.assertTrue(s.get("filter_count") and s["filter_count"] < 20, f"library filter did not narrow the rows ({s.get('filter_count')})")
        self.assertEqual((s.get("copy_label") or "").strip().lower(), "copied", f"copy button did not confirm ({s.get('copy_label')!r})")
        self.assertEqual(s.get("copy_clip"), s.get("copy_text"), "the clipboard does not hold the command the button confirmed")
        self.assertEqual(s.get("copy_fail_label"), "not copied · text selected", f"a rejected clipboard write was reported as {s.get('copy_fail_label')!r}")
        self.assertEqual(s.get("copy_fail_selection"), s.get("copy_text"), "a rejected copy did not select the full command for a manual copy")
        self.assertEqual(s.get("drawer_focus_in"), "drawer-close", f"opening a track from the list moved focus to {s.get('drawer_focus_in')!r}")
        self.assertTrue(s.get("drawer_focus_escape"), "Escape did not return focus to the track that opened the drawer")
        self.assertTrue(s.get("drawer_focus_close"), "the close button did not return focus to the track that opened the drawer")
        self.assertEqual(s.get("theme_after"), "dark", f"theme toggle did not stamp the explicit choice ({s.get('theme_after')!r})")
        self.assertTrue(s.get("theme_changed"), "theme toggle did not change the ground")
        self.assertGreaterEqual(s.get("theme_contrast") or 0, 4.5, f"contrast after the toggle {s.get('theme_contrast')}")
        self.assertLessEqual(s.get("theme_overflow") or 0, 0, f"overflow after the toggle {s.get('theme_overflow')}px")
        self.assertTrue(s.get("theme_images"), "the captures did not follow the toggled theme")
        self.assertEqual(s.get("lang_after"), "pt-BR", f"language switch did not set <html lang> ({s.get('lang_after')!r})")
        self.assertNotEqual(s.get("lang_h1"), s.get("lang_h1_en"), "the headline did not change language")
        self.assertGreater(s.get("lang_slots") or 0, 200, f"too few translated slots ({s.get('lang_slots')})")
        self.assertEqual(s.get("lang_untranslated"), 0, f"{s.get('lang_untranslated')} slots kept their English after the switch")
        self.assertLessEqual(s.get("lang_overflow") or 0, 0, f"Portuguese overflows by {s.get('lang_overflow')}px")
        self.assertIn("anel", s.get("lang_drawer") or "", "the drawer did not follow the language")
        self.assertEqual(s.get("lang_persisted"), "pt-BR", "the language choice did not survive a reload")


if __name__ == "__main__":
    unittest.main()
