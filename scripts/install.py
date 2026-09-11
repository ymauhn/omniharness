#!/usr/bin/env python
"""User-scope install of OmniHarness (docs/adr/0002): junctions for the portable skills and the
gauntlet skill, byte-compared copies of the Workflow drivers (gauntlet, scout), a union-merge of the gate into settings.json.
Never deletes: a differing target is a numbered triage list (exit 1) unless --adopt renames it.

Exit codes: 0 ok, 1 triage needed / check failed / sandbox, 2 usage.
"""
import argparse
import filecmp
import json
import os
import shutil
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
IS_WIN = os.name == "nt"
# Claude-only Workflow drivers: (source in the repo, installed name in ~/.claude/workflows). meta.name must match the file stem.
DRIVERS = (("gauntlet/gauntlet.workflow.js", "gauntlet-driver.js"), ("scout/scout.workflow.js", "scout-driver.js"))


def is_link(p):
    return os.path.islink(p) or (IS_WIN and os.path.isjunction(p))


def same(a, b):
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


def points_to(link, target):
    if not is_link(link):
        return False
    if same(link, target):
        return True
    # ponytail: fallback for hosts where realpath stops at a mapped drive: compare a marker file through the link
    marker = "SKILL.md"
    return os.path.isfile(os.path.join(link, marker)) and filecmp.cmp(
        os.path.join(link, marker), os.path.join(target, marker), shallow=False)


def describe(p):
    if is_link(p):
        return "link to " + os.path.realpath(p).replace("\\", "/")
    return "real directory" if os.path.isdir(p) else "file"


def mklink(link, target):
    os.makedirs(os.path.dirname(link), exist_ok=True)
    if IS_WIN:
        subprocess.run(["cmd", "/c", "mklink", "/J", os.path.normpath(link), os.path.normpath(target)],
                       check=True, capture_output=True)
    else:
        os.symlink(target, link)


def free_backup(p):
    cand, n = p + ".pre-omniharness", 1
    while os.path.lexists(cand):
        n += 1
        cand = f"{p}.pre-omniharness-{n}"
    return cand


def planned_links(home, no_agents):
    root = REPO + "/.agents/skills"
    out = []
    for name in sorted(os.listdir(root)):
        target = f"{root}/{name}"
        if not os.path.isdir(target):
            continue
        out.append((f"{home}/.claude/skills/{name}", target))
        if not no_agents:
            out.append((f"{home}/.agents/skills/{name}", target))
    out.append((f"{home}/.claude/skills/gauntlet-loop", REPO + "/gauntlet"))
    return out


def load_fragment():
    with open(REPO + "/harness/settings.json", encoding="utf-8") as f:
        frag = json.loads(f.read().replace("{{OMNIHARNESS_HOME}}", REPO))
    frag.pop("_comment", None)
    return frag


def merged_settings(path):
    frag = load_fragment()
    cur = {}
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            cur = json.load(f)
    perms = cur.setdefault("permissions", {})
    for key in ("deny", "ask"):
        lst = perms.setdefault(key, [])
        lst.extend(e for e in frag["permissions"][key] if e not in lst)
    pre = cur.setdefault("hooks", {}).setdefault("PreToolUse", [])
    if not any("guard_bash.py" in h.get("command", "") for e in pre for h in e.get("hooks", [])):
        pre.extend(frag["hooks"]["PreToolUse"])
    return cur


def manual_lines(home):
    return (f"\nAdd by hand (never written by this script):\n"
            f"  {home}/.claude/CLAUDE.md          -> @{REPO}/AGENTS.md\n"
            f"  Hermes config.yaml                -> skills:\n"
            f"                                         external_dirs:\n"
            f"                                           - {home}/.agents/skills\n"
            f"  Codex reads {home}/.agents/skills natively; nothing to add.\n")


def check(home, links, drivers, settings):
    rows = [("junction", link, points_to(link, target)) for link, target in links]
    rows += [("driver", dst, os.path.isfile(dst) and filecmp.cmp(src, dst, shallow=False)) for src, dst in drivers]
    have = []
    if os.path.isfile(settings):
        with open(settings, encoding="utf-8") as f:
            have = json.load(f).get("permissions", {}).get("ask", [])
    rows.append(("settings", settings, all(e in have for e in load_fragment()["permissions"]["ask"])))
    for kind, path, ok in rows:
        print(f"{'OK  ' if ok else 'FAIL'}  {kind:9}{path}")
    return 0 if all(r[2] for r in rows) else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--adopt", action="store_true")
    ap.add_argument("--no-agents", action="store_true", help="skip the ~/.agents/skills junctions")
    a = ap.parse_args()
    if os.environ.get("OMNIHARNESS_SANDBOX") == "1":
        print("refusing: OMNIHARNESS_SANDBOX=1 (benchmark sandbox, not a user home)")
        return 1
    home = os.path.abspath(a.home).replace("\\", "/")
    links = planned_links(home, a.no_agents)
    drivers = [(f"{REPO}/{src}", f"{home}/.claude/workflows/{dst}") for src, dst in DRIVERS]
    settings = home + "/.claude/settings.json"
    for src, _ in drivers:
        if not os.path.isfile(src):
            print(f"missing in repo: {src} (checkout incomplete)")
            return 1
    if a.check:
        return check(home, links, drivers, settings)

    conflicts = [(l, t) for l, t in links if os.path.lexists(l) and not points_to(l, t)]
    if conflicts and not a.adopt:
        print("Triage: existing targets that are not ours (rerun with --adopt to rename them):")
        for i, (l, _) in enumerate(conflicts, 1):
            print(f"{i}. {l}: {describe(l)}; would be renamed to {free_backup(l)}")
        return 1
    plan = [f"rename {l} -> {free_backup(l)}" for l, _ in conflicts]
    plan += [f"junction {l} -> {t}" for l, t in links if (l, t) in conflicts or not os.path.lexists(l)]
    plan += [f"copy {src} -> {dst}" for src, dst in drivers if not (os.path.isfile(dst) and filecmp.cmp(src, dst, shallow=False))]
    new = merged_settings(settings)
    old = json.load(open(settings, encoding="utf-8")) if os.path.isfile(settings) else None
    if new != old:
        plan.append(f"merge harness/settings.json -> {settings}" + (f" (backup {free_backup(settings)})" if old else ""))
    print("Plan:" if plan else "Nothing to do.")
    for p in plan:
        print("  " + p)
    if a.dry_run:
        print(manual_lines(home))
        return 0

    for l, _ in conflicts:
        os.rename(l, free_backup(l))
    for l, t in links:
        if not os.path.lexists(l):
            mklink(l, t)
    for src, dst in drivers:
        if f"copy {src} -> {dst}" in plan:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
    if new != old:
        os.makedirs(os.path.dirname(settings), exist_ok=True)
        if old is not None and not os.path.exists(settings + ".pre-omniharness"):
            shutil.copyfile(settings, settings + ".pre-omniharness")
        with open(settings, "w", encoding="utf-8") as f:
            json.dump(new, f, indent=2)
            f.write("\n")
    print(manual_lines(home))
    return 0


if __name__ == "__main__":
    sys.exit(main())
