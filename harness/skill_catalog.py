"""Bounded, versioned discovery metadata; never an execution/authority decision.

Overlay v1: {schema_version: 1, entries: [{source_key, source_sha256,
metadata: {functional_description, taxonomy, pillars, intents, aliases: {pt, en},
use_cases: {pt, en}, inputs, outputs, when_to_use, when_to_avoid,
prerequisites, reviewed_at}}]}. Metadata fields are optional; unknowns stay null.
Only an exact source-key/hash match is curated. Discovery is delegated to the
trusted repository skills_graph module, with bounded readers/enumerators.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = 1
AUTHORITY = {'status': 'unknown', 'reason': 'task/host authorization is outside the discovery catalog'}
DISCOVERY_SCOPE = 'skills_graph.skill_files/build; no unregistered plugin-cache scan'
LIST_FIELDS = ('taxonomy', 'pillars', 'intents', 'inputs', 'outputs', 'when_to_use', 'when_to_avoid', 'prerequisites')
TEXT_FIELDS = ('functional_description', 'reviewed_at')
LANG_FIELDS = ('aliases', 'use_cases')
META_FIELDS = (*TEXT_FIELDS, *LIST_FIELDS, *LANG_FIELDS)
STOP = set('a an the and or of to for in on with by from is are be use when this that it as at into your you o os as e ou de do da dos das um uma para por com em no na nos nas que como quero preciso'.split())


@dataclass(frozen=True)
class Limits:
    file_bytes: int = 1_048_576
    total_bytes: int = 16_777_216
    files: int = 4096
    directory_entries: int = 30_000
    rows: int = 6000
    relations: int = 20_000

    def __post_init__(self):
        if any(type(value) is not int or value < 1 for value in vars(self).values()):
            raise ValueError('limits must be positive integers')


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _hash(value):
    return hashlib.sha256(value if isinstance(value, bytes) else _json(value).encode('utf-8')).hexdigest()


def _canonical(path):
    return Path(os.path.realpath(path))


def source_key(path, root, home):
    """Canonical source identity survives content edits; aliases share an identity."""
    path = _canonical(path)
    for namespace, base in (('repo', root), ('home', home)):
        try:
            return namespace + ':' + path.relative_to(_canonical(base)).as_posix()
        except ValueError:
            pass
    return 'absolute:' + path.as_posix()


def _skill_id(ring, key):
    return ring + ':' + _hash(key)


def validate_overlay(overlay):
    if not isinstance(overlay, dict) or set(overlay) != {'schema_version', 'entries'} or type(overlay['schema_version']) is not int or overlay['schema_version'] != SCHEMA_VERSION:
        raise ValueError('overlay requires schema_version 1 and entries')
    if not isinstance(overlay['entries'], list) or len(overlay['entries']) > 6000:
        raise ValueError('overlay entries must be a bounded list')
    found = {}
    for entry in overlay['entries']:
        if not isinstance(entry, dict) or set(entry) != {'source_key', 'source_sha256', 'metadata'}:
            raise ValueError('overlay entry requires source_key, source_sha256 and metadata')
        key, digest, metadata = entry['source_key'], entry['source_sha256'], entry['metadata']
        if not isinstance(key, str) or not key or len(key) > 4096 or key in found:
            raise ValueError('overlay source_key is invalid or duplicated')
        if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
            raise ValueError('overlay source_sha256 must be a lowercase SHA-256')
        if not isinstance(metadata, dict) or set(metadata) - set(META_FIELDS):
            raise ValueError('unknown metadata field')
        for field, value in metadata.items():
            if field in TEXT_FIELDS:
                if not isinstance(value, str) or not value.strip() or len(value) > 8000:
                    raise ValueError('metadata text must be nonempty and bounded')
                if field == 'reviewed_at':
                    date.fromisoformat(value)
            elif field in LANG_FIELDS:
                if not isinstance(value, dict) or set(value) - {'pt', 'en'}:
                    raise ValueError('localized metadata supports pt/en lists')
                for terms in value.values():
                    _validate_terms(terms)
            else:
                _validate_terms(value)
        found[key] = entry
    return found


def _validate_terms(value):
    if not isinstance(value, list) or len(value) > 100 or any(not isinstance(item, str) or not item.strip() or len(item) > 2000 for item in value):
        raise ValueError('metadata lists must contain bounded nonempty strings')


class _Discovery:
    def __init__(self, root, home, limits):
        self.root, self.home, self.limits = root, home, limits
        self.issues, self.cache = [], {}
        self.bytes = self.entries = 0

    def issue(self, code, source, detail, severity='error'):
        item = {'code': code, 'source': str(source), 'detail': detail, 'severity': severity}
        if item not in self.issues:
            self.issues.append(item)

    def read(self, path):
        key = source_key(path, self.root, self.home)
        if key in self.cache:
            return self.cache[key][0]
        try:
            if len(self.cache) >= self.limits.files:
                raise ValueError('source file count limit exceeded')
            remaining = self.limits.total_bytes - self.bytes
            if remaining <= 0:
                raise ValueError('aggregate source byte limit exhausted')
            with open(path, 'rb') as stream:
                raw = stream.read(min(self.limits.file_bytes + 1, remaining))
                self.bytes += len(raw)  # Failed/oversized/invalid reads still consumed I/O.
                if len(raw) > self.limits.file_bytes or os.fstat(stream.fileno()).st_size > len(raw):
                    raise ValueError('source byte limit exceeded; partial source ignored')
            text = raw.decode('utf-8-sig')
            self.cache[key] = (text, _hash(raw))
            return text
        except (OSError, UnicodeError, ValueError) as error:
            self.issue('source_read', key, f'{type(error).__name__}: {error}')
            self.cache[key] = ('', None)
            return ''

    def glob(self, pattern):
        # The trusted scanner currently asks only for <root>/*/SKILL.md.
        # glob swallows traversal errors and counts only matches; inspect every
        # root entry explicitly. An incomplete root contributes no arbitrary
        # filesystem-order subset; other completed roots remain usable.
        target = Path(pattern)
        if target.name != 'SKILL.md' or target.parent.name != '*':
            self.issue('discovery_pattern', pattern, 'unsupported upstream pattern')
            return []
        base, matches = target.parent.parent, []
        try:
            with os.scandir(base) as entries:
                for entry in entries:
                    self.entries += 1
                    if self.entries > self.limits.directory_entries:
                        self.issue('discovery_limit', str(base), 'directory entry limit exceeded; incomplete root omitted')
                        return []
                    if entry.name.startswith('.') or not entry.is_dir():
                        continue
                    skill = Path(entry.path) / 'SKILL.md'
                    try:
                        if stat.S_ISREG(skill.stat().st_mode):
                            matches.append(str(skill))
                    except FileNotFoundError:
                        continue  # A directory need not contain a skill.
                    except OSError as error:
                        self.issue('directory_read', str(skill), str(error))
                    if len(matches) > self.limits.files:
                        self.issue('discovery_limit', str(base), 'file limit exceeded; incomplete root omitted')
                        return []
        except FileNotFoundError:
            return []  # Missing optional host roots are ordinary.
        except OSError as error:
            self.issue('directory_read', str(base), str(error))
            return []
        return sorted(matches)

    def walk(self, base):
        # os.walk's interface preserves upstream pruning while bounding each
        # scandir iteration rather than materializing an unlimited directory.
        pending = [str(base)]
        while pending:
            directory, dirs, files = pending.pop(), [], []
            try:
                with os.scandir(directory) as entries:
                    for entry in entries:
                        self.entries += 1
                        if self.entries > self.limits.directory_entries:
                            self.issue('discovery_limit', str(base), 'directory entry limit exceeded')
                            return
                        (dirs if entry.is_dir(follow_symlinks=False) else files).append(entry.name)
            except OSError as error:
                self.issue('directory_read', directory, str(error))
                continue
            dirs.sort()
            files.sort()
            yield directory, dirs, files
            pending.extend(os.path.join(directory, name) for name in reversed(dirs))

    def isfile(self, path):
        # Upstream's optional registry/catalog probes must distinguish absence
        # from access errors; os.path.isfile silently suppresses both.
        try:
            return stat.S_ISREG(os.stat(path).st_mode)
        except (FileNotFoundError, NotADirectoryError):
            return False
        except OSError as error:
            self.issue('source_stat', source_key(path, self.root, self.home), str(error))
            return False

    def module(self):
        script = ROOT / '.agents/skills/skills-graph/scripts/skills_graph.py'
        spec = importlib.util.spec_from_file_location('_catalog_trusted_graph', script)
        graph = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(graph)
        graph.read = self.read
        graph.glob = SimpleNamespace(glob=self.glob)
        graph.os = SimpleNamespace(path=SimpleNamespace(**{**vars(os.path), 'isfile': self.isfile}), walk=self.walk)
        return graph


def _version(text, fm):
    value = fm.get('version')
    if not value:
        front = text[3:text.find('\n---', 3)] if text.startswith('---') and '\n---' in text[3:] else ''
        block = re.search(r'^metadata:\s*\n((?:[ \t]+[^\n]*(?:\n|$))*)', front, re.M)
        match = re.search(r'^  version:\s*[\"\']?([A-Za-z0-9][A-Za-z0-9.+_-]*)[\"\']?\s*$', block[1], re.M) if block else None
        value = match[1] if match else None
    return value or None


def _metadata(row, overlays, discovery):
    values = {field: None for field in META_FIELDS}
    entry = overlays.get(row['source_key'])
    status = 'missing'
    if entry:
        status = 'current' if entry['source_sha256'] == row['source_sha256'] else 'stale'
        if status == 'current':
            values.update(entry['metadata'])
        else:
            discovery.issue('stale_overlay', row['source_key'], 'source hash changed; curated metadata ignored', 'warning')
    row.update(metadata=values, curation=status)
    row['metadata_gaps'] = [field for field, value in values.items() if value is None]
    row['metadata_gaps'] += [field for field in ('description', 'license', 'compatibility', 'version') if row[field] is None]
    row['authority'] = dict(AUTHORITY)
    row['runnable'] = False


def build_snapshot(*, home, root, data=None, overlay=None, generated_at=None, limits=None):
    """Scan trusted discovery once, retaining canonical variants and explicit gaps."""
    limits = limits or Limits()
    if not isinstance(limits, Limits):
        raise ValueError('limits must be a Limits instance')
    root, home = _canonical(root), _canonical(home)
    data = Path(data) if data is not None else root / '.agents/skills/skills-graph'
    overlays = validate_overlay(overlay if overlay is not None else {'schema_version': 1, 'entries': []})
    scan = _Discovery(root, home, limits)
    graph = scan.module()
    try:
        paths = graph.skill_files(str(home), str(root))
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        scan.issue('discovery_failed', 'skills_graph.skill_files', f'{type(error).__name__}: {error}')
        paths = []
    if len(paths) > limits.files:
        scan.issue('source_count', 'skills_graph.skill_files', f'{len(paths)} discovered paths exceeds {limits.files}')
        paths = paths[:limits.files]
    graph.skill_files = lambda *_: paths  # Reuse the same identity set inside build.
    rows = {}
    for path, host in paths:
        key = source_key(path, root, home)
        if key in rows:
            if host not in rows[key]['hosts']:
                rows[key]['hosts'].append(host)
            continue
        if len(rows) >= limits.rows:
            scan.issue('row_limit', 'installed', 'installed rows truncated')
            break
        text = scan.read(path)
        fm = graph.frontmatter(text)
        digest = scan.cache.get(key, ('', None))[1]
        rows[key] = {'skill_id': _skill_id('installed', key), 'name': fm.get('name') or Path(path).parent.name,
                     'source_key': key, 'source_path': _canonical(path).as_posix(), 'source_url': None,
                     'source_sha256': digest, 'ring': 'installed', 'hosts': [host],
                     'description': fm.get('description') or None, 'license': fm.get('license') or None,
                     'compatibility': fm.get('compatibility') or None, 'version': _version(text, fm),
                     'availability': 'installed' if digest else 'unreadable'}
        if not fm:
            scan.issue('frontmatter_missing', key, 'no parseable frontmatter; folder name retained', 'warning')
    try:
        built = graph.build(str(home), str(root), str(data))
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        scan.issue('graph_build_failed', 'skills_graph.build', f'{type(error).__name__}: {error}')
        built = {'nodes': [], 'edges': [], 'warnings': []}
    for node in built['nodes']:
        if node.get('ring') == 'installed':
            if not any(row['name'] == node['id'] for row in rows.values()):
                scan.issue('installed_source_absent', node['id'], 'graph claims installed without an observed canonical source')
            continue  # The graph merges names; canonical rows above are authoritative.
        if len(rows) >= limits.rows:
            scan.issue('row_limit', 'graph', 'catalog/remote/missing rows truncated')
            break
        ring = node.get('ring', 'unknown')
        if ring not in ('catalog', 'remote', 'missing'):
            scan.issue('unknown_ring', node['id'], f'unsupported discovery ring: {ring!r}')
            ring = 'unknown'
        key = 'graph:' + ring + ':' + node['id']
        content = {k: v for k, v in node.items() if k != 'fetched'}
        rows[key] = {'skill_id': _skill_id(ring, key), 'name': node['id'], 'source_key': key,
                     'source_path': node.get('source'), 'source_url': node.get('url') or None,
                     'source_sha256': _hash(content), 'ring': ring, 'hosts': sorted(node.get('hosts', [])),
                     'description': node.get('description') or None, 'license': node.get('license') or None,
                     'compatibility': node.get('compatibility') or None, 'version': node.get('version') or None,
                     'availability': 'not_installed' if ring in ('catalog', 'remote') else 'unknown'}
    for row in rows.values():
        row['hosts'].sort()
        _metadata(row, overlays, scan)
    for key in overlays.keys() - rows.keys():
        scan.issue('overlay_source_absent', key, 'overlay has no observed source', 'warning')
    by_name = {}
    for row in rows.values():
        by_name.setdefault(row['name'], []).append(row['skill_id'])
    if len(built['edges']) > limits.relations:
        scan.issue('relation_limit', 'graph', 'graph relations truncated')
    relations = []
    for edge in built['edges'][:limits.relations]:
        sources, targets = sorted(by_name.get(edge['from'], [])), sorted(by_name.get(edge['to'], []))
        relations.append({'from_graph_id': edge['from'], 'to_graph_id': edge['to'], 'from_skill_ids': sources,
                          'to_skill_ids': targets, 'type': edge['type'], 'source': edge.get('source'),
                          'resolution': 'exact' if len(sources) == len(targets) == 1 else 'ambiguous' if sources and targets else 'missing',
                          'proposed': str(edge.get('source', '')).startswith('proposal:'),
                          'evidence': {k: v for k, v in edge.items() if k not in ('from', 'to', 'type', 'source')}})
    for warning in built.get('warnings', []):
        scan.issue('graph_warning', 'skills_graph.build', warning, 'warning')
    ordered = sorted(rows.values(), key=lambda row: row['skill_id'])
    payload = {'schema_version': SCHEMA_VERSION, 'rows': ordered,
               'relations': sorted(relations, key=_json), 'issues': sorted(scan.issues, key=_json),
               'coverage': {'complete_for_discovery_scope': not any(issue['severity'] == 'error' for issue in scan.issues),
                            'scope': DISCOVERY_SCOPE,
                            'discovered_paths': len(paths), 'canonical_installed_sources': sum(row['ring'] == 'installed' for row in ordered),
                            'rows': len(ordered), 'curated_rows': sum(row['curation'] == 'current' for row in ordered)}}
    return {**payload, 'snapshot_id': 'sha256:' + _hash(payload),
            'generated_at': generated_at or datetime.now(timezone.utc).isoformat()}


def validate_snapshot(snapshot):
    """Validate internal generator consistency, not authenticity or a signature."""
    if not isinstance(snapshot, dict) or snapshot.get('schema_version') != SCHEMA_VERSION or type(snapshot.get('schema_version')) is not int:
        raise ValueError('unsupported snapshot schema')
    expected = {'schema_version', 'rows', 'relations', 'coverage', 'issues', 'snapshot_id', 'generated_at'}
    if set(snapshot) != expected or not isinstance(snapshot['rows'], list) or len(snapshot['rows']) > 6000 or not isinstance(snapshot['relations'], list) or len(snapshot['relations']) > 20_000:
        raise ValueError('invalid snapshot structure/size')
    coverage = snapshot['coverage']
    coverage_fields = {'complete_for_discovery_scope', 'scope', 'discovered_paths', 'canonical_installed_sources', 'rows', 'curated_rows'}
    if not isinstance(coverage, dict) or set(coverage) != coverage_fields or type(coverage['complete_for_discovery_scope']) is not bool or coverage['scope'] != DISCOVERY_SCOPE or not isinstance(snapshot['issues'], list) or len(snapshot['issues']) > 20_000 or not isinstance(snapshot['generated_at'], str):
        raise ValueError('invalid coverage/issues/generation metadata')
    for field in ('discovered_paths', 'canonical_installed_sources', 'rows', 'curated_rows'):
        if type(coverage[field]) is not int or not 0 <= coverage[field] <= 6000:
            raise ValueError('invalid coverage count')
    for issue in snapshot['issues']:
        if not isinstance(issue, dict) or set(issue) != {'code', 'source', 'detail', 'severity'} or issue['severity'] not in ('error', 'warning') or any(not isinstance(issue[field], str) or len(issue[field]) > 1_048_576 for field in ('code', 'source', 'detail')):
            raise ValueError('invalid issue shape')
    if coverage['complete_for_discovery_scope'] != (not any(issue['severity'] == 'error' for issue in snapshot['issues'])):
        raise ValueError('coverage contradicts recorded errors')
    ids = set()
    metadata_entries = []
    expected_row = {'skill_id', 'name', 'source_key', 'source_path', 'source_url', 'source_sha256', 'ring', 'hosts',
                    'description', 'license', 'compatibility', 'version', 'availability', 'metadata', 'curation',
                    'metadata_gaps', 'authority', 'runnable'}
    for row in snapshot['rows']:
        if not isinstance(row, dict) or set(row) != expected_row or not isinstance(row['skill_id'], str) or row['skill_id'] in ids or not isinstance(row['name'], str) or not row['name'] or not isinstance(row['metadata'], dict) or set(row['metadata']) != set(META_FIELDS) or row['runnable'] is not False or row['authority'] != AUTHORITY:
            raise ValueError('invalid discovery row or authority claim')
        if row['ring'] not in ('installed', 'catalog', 'remote', 'missing', 'unknown') or row['curation'] not in ('current', 'stale', 'missing') or not isinstance(row['source_key'], str) or row['skill_id'] != _skill_id(row['ring'], row['source_key']):
            raise ValueError('invalid discovery identity/ring/curation')
        for field in ('source_path', 'source_url', 'description', 'license', 'compatibility', 'version'):
            if row[field] is not None and (not isinstance(row[field], str) or len(row[field]) > 1_048_576):
                raise ValueError('invalid source metadata field')
        if row['source_sha256'] is not None and (not isinstance(row['source_sha256'], str) or not re.fullmatch('[0-9a-f]{64}', row['source_sha256'])):
            raise ValueError('invalid source hash')
        if not isinstance(row['hosts'], list) or any(not isinstance(host, str) for host in row['hosts']) or not isinstance(row['metadata_gaps'], list) or any(not isinstance(gap, str) for gap in row['metadata_gaps']):
            raise ValueError('invalid host/gap lists')
        expected_availability = ('installed', 'unreadable') if row['ring'] == 'installed' else ('not_installed',) if row['ring'] in ('catalog', 'remote') else ('unknown',)
        if row['availability'] not in expected_availability:
            raise ValueError('invalid availability claim')
        if (row['availability'] == 'unreadable') != (row['source_sha256'] is None):
            raise ValueError('source hash contradicts availability')
        if row['hosts'] != sorted(set(row['hosts'])) or len(row['hosts']) > 4096:
            raise ValueError('host associations must be unique and sorted')
        if row['curation'] != 'current' and any(value is not None for value in row['metadata'].values()):
            raise ValueError('uncurated/stale metadata cannot be active')
        if row['curation'] == 'current' and row['source_sha256'] is None:
            raise ValueError('curation requires an observed source hash')
        expected_gaps = [field for field, value in row['metadata'].items() if value is None]
        expected_gaps += [field for field in ('description', 'license', 'compatibility', 'version') if row[field] is None]
        if set(row['metadata_gaps']) != set(expected_gaps) or len(row['metadata_gaps']) != len(expected_gaps):
            raise ValueError('metadata gaps contradict row content')
        metadata_entries.append({'source_key': row['source_key'], 'source_sha256': row['source_sha256'] or '0' * 64,
                                 'metadata': {key: value for key, value in row['metadata'].items() if value is not None}})
        ids.add(row['skill_id'])
    validate_overlay({'schema_version': 1, 'entries': metadata_entries})
    if coverage['rows'] != len(snapshot['rows']) or coverage['canonical_installed_sources'] != sum(row['ring'] == 'installed' for row in snapshot['rows']) or coverage['curated_rows'] != sum(row['curation'] == 'current' for row in snapshot['rows']) or coverage['discovered_paths'] < coverage['canonical_installed_sources']:
        raise ValueError('coverage counts contradict rows')
    edge_fields = {'from_graph_id', 'to_graph_id', 'from_skill_ids', 'to_skill_ids', 'type', 'source', 'resolution', 'proposed', 'evidence'}
    by_name = {}
    for row in snapshot['rows']:
        by_name.setdefault(row['name'], []).append(row['skill_id'])
    for edge in snapshot['relations']:
        if not isinstance(edge, dict) or set(edge) != edge_fields or not isinstance(edge['from_skill_ids'], list) or not isinstance(edge['to_skill_ids'], list) or any(not isinstance(item, str) or item not in ids for item in edge['from_skill_ids'] + edge['to_skill_ids']):
            raise ValueError('invalid relation identity')
        if any(not isinstance(edge[field], str) or not edge[field] or len(edge[field]) > 4096 for field in ('from_graph_id', 'to_graph_id', 'type')) or (edge['source'] is not None and not isinstance(edge['source'], str)) or type(edge['proposed']) is not bool or not isinstance(edge['evidence'], dict) or len(_json(edge['evidence'])) > 1_048_576:
            raise ValueError('invalid relation shape')
        sources, targets = edge['from_skill_ids'], edge['to_skill_ids']
        resolution = 'exact' if len(sources) == len(targets) == 1 else 'ambiguous' if sources and targets else 'missing'
        if sources != sorted(by_name.get(edge['from_graph_id'], [])) or targets != sorted(by_name.get(edge['to_graph_id'], [])) or edge['resolution'] != resolution or edge['proposed'] != str(edge['source'] or '').startswith('proposal:'):
            raise ValueError('relation resolution/proposal contradicts source identities')
    payload = {key: value for key, value in snapshot.items() if key not in ('generated_at', 'snapshot_id')}
    if snapshot['snapshot_id'] != 'sha256:' + _hash(payload):
        raise ValueError('snapshot content hash mismatch')
    return snapshot


def write_snapshot(snapshot, destination):
    """Validate then replace atomically; failures never replace the prior snapshot."""
    validate_snapshot(snapshot)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=destination.name + '.', suffix='.tmp', dir=destination.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
            stream.write(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _load_json(path, max_bytes=32_000_000):
    with open(path, 'rb') as stream:
        raw = stream.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ValueError('JSON input exceeds byte limit')
    return json.loads(raw.decode('utf-8-sig'))


def _normalize(text):
    text = ''.join(char for char in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(char))
    return ' '.join(re.findall(r'[a-z0-9]+', text))


def query_snapshot(snapshot, text, limit=8, host=None, *, ring=None, offset=0):
    validate_snapshot(snapshot)
    if not isinstance(text, str) or len(text) > 4096 or type(limit) is not int or not 1 <= limit <= 50 or (host is not None and (not isinstance(host, str) or len(host) > 120)):
        raise ValueError('query text/limit/host is invalid')
    if ring not in (None, 'installed', 'catalog', 'remote', 'missing', 'unknown') or type(offset) is not int or not 0 <= offset <= 6000:
        raise ValueError('query ring/offset is invalid')
    phrase = _normalize(text)
    words = set(phrase.split()) - STOP
    results = []
    for row in snapshot['rows']:
        if ring is not None and row['ring'] != ring:
            continue
        meta = row['metadata']
        aliases = [alias for terms in (meta.get('aliases') or {}).values() for alias in terms]
        exact_name = bool(phrase) and phrase == _normalize(row['name'])
        exact_alias = bool(phrase) and phrase in {_normalize(alias) for alias in aliases}
        fields = [row['name'], row.get('description') or '', meta.get('functional_description') or '', *aliases]
        for field in (field for field in LIST_FIELDS if field != 'when_to_avoid'):
            fields.extend(meta.get(field) or [])
        for cases in (meta.get('use_cases') or {}).values():
            fields.extend(cases)
        matched = sorted(words & set(_normalize(' '.join(fields)).split()))
        score = (100 if exact_name else 0) + (80 if exact_alias else 0) + len(matched)
        if not score:
            continue
        results.append({'skill_id': row['skill_id'], 'name': row['name'], 'source_key': row['source_key'],
                        'relevance': {'score': score, 'exact_name': exact_name, 'exact_alias': exact_alias, 'matched_terms': matched},
                        'availability': {'status': row['availability'], 'ring': row['ring'], 'discovered_hosts': row['hosts'],
                                         'requested_host': host, 'host_match': 'observed' if host and host in row['hosts'] else 'unknown'},
                        'authority': dict(row['authority']), 'runnable': False, 'curation': row['curation']})
    results.sort(key=lambda result: (-result['relevance']['score'], result['availability']['host_match'] != 'observed', result['availability']['status'] != 'installed', result['skill_id']))
    return {'snapshot_id': snapshot['snapshot_id'], 'query': text, 'abstained': not results,
            'total': len(results), 'results': results[offset:offset + limit]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest='command', required=True)
    build = sub.add_parser('build')
    build.add_argument('--home', default=str(Path.home()))
    build.add_argument('--root', default=str(ROOT))
    build.add_argument('--data')
    build.add_argument('--overlay')
    build.add_argument('--out', required=True)
    query = sub.add_parser('query')
    query.add_argument('snapshot')
    query.add_argument('text')
    query.add_argument('--limit', type=int, default=8)
    query.add_argument('--host')
    args = parser.parse_args(argv)
    try:
        if args.command == 'build':
            overlay = _load_json(args.overlay, 8_000_000) if args.overlay else None
            snapshot = build_snapshot(home=args.home, root=args.root, data=args.data, overlay=overlay)
            write_snapshot(snapshot, args.out)
            print(_json({'snapshot_id': snapshot['snapshot_id'], 'coverage': snapshot['coverage'], 'issues': snapshot['issues']}))
            return 0 if snapshot['coverage']['complete_for_discovery_scope'] else 1
        print(_json(query_snapshot(_load_json(args.snapshot), args.text, args.limit, args.host)))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f'catalog: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
