#!/usr/bin/env python
"""Per-entry install of the OmniHarness library (library/manifest.json, V1 pillar 4).

  list | verify | install <entry> [--dry-run] | uninstall <entry> [--dry-run]     (--home defaults to ~)

A skill installs as junctions (symlinks off Windows) to its repo directory; a template or tutorial installs as a
copy. Every source is pinned by sha256 (a directory hashes its sorted "relpath NUL file-sha256 LF" lines), and a
mismatch refuses the install. A replaced target keeps a .pre-omniharness backup. Uninstall removes only a link to
the entry's source or a copy still equal to the pinned hash; anything else is triaged and left in place. Targets are
confined to ~/.claude/skills, ~/.agents/skills and ~/.omniharness/library, so settings.json is never touched.

Exit codes: 0 ok, 1 verify failed / triage needed, 2 usage.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install import REPO, describe, free_backup, is_link, mklink, points_to  # noqa: E402

LIBRARY = re.compile(r"\.omniharness/library/[A-Za-z0-9][A-Za-z0-9._-]*")
TARGET = {"skill": re.compile(r"\.(claude|agents)/skills/[a-z0-9][a-z0-9-]*"), "template": LIBRARY, "tutorial": LIBRARY}


def file_sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def digest(path):
    if os.path.isfile(path):
        return file_sha(path)
    if not os.path.isdir(path):
        return None
    rels = sorted(os.path.relpath(os.path.join(root, name), path).replace("\\", "/")
                  for root, _, names in os.walk(path) if "__pycache__" not in os.path.relpath(root, path).split(os.sep)
                  for name in names)
    return hashlib.sha256("".join(f"{rel}\0{file_sha(os.path.join(path, rel))}\n" for rel in rels).encode()).hexdigest()


def load():
    with open(REPO + "/library/manifest.json", encoding="utf-8") as f:
        entries = json.load(f)["entries"]
    for e in entries:
        if (e["kind"] not in TARGET or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", e["id"])
                or os.path.isabs(e["source"]) or ".." in e["source"].replace("\\", "/").split("/")
                or not all(TARGET[e["kind"]].fullmatch(t) for t in e["installs"])):
            raise SystemExit(f"invalid manifest entry: {e.get('id')!r}")
    return entries


def ours(e, dst):
    src = f"{REPO}/{e['source']}"
    if e["kind"] == "skill":
        return points_to(dst, src)
    return os.path.isfile(dst) and not is_link(dst) and file_sha(dst) == e["sha256"]


def status(e, home):
    dsts = [f"{home}/{t}" for t in e["installs"]]
    if all(ours(e, d) for d in dsts):
        return "installed"
    return "conflict" if any(os.path.lexists(d) and not ours(e, d) for d in dsts) else "absent"


def install(e, home, dry):
    src = f"{REPO}/{e['source']}"
    if digest(src) != e["sha256"]:
        print(f"FAIL  {e['id']}: {e['source']} differs from its pinned sha256; refusing to install (run verify)")
        return 1
    plan = []
    for t in e["installs"]:
        dst = f"{home}/{t}"
        if ours(e, dst):
            continue
        if os.path.lexists(dst):
            plan.append(("rename", dst, free_backup(dst)))
        plan.append(("junction", dst, src) if e["kind"] == "skill" else ("copy", src, dst))
    print("Plan:" if plan else "Nothing to do.")
    for op, a, b in plan:
        print(f"  {op} {a} -> {b}")
    if dry:
        return 0
    for op, a, b in plan:
        if op == "rename":
            os.rename(a, b)
        elif op == "junction":
            mklink(a, b)
        else:
            os.makedirs(os.path.dirname(b), exist_ok=True)
            shutil.copyfile(a, b)
    return 0


def uninstall(e, home, dry):
    dsts = [f"{home}/{t}" for t in e["installs"]]
    foreign = [d for d in dsts if os.path.lexists(d) and not ours(e, d)]
    if foreign:
        print(f"Triage: {e['id']} targets that are no longer ours; nothing removed:")
        for i, d in enumerate(foreign, 1):
            print(f"{i}. {d}: {describe(d)}; not a link to {e['source']} nor a copy matching its sha256")
        return 1
    mine = [d for d in dsts if os.path.lexists(d)]
    print("Plan:" if mine else "Nothing to do.")
    for d in mine:
        print(f"  remove {d} ({'link' if is_link(d) else 'copy'})")
    for d in dsts:
        for backup in glob.glob(glob.escape(d) + ".pre-omniharness*"):
            print(f"  keep backup {backup} (restore by renaming it)")
    if dry:
        return 0
    for d in mine:
        if is_link(d) and not os.path.islink(d):
            os.rmdir(d)  # a junction: rmdir drops the link without entering it
        else:
            os.unlink(d)  # a symlink or our own copy
    return 0


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--home", default=os.path.expanduser("~"))
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sub.add_parser("verify")
    for name in ("install", "uninstall"):
        p = sub.add_parser(name)
        p.add_argument("entry")
        p.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    entries = load()
    home = os.path.abspath(a.home).replace("\\", "/")
    if a.cmd == "verify":
        bad = 0
        for e in entries:
            got = digest(f"{REPO}/{e['source']}")
            bad += got != e["sha256"]
            print(f"OK    {e['id']}" if got == e["sha256"] else f"FAIL  {e['id']}: pinned {e['sha256']}, found {got}")
        return 1 if bad else 0
    if a.cmd == "list":
        for e in entries:
            print(f"{e['id']:32} {e['kind']:9} {status(e, home):9} {e['source']}")
            for t in e["installs"]:
                print(f"  {'junction' if e['kind'] == 'skill' else 'copy'} ~/{t}")
        return 0
    entry = next((e for e in entries if e["id"] == a.entry), None)
    if entry is None:
        print(f"unknown entry {a.entry!r}; see: library.py list")
        return 2
    if os.environ.get("OMNIHARNESS_SANDBOX") == "1":
        print("refusing: OMNIHARNESS_SANDBOX=1 (benchmark sandbox, not a user home)")
        return 1
    return (install if a.cmd == "install" else uninstall)(entry, home, a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
