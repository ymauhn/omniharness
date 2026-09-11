"""shoot.py: Playwright captures and measurements of the portal, zero tokens.

python tests/visual/shoot.py [--src site/public/index.html] [--out site/showcase/v3/shots] [--tag v3] [--states]
For each viewport (1440x1000 desktop, 390x844 mobile) and colour scheme (light, dark): a full-page JPEG, the console
errors, horizontal overflow, the contrast ratio of body text against the page ground, and whether the graph canvas has
drawn pixels. With --states, three viewport captures at 1440 light: a graph node under the pointer (tooltip timed), the
"Tutorial" library filter pressed, the first copy button pressed; plus the drawer on click and the rendered node count,
read through the page's `window.__portal` hook ({nodePos(i), count(), data()}), which v3 exposes for this test.
Writes <out>/<tag>-<width>-<scheme>.jpg, the state captures, and <out>/<tag>-report.json (provenance: source, commit,
viewport, scheme, timestamp). Needs the installed python-playwright with chromium.
"""
import argparse
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))).replace("\\", "/")
VIEWPORTS = ((1440, 1000), (390, 844))
SCHEMES = ("light", "dark")

MEASURE = """() => {
  const lum = (c) => { const [r,g,b] = c.match(/\\d+(\\.\\d+)?/g).slice(0,3).map(Number).map(v => { v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4) }); return .2126*r+.7152*g+.0722*b };
  const cs = getComputedStyle(document.body);
  const l1 = lum(cs.color), l2 = lum(cs.backgroundColor);
  const contrast = (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
  const cv = document.querySelector('#graph canvas') || document.getElementById('graph');
  let inked = null;
  if (cv && cv.width && cv.getContext) { const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; inked = n; }
  const hook = window.__portal;
  return { contrast: Math.round(contrast*100)/100, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
           inked, height: document.documentElement.scrollHeight, title: document.title,
           nodes_rendered: hook ? hook.count() : null, nodes_data: hook ? hook.data().nodes.length : null };
}"""


def states(page, out, tag):
    """Interaction captures at the current viewport; returns measurements. Needs window.__portal (v3)."""
    r = {}
    pos = page.evaluate("() => window.__portal ? window.__portal.nodePos(0) : null")
    if pos:
        page.evaluate("() => document.getElementById('graph').scrollIntoView({block: 'center'})")
        page.wait_for_timeout(600)
        pos = page.evaluate("() => window.__portal.nodePos(0)")
        t0 = time.perf_counter()
        page.mouse.move(pos["x"], pos["y"])
        try:
            page.wait_for_selector("#tip", state="visible", timeout=1500)
            r["tooltip_ms"] = round((time.perf_counter() - t0) * 1000)
        except Exception:
            r["tooltip_ms"] = None
        page.screenshot(path=os.path.join(out, f"{tag}-state-hover.jpg"), type="jpeg", quality=65)
        page.mouse.click(pos["x"], pos["y"])
        try:
            page.wait_for_selector(".drawer.open, .drawer[open]", state="visible", timeout=1500)
            r["drawer"] = True
        except Exception:
            r["drawer"] = False
        page.screenshot(path=os.path.join(out, f"{tag}-state-drawer.jpg"), type="jpeg", quality=65)
        page.keyboard.press("Escape")
    else:
        r["tooltip_ms"] = None; r["drawer"] = False
    btn = page.query_selector('.fbtn[data-kind="tutorial"]')
    if btn:
        btn.scroll_into_view_if_needed(); btn.click(); page.wait_for_timeout(300)
        r["filter_count"] = page.evaluate("() => document.querySelectorAll('#rows > li:not([hidden])').length")
        page.screenshot(path=os.path.join(out, f"{tag}-state-filter.jpg"), type="jpeg", quality=65)
        page.query_selector('.fbtn[data-kind="all"]').click()
    copy = page.query_selector(".copy")
    if copy:
        copy.scroll_into_view_if_needed(); copy.click(); page.wait_for_timeout(200)
        r["copy_label"] = copy.evaluate("el => el.textContent")
        page.screenshot(path=os.path.join(out, f"{tag}-state-copy.jpg"), type="jpeg", quality=65)
    return r


def shoot(src, out, tag, with_states=False):
    from playwright.sync_api import sync_playwright
    os.makedirs(out, exist_ok=True)
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip()
    report = {"source": src, "commit": commit, "captured": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "captures": [], "states": None}
    url = "file:///" + os.path.abspath(src).replace("\\", "/")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, h in VIEWPORTS:
            for scheme in SCHEMES:
                ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=1)
                ctx.grant_permissions(["clipboard-read", "clipboard-write"])
                page = ctx.new_page()
                errors = []
                page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(url)
                page.wait_for_timeout(4600)  # fonts, the graph physics (3.2 s) and the fit tween (0.7 s) settle
                page.evaluate("async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } window.scrollTo(0, 0); }")
                page.wait_for_timeout(800)
                m = page.evaluate(MEASURE)
                name = f"{tag}-{w}-{scheme}.jpg"
                page.screenshot(path=os.path.join(out, name), full_page=True, type="jpeg", quality=65)
                report["captures"].append({"file": name, "viewport": [w, h], "scheme": scheme, "errors": errors, **m})
                if with_states and w == 1440 and scheme == "light":
                    report["states"] = states(page, out, tag)
                    report["states"]["errors_after"] = list(errors)
                ctx.close()
        browser.close()
    with open(os.path.join(out, f"{tag}-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default=ROOT + "/site/public/index.html")
    ap.add_argument("--out", default=ROOT + "/site/showcase/v3/shots")
    ap.add_argument("--tag", default="v3")
    ap.add_argument("--states", action="store_true")
    a = ap.parse_args(argv)
    r = shoot(a.src, a.out, a.tag, a.states)
    for c in r["captures"]:
        print(f"{c['file']:26s} contrast {c['contrast']:5.2f}  overflow {c['overflow']:4d}px  inked {c['inked']}  nodes {c['nodes_rendered']}/{c['nodes_data']}  height {c['height']}  errors {len(c['errors'])}")
    if r["states"]:
        print("states:", json.dumps(r["states"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
