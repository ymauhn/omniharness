"""Zero-token gates for thesis-review: facts, style, integrity, bib, score.

JSON on stdout. Exit 1 on any hit, 0 clean, 2 on usage error.
"""
import argparse
import csv
import difflib
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

SKIP_ENV = re.compile(r"\\begin\{(verbatim|lstlisting)\}.*?\\end\{\1\}", re.S)
SKIP_ARG = re.compile(r"\\(?:ref|eqref|pageref|autoref|label|cite\w*|includegraphics|input)\*?(?:\[[^\]]*\])?\{[^}]*\}")
COMMENT = re.compile(r"(?<!\\)%[^\n]*")
CHAPTER = re.compile(r"\\chapter\*?\{([^}]*)\}")
LABEL = re.compile(r"\\label\{([^}]*)\}")
REF = re.compile(r"\\(?:ref|eqref|pageref|autoref|cite\w*)\*?(?:\[[^\]]*\])?\{([^}]*)\}")
HEADING = re.compile(r"\\(?:chapter|section|subsection|subsubsection)\*?\{([^}]*)\}")
# decimal (point or comma fraction) or integer >= 1000 with optional thousands groups
NUMERAL = re.compile(r"(?<![\d.,])(?:\d+[.,]\d+|\d{1,3}(?:[.,]\d{3})+|\d{4,})(?![\d.,])")
THOUSANDS = re.compile(r"^[1-9]\d{0,2}(?:[.,]\d{3})+$")


def read(path):
    return Path(path).read_text(encoding="utf-8", errors="replace")


def blank(m):
    """Replace a match with spaces, keeping newlines so line numbers survive."""
    return re.sub(r"[^\n]", " ", m.group(0))


def clean(text):
    """Blank comments, verbatim/lstlisting bodies and the braces of \\ref-like commands."""
    text = COMMENT.sub(blank, text)
    text = SKIP_ENV.sub(blank, text)
    return SKIP_ARG.sub(blank, text)


def chapter_range(lines, sel):
    """(start, end) line indices of the selected chapter; whole file when there is no \\chapter."""
    starts = [i for i, l in enumerate(lines) if CHAPTER.search(l)]
    if not starts:
        return 0, len(lines)
    bounds = list(zip(starts, starts[1:] + [len(lines)]))
    if sel.isdigit():
        if not 1 <= int(sel) <= len(bounds):
            sys.exit(f"usage: chapter index {sel} out of range 1..{len(bounds)}")
        return bounds[int(sel) - 1]
    for s, e in bounds:
        m = LABEL.search("\n".join(lines[s:e]))
        if m and m.group(1) == sel:
            return s, e
    sys.exit(f"usage: no \\chapter with \\label{{{sel}}}")


# ---------------------------------------------------------------- facts

def csv_values(paths, precision, smin_precision, smin_columns, decimal):
    values = set()
    for p in paths:
        text = read(p)
        mode = decimal
        if mode == "auto":
            mode = "comma" if re.search(r"\d,\d", text) else "point"
        delim = ";" if ";" in text.splitlines()[0] else ","
        for row in csv.DictReader(text.splitlines(), delimiter=delim):
            for col, cell in row.items():
                cell = (cell or "").strip()
                if THOUSANDS.match(cell) and ("." in cell if mode == "comma" else "," in cell):
                    n = int(re.sub(r"[.,]", "", cell))
                    values.update({str(n), f"{n:,}"})
                    continue
                if mode == "comma":
                    cell = cell.replace(".", "").replace(",", ".")
                elif "," in cell:
                    continue
                try:
                    v = float(cell)
                except ValueError:
                    continue
                if re.fullmatch(r"-?\d+", cell):
                    values.update({cell, f"{int(cell):,}"})
                else:
                    p_ = smin_precision if (col or "").strip() in smin_columns else precision
                    values.add(f"{v:.{p_}f}")
    return values


def cmd_facts(a):
    values = csv_values(a.csv, a.precision, a.smin_precision, set(a.smin_columns), a.decimal)
    numerals = NUMERAL.findall(clean(read(a.tex)))
    unmatched = sorted({n for n in numerals if n not in values and n.replace(",", ".") not in values})
    return {"unmatched": unmatched, "checked": len(numerals), "csv_values": len(values)}, bool(unmatched)


# ---------------------------------------------------------------- style

def cmd_style(a):
    lines = clean(read(a.tex)).splitlines()
    dash = [i + 1 for i, l in enumerate(lines) if "—" in l or "---" in l or " -- " in l]
    comma = [n for n in NUMERAL.findall("\n".join(lines)) if "," in n and not THOUSANDS.match(n)]
    raw = read(a.tex).splitlines()
    s, e = chapter_range(raw, a.chapter) if a.chapter else (0, len(raw))
    labels = [k for k in LABEL.findall("\n".join(raw[s:e]))  # raw: clean() blanks \label braces
              if k.split(":")[0] in ("sec", "tab", "fig") and not k.split(":", 1)[-1].startswith(a.prefix)]
    out = {"dash": dash, "decimal_comma": comma, "labels": labels}
    return out, any(out.values())


# ---------------------------------------------------------------- integrity

def paragraphs(lines):
    """[(section title, k, text)] for blank-line separated blocks; a heading block resets k to 0."""
    out, title, k, buf = [], "", 0, []

    def flush():
        nonlocal title, k
        if not buf:
            return
        text = " ".join(buf)
        m = HEADING.search(text)
        if m:
            title, k = m.group(1), 0
        else:
            k += 1
        out.append((title, k, text))
        buf.clear()

    for l in lines:
        if l.strip():
            buf.append(l.strip())
        else:
            flush()
    flush()
    return out


def word_diff(a, b):
    wa, wb = a.split(), b.split()
    ops = [o for o in difflib.SequenceMatcher(None, wa, wb, autojunk=False).get_opcodes() if o[0] != "equal"]
    before = " … ".join(" ".join(wa[i1:i2]) for _, i1, i2, _, _ in ops if i2 > i1)
    after = " … ".join(" ".join(wb[j1:j2]) for _, _, _, j1, j2 in ops if j2 > j1)
    return before, after


def cmd_integrity(a):
    A, B = read(a.orig).splitlines(), read(a.new).splitlines()
    sa, ea = chapter_range(A, a.chapter)
    sb, eb = chapter_range(B, a.chapter)
    outside = []
    for oa, ob, x, y in ((0, 0, A[:sa], B[:sb]), (ea, eb, A[ea:], B[eb:])):
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, x, y, autojunk=False).get_opcodes():
            if op != "equal":
                outside.append({"orig_lines": [oa + i1 + 1, oa + i2], "new_lines": [ob + j1 + 1, ob + j2],
                                "before": "\n".join(x[i1:i2]), "after": "\n".join(y[j1:j2])})
    if outside:
        return {"outside": outside}, True

    pa, pb = paragraphs(A[sa:ea]), paragraphs(B[sb:eb])
    blocks = []
    sm = difflib.SequenceMatcher(None, [p[2] for p in pa], [p[2] for p in pb], autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            continue
        old, new = pa[i1:i2], pb[j1:j2]
        for i in range(max(len(old), len(new))):
            o = old[i] if i < len(old) else None
            n = new[i] if i < len(new) else None
            title, k = (o or n)[0], (o or n)[1]
            before, after = word_diff(o[2] if o else "", n[2] if n else "")
            blocks.append(f"{len(blocks) + 1}. {title}, paragraph {k}\nBEFORE: {before}\nAFTER: {after}")

    labels_b = set(LABEL.findall("\n".join(B)))
    missing = sorted(set(LABEL.findall("\n".join(A[sa:ea]))) - labels_b)
    keys = lambda t: {k.strip() for m in REF.findall(t) for k in m.split(",")}
    dangling = sorted(keys("\n".join(B)) - labels_b - keys("\n".join(A)))
    out = {"outside": [], "blocks": blocks, "missing_labels": missing, "dangling_refs": dangling}
    if missing or dangling:
        return out, True
    Path(a.out).write_text("# REGISTRO DE ALTERACOES\n\n" + ("\n\n".join(blocks) or "No changes.") + "\n",
                           encoding="utf-8")
    out["changelog"] = a.out
    return out, False


# ---------------------------------------------------------------- bib

def bib_field(entry, name):
    m = re.search(r"\b" + name + r"\s*=\s*\{", entry, re.I)
    if not m:
        return ""
    depth, i = 1, m.end()
    while i < len(entry) and depth:
        depth += {"{": 1, "}": -1}.get(entry[i], 0)
        i += 1
    return entry[m.end():i - 1]


def cmd_bib(a):
    text = read(a.bib)
    out = {"and_others": text.count("and others"), "blg": [], "entries": text.count("@")}
    if a.blg:
        out["blg"] = [l.strip() for l in read(a.blg).splitlines() if re.search(r"Warning|Error", l)]
    hit = out["and_others"] > 0 or bool(out["blg"])
    if a.online:
        import urllib.request
        from urllib.parse import quote
        out["doi"] = []
        for entry in re.split(r"(?=^@)", text, flags=re.M)[1:]:
            doi = bib_field(entry, "doi").strip()
            if not doi:
                continue
            key = re.match(r"@\w+\{([^,]*)", entry).group(1)
            bib_n = len(re.split(r"\s+and\s+", bib_field(entry, "author").strip()))
            try:
                with urllib.request.urlopen("https://api.crossref.org/works/" + quote(doi), timeout=20) as r:
                    cr_n = len(json.load(r)["message"].get("author", []))
            except Exception as e:  # network or shape error: report, do not guess
                out["doi"].append({"key": key, "doi": doi, "error": str(e)})
                continue
            out["doi"].append({"key": key, "doi": doi, "bib_authors": bib_n, "crossref_authors": cr_n})
            hit |= bib_n != cr_n
    return out, hit


# ---------------------------------------------------------------- score

def cmd_score(a):
    try:
        df, ca, at, pc = (float(x) for x in a.scores.split(","))
    except ValueError:
        sys.exit("usage: --scores df,ca,at,pc")
    if a.facts_unmatched > 0:
        df = min(df, 59)
    comp = round(0.30 * df + 0.30 * ca + 0.20 * at + 0.20 * pc, 2)
    return {"df": df, "ca": ca, "at": at, "pc": pc, "composite": comp}, False


# ---------------------------------------------------------------- main

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("facts")
    f.add_argument("--csv", nargs="+", required=True)
    f.add_argument("--tex", required=True)
    f.add_argument("--precision", type=int, default=4)
    f.add_argument("--smin-precision", type=int, default=2)
    f.add_argument("--smin-columns", nargs="*", default=["smin"])
    f.add_argument("--decimal", choices=["auto", "comma", "point"], default="auto")
    f.set_defaults(fn=cmd_facts)
    s = sub.add_parser("style")
    s.add_argument("--tex", required=True)
    s.add_argument("--chapter")
    s.add_argument("--prefix", default="res_")
    s.set_defaults(fn=cmd_style)
    i = sub.add_parser("integrity")
    i.add_argument("--orig", required=True)
    i.add_argument("--new", required=True)
    i.add_argument("--chapter", required=True)
    i.add_argument("--out", default="REGISTRO_ALTERACOES.md")
    i.set_defaults(fn=cmd_integrity)
    b = sub.add_parser("bib")
    b.add_argument("--bib", required=True)
    b.add_argument("--blg")
    b.add_argument("--online", action="store_true")
    b.set_defaults(fn=cmd_bib)
    sc = sub.add_parser("score")
    sc.add_argument("--scores", required=True)
    sc.add_argument("--facts-unmatched", type=int, default=0)
    sc.set_defaults(fn=cmd_score)
    try:
        a = p.parse_args(argv)
    except SystemExit as e:  # argparse exits 0 for --help and 2 for usage errors; keep both
        raise SystemExit(0 if e.code == 0 else 2)
    try:
        out, hit = a.fn(a)
    except SystemExit as e:  # usage errors raised as sys.exit("usage: ...")
        if isinstance(e.code, str) and e.code.startswith("usage:"):
            print(e.code, file=sys.stderr)
            raise SystemExit(2)
        raise
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 1 if hit else 0


if __name__ == "__main__":
    sys.exit(main())
