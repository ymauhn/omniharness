"""Project-local, append-only review history. One coordinator writes per project."""
import argparse
import hashlib
import json
import math
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urlunsplit


VERDICTS = {"scout": {"reviewed"}, "gauntlet": {"confirmed", "refuted"}}


def identity(value, consumer):
    if not isinstance(value, str) or not value.strip() or any(ord(c) < 32 for c in value):
        raise ValueError("invalid identity")
    value = value.strip()
    if consumer == "scout":
        url = urlsplit(value)
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
            raise ValueError("expected a public HTTP URL without credentials")
        if any(re.search(r"token|secret|password|credential|api.?key|signature|authorization", key, re.I)
               for key, _ in parse_qsl(url.query)):
            raise ValueError("credential-bearing URL cannot enter history")
        # Preserve scheme, path case, query ordering/values and trailing slash.
        return urlunsplit((url.scheme.lower(), url.netloc.lower(), url.path, url.query, ""))
    value = value.replace("\\", "/")
    match = re.fullmatch(r"([^:]+):([1-9][0-9]*) — (.+)", value)
    if not match or match[1].startswith("/") or ".." in match[1].split("/"):
        raise ValueError("expected relative/file:line — title")
    return value


def validate(row):
    if not isinstance(row, dict) or row.get("version") != 1:
        raise ValueError("invalid history record")
    consumer = row.get("consumer")
    if consumer not in VERDICTS or row.get("verdict") not in VERDICTS[consumer]:
        raise ValueError("only reviewed verdicts can enter history")
    if not isinstance(row.get("scope"), str) or not row["scope"].strip():
        raise ValueError("scope required")
    if not re.fullmatch(r"[a-f0-9]{64}", row.get("context", "")):
        raise ValueError("context must be a SHA-256 fingerprint")
    if not isinstance(row.get("evidence"), str) or not row["evidence"].strip():
        raise ValueError("evidence required")
    row["id"] = identity(row.get("id"), consumer)
    date = datetime.fromisoformat(row["date"])
    if date.tzinfo is None:
        raise ValueError("date must include a timezone")
    return row


def inside(root, path):
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root):
        raise ValueError("path escapes project root")
    return resolved


def execute(args):
    root = Path(args.root).resolve(strict=True)
    meta = {"consumer": args.consumer, "scope": args.scope, "context": args.context}
    if not args.scope.strip():
        raise ValueError("scope required")
    if args.command == "fingerprint":
        if not args.file:
            raise ValueError("fingerprint requires the complete review input file inventory")
        files = sorted({inside(root, p) for p in args.file})
        inventory = [(p.relative_to(root).as_posix(), hashlib.sha256(p.read_bytes()).hexdigest()) for p in files]
        payload = json.dumps([args.consumer, args.scope, inventory], ensure_ascii=True).encode()
        return {**meta, "context": hashlib.sha256(payload).hexdigest(), "files": len(files)}
    if not re.fullmatch(r"[a-f0-9]{64}", args.context or "") or not math.isfinite(args.max_age_days) or not 0 < args.max_age_days <= 365:
        raise ValueError("valid fingerprint and positive max age required")
    path = inside(root, ".omniharness/seen.jsonl")
    contents = path.read_text(encoding="utf-8") if path.exists() else ""
    if contents and not contents.endswith("\n"):
        raise ValueError("unterminated journal; preserve it for inspection")
    rows = [validate(json.loads(line)) for line in contents.splitlines()]
    now = datetime.now(timezone.utc)
    latest = {}
    for row in rows:
        if all(row[k] == v for k, v in meta.items()):
            latest[row["id"]] = row
    recent = {key: row for key, row in latest.items()
              if timedelta(0) <= now - datetime.fromisoformat(row["date"]) <= timedelta(days=args.max_age_days)}
    if args.command == "snapshot":
        return {**meta, "records": [] if args.fresh else list(recent.values())}
    updates = json.load(sys.stdin)
    if not isinstance(updates, list):
        raise ValueError("record expects an array on stdin")
    pending = []
    for update in updates:
        if not isinstance(update, dict):
            raise ValueError("invalid update")
        row = validate({**update, **meta, "version": 1, "date": now.isoformat()})
        previous = recent.get(row["id"])
        if previous and all(previous[k] == row[k] for k in ("verdict", "evidence")):
            continue
        pending.append(row)
        recent[row["id"]] = row
    if pending:
        # Validate the entire batch and existing journal before changing either.
        # A coordinator serializes writes; workers only return proposed updates.
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write("".join(json.dumps(row, ensure_ascii=True) + "\n" for row in pending))
    return {**meta, "appended": len(pending)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("fingerprint", "snapshot", "record"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--consumer", choices=tuple(VERDICTS), required=True)
    parser.add_argument("--scope", required=True)
    parser.add_argument("--context")
    parser.add_argument("--file", action="append")
    parser.add_argument("--max-age-days", type=float, default=7)
    parser.add_argument("--fresh", action="store_true")
    try:
        result = execute(parser.parse_args())
    except (ValueError, TypeError, KeyError, OSError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=True))
        return 1
    print(json.dumps(result, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
