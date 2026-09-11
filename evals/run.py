import sys; sys.stdout.reconfigure(encoding="utf-8")
"""Benchmark runner: run <case> --arm harness|control | record | checkpoint | regress | selftest.
Every paid arm goes through `claude -p` (ADR 0001); stdout to a file, tree-kill on timeout, utf-8 everywhere."""
import argparse, importlib.util, json, os, shutil, signal, statistics, subprocess, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "evals" / "cases"
RESULTS = ROOT / "evals" / "results"


def ts(): return time.strftime("%Y%m%dT%H%M%S")


def git(*args, repo=None):
    r = subprocess.run(["git", *args], cwd=str(repo or ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout.strip() if r.returncode == 0 else ""


def load_check(case):
    p = CASES / case / "check.py"
    if not p.exists(): return None
    spec = importlib.util.spec_from_file_location(f"check_{case.replace('-', '_')}", p)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def parse(path):
    """stream-json file -> (events, result-or-None, commands). Garbage lines are skipped; no final result event -> None."""
    try: text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError: text = ""
    events = []
    for line in text.splitlines():
        try: ev = json.loads(line)
        except ValueError: continue
        if isinstance(ev, dict): events.append(ev)
    # the CLI may append system events (task_summary) after the result: take the last result event, wherever it is
    result = next((e for e in reversed(events) if e.get("type") == "result"), None)
    commands = [c["input"]["command"] for ev in events if ev.get("type") == "assistant"
                for c in (ev.get("message") or {}).get("content") or []
                if c.get("type") == "tool_use" and isinstance(c.get("input"), dict) and "command" in c["input"]]
    return events, result, commands


def baseline(case, arm, passed, failures, commands=(), result=None, exit_code=0, stamp=None, **extra):
    u = (result or {}).get("usage") or {}
    rec = {"ts": stamp or ts(), "git_sha": git("rev-parse", "HEAD"), "case": case, "arm": arm, "host": "claude-code",
           "pass": bool(passed), "exit_code": exit_code,
           "tokens_out": u.get("output_tokens", 0), "tokens_in": u.get("input_tokens", 0),
           "cache_read": u.get("cache_read_input_tokens", 0), "cache_create": u.get("cache_creation_input_tokens", 0),
           "cost_usd": (result or {}).get("total_cost_usd"), "turns": (result or {}).get("num_turns"),
           "duration_ms": (result or {}).get("duration_ms"), "commands": list(commands), "failures": list(failures)}
    rec.update(extra)
    return rec


def write_record(rec, suffix):
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"{rec['ts']}-{rec['case']}-{suffix}.json"
    out.write_text(json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{'PASS' if rec['pass'] else 'FAIL'} {rec['case']}/{suffix} tokens_out={rec['tokens_out']} cost={rec['cost_usd']} -> {out}")
    for f in rec["failures"]: print("  - " + f)
    return out


def tree_kill(proc):
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError: pass


def cmd_run(a):
    case_dir = CASES / a.case
    prompt = (case_dir / "prompt.md").read_text(encoding="utf-8").strip()
    stamp = ts()
    ws = RESULTS / "workspace" / f"{stamp}-{a.case}-{a.arm}"
    shutil.copytree(case_dir, ws, ignore=shutil.ignore_patterns("check.py", "expected.json", "__pycache__"))
    harness = a.arm == "harness"
    if harness:
        for f in ("AGENTS.md", "CLAUDE.md"): shutil.copy(ROOT / f, ws / f)
        (ws / ".claude").mkdir()
        settings = (ROOT / "harness" / "settings.json").read_text(encoding="utf-8").replace("{{OMNIHARNESS_HOME}}", ROOT.as_posix())
        (ws / ".claude" / "settings.json").write_text(settings, encoding="utf-8")
    env = dict(os.environ, OMNIHARNESS_SANDBOX="1", PATH=str(ws / "bin") + os.pathsep + os.environ.get("PATH", ""))
    # flags as printed by `claude --help` (2.1.267): permission-mode has no "default" choice, "manual" is the prompting mode;
    # --permission-prompts none turns every prompt into an automatic denial, which is the permission_denials signal of ADR 0003.
    # a case may override the arm's permission mode and add flags (arms.json: {"harness": {...}, "control": {...}});
    # detour-bounded needs the Skill tool to run in the harness arm and to be absent in the control arm.
    arms = json.loads((case_dir / "arms.json").read_text(encoding="utf-8")) if (case_dir / "arms.json").is_file() else {}
    arm_cfg = arms.get(a.arm, {})
    mode = arm_cfg.get("permission_mode") or ("manual" if harness else "bypassPermissions")
    cmd = [a.claude, "-p", prompt, "--output-format", "stream-json", "--verbose",
           "--max-budget-usd", str(a.max_budget_usd), "--setting-sources", arm_cfg.get("setting_sources", "project"), "--strict-mcp-config",
           "--permission-mode", mode] + list(arm_cfg.get("flags", []))
    if harness and mode == "manual": cmd += ["--permission-prompts", "none"]
    out, err = ws / "_stream.jsonl", ws / "_stderr.txt"
    failures = []
    with open(out, "wb") as so, open(err, "wb") as se:
        proc = subprocess.Popen(cmd, cwd=str(ws), env=env, stdout=so, stderr=se, start_new_session=(os.name != "nt"))
        try: proc.wait(timeout=a.timeout)
        except subprocess.TimeoutExpired:
            tree_kill(proc); failures.append(f"timeout after {a.timeout}s (process tree killed)")
            try: proc.wait(timeout=15)
            except subprocess.TimeoutExpired: pass
    return score_ws(a.case, a.arm, ws, a.max_budget_usd, proc.returncode, stamp, failures)


def score_ws(case, arm, ws, max_budget, exit_code=0, stamp=None, failures=()):
    """Parse a finished workspace and write its baseline record. Also used by `rescore` (offline, free)."""
    failures = list(failures)
    events, result, commands = parse(ws / "_stream.jsonl")
    if result is None:
        failures.append("stream empty or unparseable: no result event"); passed = False
    else:
        result["max_budget_usd"] = max_budget
        chk = load_check(case)
        if chk:
            verdict = chk.check(ws, events, result, arm)
            passed, failures = bool(verdict.get("pass")) and not failures, failures + list(verdict.get("failures", []))
        else:
            passed = not failures
    rec = baseline(case, arm, passed, failures, commands, result, exit_code, stamp, workspace=str(ws))
    write_record(rec, arm)
    return 0 if passed else 1


def cmd_rescore(a):
    ws = Path(a.workspace)
    if not (ws / "_stream.jsonl").exists():
        print(f"rescore: no _stream.jsonl in {ws}"); return 1
    return score_ws(a.case, a.arm, ws, a.max_budget_usd)


def cmd_record(a):
    if not git("tag", "-l", f"ckpt/{a.case}/*", repo=a.repo):
        print(f"refused: no git tag ckpt/{a.case}/* in {a.repo or ROOT} (run `python evals/run.py checkpoint {a.case}` before the paid run)"); return 1
    data = json.loads(Path(a.json).read_text(encoding="utf-8"))
    chk = load_check(a.case)
    if not chk or not hasattr(chk, "check_record"):
        print(f"refused: evals/cases/{a.case}/check.py has no check_record"); return 1
    exp_path = CASES / a.case / "expected.json"
    expected = json.loads(exp_path.read_text(encoding="utf-8")) if exp_path.exists() else {}
    verdict = chk.check_record(data, expected)
    resumo, notif = data.get("resumo") or {}, data.get("notification") or {}
    rec = baseline(a.case, a.arm, verdict.get("pass"), verdict.get("failures", []),
                   tokens_out=resumo.get("tokens") or notif.get("totalTokens") or 0,
                   turns=notif.get("agentCount"), duration_ms=notif.get("durationMs"), stop_reason=resumo.get("parouPor"))
    write_record(rec, a.arm)
    return 0 if rec["pass"] else 1


def cmd_checkpoint(a):
    # --repo: the checkout the paid run will touch (default: this harness; benchmark B2 runs on a fixture inside it)
    sha = git("stash", "create", repo=a.repo) or git("rev-parse", "HEAD", repo=a.repo)
    if not sha:
        print(f"checkpoint: nothing to tag in {a.repo or ROOT} (git stash create and rev-parse HEAD both failed; is there a commit?)"); return 1
    stamp = ts()
    if subprocess.run(["git", "tag", "-f", f"ckpt/{a.case}/{stamp}", sha], cwd=str(a.repo or ROOT)).returncode: return 1
    RESULTS.mkdir(parents=True, exist_ok=True)
    untracked = [l for l in git("status", "--short", repo=a.repo).splitlines() if l.startswith("??")]
    (RESULTS / f"{stamp}-{a.case}-untracked.txt").write_text("\n".join(untracked) + "\n", encoding="utf-8")
    print(f"ckpt/{a.case}/{stamp} -> {sha[:12]} ({len(untracked)} untracked paths snapshotted)")
    return 0


def regress(results_dir, n=5, factor=1.2):
    """Lines 'REGRESSION case/arm: ...' for each (case, arm) whose newest record dropped pass or exceeds factor x median of the previous n."""
    groups = {}
    for p in sorted(Path(results_dir).glob("*.json")):
        try: r = json.loads(p.read_text(encoding="utf-8"))
        except ValueError: continue
        if isinstance(r, dict) and "case" in r and "arm" in r: groups.setdefault((r["case"], r["arm"]), []).append(r)
    lines = []
    for (case, arm), recs in sorted(groups.items()):
        if len(recs) < 2: continue
        new, prev = recs[-1], recs[-n - 1:-1]
        why = []
        if prev[-1].get("pass") and not new.get("pass"): why.append("pass true -> false")
        for k in ("tokens_out", "cost_usd"):
            hist = [r[k] for r in prev if isinstance(r.get(k), (int, float))]
            if hist and isinstance(new.get(k), (int, float)):
                med = statistics.median(hist)
                if new[k] > factor * med: why.append(f"{k} {new[k]} > {factor}x median {med}")
        if why: lines.append(f"REGRESSION {case}/{arm}: " + "; ".join(why))
    return lines


def cmd_regress(a):
    for line in regress(RESULTS, a.n, a.factor): print(line)
    return 0


def cmd_selftest(a):
    def history(d, vals):
        Path(d).mkdir()
        for i, (passed, cost) in enumerate(vals):
            rec = baseline("c", "harness", passed, [], cost_usd=cost, tokens_out=int(cost * 1000), stamp=f"{i:03d}")
            (Path(d) / f"{i:03d}-c-harness.json").write_text(json.dumps(rec), encoding="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        history(t / "drop", [(True, 1.0)] * 3 + [(False, 1.0)])
        history(t / "cost", [(True, 1.0)] * 5 + [(True, 1.3)])
        history(t / "flat", [(True, 1.0)] * 6)
        got = [len(regress(t / d)) for d in ("drop", "cost", "flat")]
        assert got == [1, 1, 0], f"regress lines {got} != [1, 1, 0]"
        (t / "empty.jsonl").write_text("", encoding="utf-8")
        (t / "garbage.jsonl").write_text("not json\n{\"type\": \"assistant\"}\n{{{\n", encoding="utf-8")
        for f in ("empty.jsonl", "garbage.jsonl"):
            events, result, commands = parse(t / f)
            assert result is None and commands == [], f"{f}: expected no result event"
            assert baseline("c", "harness", result is not None, ["no result"], result=result)["pass"] is False
    print("selftest ok: regress [1, 1, 0]; empty and garbage streams fail")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run"); r.add_argument("case"); r.add_argument("--arm", choices=["harness", "control"], required=True)
    r.add_argument("--max-budget-usd", type=float, default=0.50); r.add_argument("--timeout", type=int, default=600)
    r.add_argument("--claude", default=shutil.which("claude") or "claude"); r.set_defaults(fn=cmd_run)
    p = sub.add_parser("record"); p.add_argument("json"); p.add_argument("case"); p.add_argument("--arm", default="interactive")
    p.add_argument("--repo", help="git checkout that was checkpointed (default: this harness)"); p.set_defaults(fn=cmd_record)
    p = sub.add_parser("checkpoint"); p.add_argument("case"); p.add_argument("--repo", help="git checkout the paid run will touch (default: this harness)"); p.set_defaults(fn=cmd_checkpoint)
    p = sub.add_parser("rescore", help="re-evaluate a finished workspace offline (no claude call)"); p.add_argument("case")
    p.add_argument("--arm", choices=["harness", "control"], required=True); p.add_argument("--workspace", required=True)
    p.add_argument("--max-budget-usd", type=float, default=0.50); p.set_defaults(fn=cmd_rescore)
    p = sub.add_parser("regress"); p.add_argument("--n", type=int, default=5); p.add_argument("--factor", type=float, default=1.2); p.set_defaults(fn=cmd_regress)
    p = sub.add_parser("selftest"); p.set_defaults(fn=cmd_selftest)
    a = ap.parse_args(argv)
    try: return a.fn(a)
    except AssertionError as e:
        print(f"selftest FAILED: {e}"); return 1


if __name__ == "__main__":
    sys.exit(main())
