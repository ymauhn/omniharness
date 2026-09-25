"""One bounded local catalog request over stdin/stdout; no model or skill execution."""
import argparse
import json
import sys
from pathlib import Path

from harness.skill_catalog import build_snapshot, query_snapshot, validate_snapshot, write_snapshot, _load_json


def view(snapshot, request):
    validate_snapshot(snapshot)
    allowed = {'op', 'q', 'host', 'ring', 'limit', 'offset', 'skill_id'}
    if not isinstance(request, dict) or set(request) - allowed:
        raise ValueError('invalid request')
    op = request.get('op', 'list')
    if op not in ('list', 'query', 'get'):
        raise ValueError('invalid operation')
    q = request.get('q', '')
    ring = request.get('ring', 'installed')
    ring = None if ring == 'all' else ring
    limit, offset = request.get('limit', 50), request.get('offset', 0)
    # One validation path for all list/search pagination, including blank queries.
    ranked = query_snapshot(snapshot, q, limit, request.get('host'), ring=ring, offset=offset)
    base = {key: snapshot[key] for key in ('snapshot_id', 'coverage', 'issues', 'generated_at')}
    def public(row):
        return {**{key: value for key, value in row.items() if key != 'source_path'}, 'id': row['skill_id']}
    if op == 'get':
        identifier = request.get('skill_id')
        if not isinstance(identifier, str) or len(identifier) > 160:
            raise ValueError('invalid skill id')
        row = next((row for row in snapshot['rows'] if row['skill_id'] == identifier), None)
        return {**base, 'row': public(row) if row else None}
    rows = [row for row in snapshot['rows'] if ring is None or row['ring'] == ring]
    if q.strip():
        by_id = {row['skill_id']: row for row in rows}
        result = [{**public(by_id[item['skill_id']]), 'relevance': item['relevance']} for item in ranked['results']]
        total = ranked['total']
    else:
        rows.sort(key=lambda row: (row['name'].casefold(), row['skill_id']))
        total = len(rows)
        result = [public(row) for row in rows[offset:offset + limit]]
    return {**base, 'query': q, 'rows': result, 'total': total, 'offset': offset, 'limit': limit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--home', default=str(Path.home()))
    args = parser.parse_args()
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise ValueError('oversized request')
        request = json.loads(raw.decode('utf-8'))
        if not isinstance(request, dict):
            raise ValueError('invalid request')
        if request == {'op': 'build'}:
            overlay_path = Path(args.root) / 'docs/skills-graph/skill-metadata.json'
            snapshot = build_snapshot(root=args.root, home=args.home, overlay=_load_json(overlay_path))
            write_snapshot(snapshot, args.snapshot)
            result = {key: snapshot[key] for key in ('snapshot_id', 'coverage', 'issues', 'generated_at')}
        else:
            result = view(_load_json(args.snapshot), request)
        sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8'))
        return 0
    except (OSError, ValueError, TypeError, KeyError):
        # No raw paths, prompt excerpts or filesystem exception details in the API.
        print('{"error":"catalog_unavailable_or_invalid_request"}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
