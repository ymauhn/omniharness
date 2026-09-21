import sys; sys.stdout.reconfigure(encoding="utf-8")
"""Benchmark runner: run | rescore | record | checkpoint | regress | audit-history | selftest.
Every paid arm goes through `claude -p` (ADR 0001); stdout to a file, tree-kill on timeout, utf-8 everywhere."""
import argparse, importlib.util, json, os, shutil, signal, subprocess, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from evals import records
CASES = ROOT / "evals" / "cases"
RESULTS = ROOT / "evals" / "results"


def ts(): return records.timestamp()


def git(*args, repo=None):
    r = subprocess.run(["git", *args], cwd=str(repo or ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout.strip() if r.returncode == 0 else ""


def load_check(case):
    p = CASES / case / "check.py"
    if not p.exists(): return None
    spec = importlib.util.spec_from_file_location(f"check_{case.replace('-', '_')}", p)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def parse(path, strict=False):
    """stream-json -> events, result, commands. Scoring uses strict mode; inspection can recover valid lines."""
    try: text = Path(path).read_text(encoding="utf-8", errors="strict" if strict else "replace")
    except OSError: text = ""
    events = []
    for line in text.splitlines():
        if not line.strip(): continue
        try: ev = json.loads(line)
        except ValueError:
            if strict: raise ValueError("malformed stream: invalid JSON")
            continue
        if isinstance(ev, dict): events.append(ev)
        elif strict: raise ValueError("malformed stream: non-object event")
    # the CLI may append system events (task_summary) after the result: take the last result event, wherever it is
    result = next((e for e in reversed(events) if e.get("type") == "result"), None)
    for ev in events:
        if ev.get("type") == "assistant":
            message = ev.get("message")
            if not isinstance(message, dict) or not isinstance(message.get("content"), list) or any(not isinstance(c, dict) for c in message["content"]):
                raise ValueError("malformed assistant event")
            for c in message["content"]:
                if c.get("type") == "tool_use" and (not isinstance(c.get("input"), dict) or not isinstance(c.get("name"), str)):
                    raise ValueError("malformed tool event")
    if strict and sum(ev.get("type") == "result" for ev in events) > 1:
        raise ValueError("malformed stream: multiple result events")
    commands = [c["input"]["command"] for ev in events if ev.get("type") == "assistant"
                for c in (ev.get("message") or {}).get("content") or []
                if c.get("type") == "tool_use" and isinstance(c.get("input"), dict) and "command" in c["input"]]
    return events, result, commands


def baseline(case, arm, passed, failures, commands=(), result=None, exit_code=None, stamp=None, **extra):
    valid = extra.pop("run_valid", type(exit_code) is int and exit_code == 0)
    rec = {"schema_version": records.SCHEMA_VERSION, "record_id": records.identity(), "run_id": records.identity(),
           "ts": stamp or ts(), "git_sha": git("rev-parse", "HEAD"), "case": case, "arm": arm, "host": "claude-code",
           "run_valid": valid, "task_pass": bool(passed) if valid else None,
           "scorer_sha256": records.code_hash(ROOT),
           "control_discriminative": None, "exit_code": exit_code,
           "execution_failures": [], "control_failures": [], "source": None, "manifest": None,
           "commands": list(commands), "failures": list(failures), **records.telemetry(result)}
    rec.update(extra)
    rec["pass"] = rec["run_valid"] is True and rec["task_pass"] is True
    rec["coverage"] = {k: "measured" if rec[k] is not None else "unavailable" for k in rec["coverage"]}
    return rec


def write_record(rec, suffix):
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"{rec['ts']}-{rec['case']}-{suffix}-{rec['record_id']}.json"
    with out.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(rec, indent=1, ensure_ascii=False, allow_nan=False))
    print(f"valid={rec['run_valid']} task_pass={rec['task_pass']} control={rec['control_discriminative']} {rec['case']}/{suffix} tokens_out={rec['tokens_out']} cost={rec['cost_usd']} -> {out}")
    for f in rec["failures"]: print("  - " + f)
    return out


def tree_kill(proc):
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError: pass


def cmd_run(a):
    if a.arm == "control":
        print("refused: live control requires OS-enforced home isolation (not implemented); use offline fixtures")
        return 1
    case_dir = CASES / a.case
    prompt = (case_dir / "prompt.md").read_text(encoding="utf-8").strip()
    stamp = ts()
    ws = RESULTS / "workspace" / f"{stamp}-{a.case}-{a.arm}-{records.identity()}"
    shutil.copytree(case_dir, ws, ignore=shutil.ignore_patterns("check.py", "expected.json", "__pycache__"))
    harness = a.arm == "harness"
    if harness:
        for f in ("AGENTS.md", "CLAUDE.md"): shutil.copy(ROOT / f, ws / f)
        (ws / ".claude").mkdir()
        settings = json.loads((ROOT / "harness" / "settings.json").read_text(encoding="utf-8").replace("{{OMNIHARNESS_HOME}}", ROOT.as_posix()))
        for entries in settings["hooks"].values():
            for entry in entries:
                for hook in entry["hooks"]:
                    hook["command"] = hook["command"].replace("python ", f'"{Path(sys.executable).as_posix()}" ', 1)
        (ws / ".claude" / "settings.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")
    env = dict(os.environ, OMNIHARNESS_SANDBOX="1", PATH=os.pathsep.join((str(ws / "bin"), str(Path(sys.executable).parent), os.environ.get("PATH", ""))))
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
    config = {"permission_mode": mode, "setting_sources": arm_cfg.get("setting_sources", "project"),
              "flags": list(arm_cfg.get("flags", [])), "permission_prompts": "none" if mode == "manual" else None,
              "home_isolation": "unverified"}
    manifest = records.manifest(ROOT, case_dir, a.arm, a.max_budget_usd, a.timeout, config)
    (ws / "_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    out, err = ws / "_stream.jsonl", ws / "_stderr.txt"
    failures = []
    started = time.perf_counter()
    exit_code = None
    with open(out, "wb") as so, open(err, "wb") as se:
        try:
            proc = subprocess.Popen(cmd, cwd=str(ws), env=env, stdout=so, stderr=se, start_new_session=(os.name != "nt"))
            try: proc.wait(timeout=a.timeout)
            except subprocess.TimeoutExpired:
                tree_kill(proc); failures.append(f"timeout after {a.timeout}s (process tree killed)")
                try: proc.wait(timeout=15)
                except subprocess.TimeoutExpired: pass
            exit_code = proc.returncode
        except OSError as exc:
            failures.append(f"process launch failed: {type(exc).__name__}")
    process = {"exit_code": exit_code, "failures": failures, "wall_ms": round((time.perf_counter() - started) * 1000)}
    (ws / "_process.json").write_text(json.dumps(process), encoding="utf-8")
    return score_ws(a.case, a.arm, ws, a.max_budget_usd, exit_code, stamp, failures)


def evaluate_ws(case, arm, ws, max_budget, exit_code=None, stamp=None, failures=()):
    """Offline assessment; control discrimination never substitutes for task quality."""
    failures = list(failures)
    process_path = ws / "_process.json"
    process = json.loads(process_path.read_text(encoding="utf-8")) if process_path.exists() else {}
    if process_path.exists():
        if process.get("exit_code") != exit_code:
            failures.append("caller exit code contradicts persisted process status")
        exit_code = process.get("exit_code")
        failures.extend(f for f in process.get("failures", []) if f not in failures)
    if type(exit_code) is not int or exit_code != 0:
        failures.append(f"process did not succeed: exit_code={exit_code}")
    try:
        events, result, commands = parse(ws / "_stream.jsonl", strict=True)
    except ValueError as exc:
        events, result, commands = [], None, []
        failures.append(f"malformed stream: {exc}")
    if result is None:
        failures.append("stream empty or unparseable: no result event")
    else:
        if max_budget is not None: result["max_budget_usd"] = max_budget
        if result.get("subtype") != "success" or result.get("is_error"):
            failures.append(f"result did not succeed: subtype={result.get('subtype')!r}, is_error={result.get('is_error')!r}")
        answer = result.get("result")
        if not isinstance(answer, str) or not answer.strip():
            failures.append("empty final answer")
    task_pass, task_failures, discriminative, control_failures = None, [], None, []
    if not failures:
        try:
            chk = load_check(case)
            if not chk or not hasattr(chk, "check"):
                raise ValueError(f"no stream grader for case {case!r}")
            task_pass, task_failures = records.verdict(chk.check(ws, events, result, "harness"))
            if arm == "control":
                discriminative, control_failures = records.verdict(chk.check(ws, events, result, "control"))
        except Exception as exc:
            failures.append(f"grader error: {type(exc).__name__}: {exc}")
            task_pass, discriminative = None, None
    manifest_path = ws / "_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else None
    init = next((ev for ev in events if ev.get("type") == "system" and ev.get("subtype") == "init"), {})
    extra = {"run_id": manifest["run_id"], "run_ts": manifest["started_at"]} if manifest else {"run_id": records.digest({"stream": records.file_hash(ws / "_stream.jsonl"), "workspace": str(ws.resolve())})}
    return baseline(case, arm, task_pass, failures + task_failures, commands, result, exit_code, stamp,
                    run_valid=not failures, execution_failures=failures, control_discriminative=discriminative,
                    control_failures=control_failures, source=records.source(ws), workspace=str(ws), manifest=manifest,
                    grader_sha256=records.file_hash(CASES / case / "check.py"), model=init.get("model"),
                    agent_version=init.get("claude_code_version"), wall_ms=process.get("wall_ms"), **extra)


def score_ws(case, arm, ws, max_budget, exit_code=None, stamp=None, failures=()):
    rec = evaluate_ws(case, arm, ws, max_budget, exit_code, stamp, failures)
    write_record(rec, arm)
    return 0 if rec["pass"] else 1


def cmd_rescore(a):
    ws = Path(a.workspace)
    if not (ws / "_stream.jsonl").exists():
        print(f"rescore: no _stream.jsonl in {ws}"); return 1
    status = ws / "_process.json"
    process = json.loads(status.read_text(encoding="utf-8")) if status.exists() else {}
    manifest_path = ws / "_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    if manifest and (manifest.get("case") != a.case or manifest.get("arm") != a.arm or
                     a.max_budget_usd is not None and a.max_budget_usd != manifest.get("budget_usd")):
        print("refused: rescore case/arm/budget contradicts original manifest"); return 1
    budget = manifest.get("budget_usd", a.max_budget_usd)
    return score_ws(a.case, a.arm, ws, budget, process.get("exit_code"), failures=process.get("failures", []))


def cmd_record(a):
    if not git("tag", "-l", f"ckpt/{a.case}/*", repo=a.repo):
        print(f"refused: no git tag ckpt/{a.case}/* in {a.repo or ROOT} (run `python evals/run.py checkpoint {a.case}` before the paid run)"); return 1
    data = json.loads(Path(a.json).read_text(encoding="utf-8"))
    chk = load_check(a.case)
    if not chk or not hasattr(chk, "check_record"):
        print(f"refused: evals/cases/{a.case}/check.py has no check_record"); return 1
    exp_path = CASES / a.case / "expected.json"
    expected = json.loads(exp_path.read_text(encoding="utf-8")) if exp_path.exists() else {}
    passed, task_failures = records.verdict(chk.check_record(data, expected))
    resumo, notif = data.get("resumo") or {}, data.get("notification") or {}
    failures = ["interactive import has no trusted process/manifest provenance"]
    aggregate = resumo.get("tokens") if resumo.get("tokens") is not None else notif.get("totalTokens")
    rec = baseline(a.case, a.arm, passed, failures + task_failures, run_valid=False,
                   execution_failures=failures, source={"files": {Path(a.json).name: records.file_hash(a.json)}},
                   grader_observation={"task_pass": passed, "failures": task_failures},
                   tokens_total_reported=records.measurement(aggregate), agent_count=records.measurement(notif.get("agentCount")),
                   usage_raw={"resumo_tokens": resumo.get("tokens"), "notification_totalTokens": notif.get("totalTokens")},
                   duration_ms=records.measurement(notif.get("durationMs")), stop_reason=resumo.get("parouPor"))
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
    return records.compare(results_dir, n, factor)["alerts"]


def cmd_regress(a):
    report = records.compare(RESULTS, a.n, a.factor)
    for row in report["groups"]:
        r = row["reliability"]
        print(f"{row['status'].upper()} {row['case']}/{row['arm']}: certified_valid={r['valid']}/{r['attempts']}, task_successes={r['task_successes']}/{r['attempts']}, unverified={row['unverified']}; metrics={row['metrics_compared']}")
    if not report["groups"]: print("INSUFFICIENT: no usable history")
    for line in report["alerts"]: print(line)
    return 1 if report["alerts"] else 0


def audit_history(directory):
    """Derived, sanitised legacy audit. Absence of original provenance stays unknown."""
    directory = Path(directory).resolve()
    rows = []
    for path in sorted(directory.glob("*.json")):
        original_hash = records.file_hash(path)
        old = json.loads(path.read_text(encoding="utf-8"))
        row = {"source_file": path.name, "source_sha256": original_hash, "case": old.get("case"), "arm": old.get("arm"),
               "legacy_pass": old.get("pass"), "reported_exit_code": old.get("exit_code"),
               "run_valid": None, "task_pass": None, "control_discriminative": None,
               "comparison": "incomparable", "findings": ["original manifest and trusted process provenance unavailable"],
               "grader_sha256": records.file_hash(CASES / old["case"] / "check.py"), "grader_observation": None,
               "usage": records.telemetry(None), "tokens_total_reported": None, "model": None}
        if type(old.get("exit_code")) is int and old["exit_code"] != 0:
            row["run_valid"] = False
            row["findings"].append(f"reported process exit {old['exit_code']}")
        workspace = old.get("workspace")
        if workspace:
            ws = (ROOT / workspace.replace("\\", "/")).resolve()
            if ws.is_relative_to(directory / "workspace") and (ws / "_stream.jsonl").is_file():
                row["stream_sha256"] = records.file_hash(ws / "_stream.jsonl")
                events, result, _ = parse(ws / "_stream.jsonl")
                row["usage"] = records.telemetry(result)
                row["model"] = next((e.get("model") for e in events if e.get("subtype") == "init"), None)
                if not result or result.get("subtype") != "success" or result.get("is_error") or not isinstance(result.get("result"), str) or not result["result"].strip():
                    row["run_valid"] = False
                    row["findings"].append("missing/error result or empty final answer")
                elif old["case"] == "detour-bounded":
                    observed = evaluate_ws(old["case"], old["arm"], ws, None, old.get("exit_code"))
                    row["grader_observation"] = {k: observed[k] for k in ("task_pass", "control_discriminative", "failures")}
                    row["findings"].append("grader observation is conditional; original execution/configuration cannot be certified")
                else:
                    row["findings"].append("current full task grading withheld: original budget/configuration is unknown")
            else:
                row["findings"].append("workspace absent or outside the selected history directory")
        elif old.get("case") == "gauntlet-rapido":
            row["tokens_total_reported"] = records.measurement(old.get("tokens_out"))
            row["findings"].append("legacy tokens_out was aggregate subagent usage; no token-category or process evidence")
        rows.append(row)
        if records.file_hash(path) != original_hash:
            raise ValueError(f"source changed during audit: {path.name}")
    return {"audit_version": 1, "records": rows, "summary": {"total": len(rows),
            "invalid": sum(r["run_valid"] is False for r in rows), "unverified": sum(r["run_valid"] is None for r in rows),
            "certified_valid": sum(r["run_valid"] is True for r in rows)}, "originals_unchanged": True}


def cmd_audit(a):
    report = audit_history(a.results or RESULTS)
    with Path(a.out).open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2, ensure_ascii=False)
    print(json.dumps(report["summary"]))
    return 0


def cmd_selftest(a):
    def history(d, vals):
        Path(d).mkdir()
        for i, (passed, cost) in enumerate(vals):
            manifest = records.manifest(ROOT, CASES / "detour-bounded", "harness", 1, 60, {"home_isolation": "offline-fixture"})
            rec = baseline("detour-bounded", "harness", passed, [], exit_code=0, manifest=manifest,
                           model="fixture-model", agent_version="fixture-cli", source={"files": {"_stream.jsonl": "a" * 64}},
                           grader_sha256=manifest["grader_sha256"], cost_usd=cost, tokens_out=int(cost * 1000), stamp=f"{i:03d}")
            (Path(d) / f"{i:03d}-c-harness.json").write_text(json.dumps(rec), encoding="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        history(t / "drop", [(True, 1.0)] * 3 + [(False, 1.0)])
        history(t / "cost", [(True, 1.0)] * 5 + [(True, 1.3)])
        history(t / "flat", [(True, 1.0)] * 6)
        got = [len(regress(t / d)) for d in ("drop", "cost", "flat")]
        assert got == [1, 1, 0], f"regress lines {got} != [1, 1, 0]"
        (t / "empty.jsonl").write_text("", encoding="utf-8")
        (t / "garbage.jsonl").write_text("not json\n{\"type\": \"system\"}\n{{{\n", encoding="utf-8")
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
    p.add_argument("--max-budget-usd", type=float, help="legacy workspace only; cannot override an existing manifest"); p.set_defaults(fn=cmd_rescore)
    p = sub.add_parser("regress"); p.add_argument("--n", type=int, default=5); p.add_argument("--factor", type=float, default=1.2); p.set_defaults(fn=cmd_regress)
    p = sub.add_parser("audit-history", help="write a derived legacy audit without modifying originals")
    p.add_argument("--results"); p.add_argument("--out", required=True); p.set_defaults(fn=cmd_audit)
    p = sub.add_parser("selftest"); p.set_defaults(fn=cmd_selftest)
    a = ap.parse_args(argv)
    try: return a.fn(a)
    except AssertionError as e:
        print(f"selftest FAILED: {e}"); return 1
    except (OSError, ValueError, TypeError, KeyError) as e:
        print(f"refused: {type(e).__name__}: {e}"); return 1


if __name__ == "__main__":
    sys.exit(main())
