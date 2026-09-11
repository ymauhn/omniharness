"""shoot.py: Playwright captures and measurements of the portal, zero tokens.

python tests/visual/shoot.py [--src site/public/index.html] [--out site/showcase/v3/shots] [--tag v2]
For each viewport (1440x1000 desktop, 390x844 mobile) and colour scheme (light, dark): a full-page JPEG, the console
errors, horizontal overflow, the contrast ratio of body text against the page ground, and whether the graph canvas has
drawn pixels. Writes <out>/<tag>-<width>-<scheme>.jpg and <out>/<tag>-report.json (the provenance of every capture:
source file, git commit, viewport, scheme, timestamp). Needs the installed python-playwright with chromium.
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
  const cv = document.getElementById('graph');
  let inked = null;
  if (cv && cv.width) { const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4*37) if (d[i] > 0) n++; inked = n; }
  return { contrast: Math.round(contrast*100)/100, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
           inked, height: document.documentElement.scrollHeight, title: document.title };
}"""


def shoot(src, out, tag):
    from playwright.sync_api import sync_playwright
    os.makedirs(out, exist_ok=True)
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip()
    report = {"source": src, "commit": commit, "captured": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "captures": []}
    url = "file:///" + os.path.abspath(src).replace("\\", "/")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, h in VIEWPORTS:
            for scheme in SCHEMES:
                ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=1)
                page = ctx.new_page()
                errors = []
                page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(url)
                page.wait_for_timeout(1800)  # fonts and the checklist tick-in settle
                m = page.evaluate(MEASURE)
                name = f"{tag}-{w}-{scheme}.jpg"
                page.screenshot(path=os.path.join(out, name), full_page=True, type="jpeg", quality=65)
                report["captures"].append({"file": name, "viewport": [w, h], "scheme": scheme, "errors": errors, **m})
                ctx.close()
        browser.close()
    with open(os.path.join(out, f"{tag}-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default=ROOT + "/site/public/index.html")
    ap.add_argument("--out", default=ROOT + "/site/showcase/v3/shots")
    ap.add_argument("--tag", default="v2")
    a = ap.parse_args(argv)
    r = shoot(a.src, a.out, a.tag)
    for c in r["captures"]:
        print(f"{c['file']:28s} contrast {c['contrast']:5.2f}  overflow {c['overflow']:3d}px  inked {c['inked']}  height {c['height']}  errors {len(c['errors'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
