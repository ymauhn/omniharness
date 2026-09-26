"""Portable profile metadata and reviewed, versioned task pins; never an executor.

The caller supplies host availability and sanitized, explicitly selected excerpts.
No credential/session discovery, model invocation, native export or permission
grant occurs here. A local cooperating-writer lock protects compare-and-swap;
this is not OS isolation or a cryptographically authenticated approval ledger.
"""
import argparse
import copy
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from harness.fsutil import write_atomic

PILLARS = ('engineering', 'orchestration-os', 'science-thesis', 'education-community', 'technical-marketing')
HOSTS = ('codex', 'claude', 'hermes')
AUTHORITY = 'task-and-host-policy-only'
MAX_STORE_BYTES = 2_097_152
MAX_PROFILE_BYTES = 32_768
MAX_EVENTS = 1024
MAX_PROFILES = 32
MAX_VERSIONS = 16
MAX_PINS = 128
BUILTINS = Path(__file__).with_name('agent_profiles.json')


class ValidationError(ValueError):
    pass


class ConflictError(ValidationError):
    pass


class LockedError(ConflictError):
    """The writer lock exists: a live write or one left by an interrupted writer."""


class DamagedError(ValidationError):
    """The persisted registry itself is unreadable; the request was not at fault."""


class CapacityError(ValidationError):
    """The documented event or byte bound is reached; history was retained."""


def _require(condition, message):
    if not condition:
        raise ValidationError(message)


def _keys(value, keys):
    _require(type(value) is dict and set(value) == set(keys.split()), 'Unexpected or missing fields')


def _text(value, limit=512):
    _require(type(value) is str and bool(value.strip()) and len(value) <= limit, 'Text must be nonempty and bounded')
    _require(not any(ord(c) < 32 and c not in '\n\t' for c in value), 'Control characters are not allowed')
    try:
        value.encode('utf-8')
    except UnicodeError as exc:
        raise ValidationError('Invalid Unicode') from exc
    return value


def _id(value):
    _require(type(value) is str and re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,79}', value), 'Invalid stable identifier')
    return value


def _integer(value, minimum=1, maximum=MAX_EVENTS):
    _require(type(value) is int and minimum <= value <= maximum, 'Invalid bounded integer')


def _list(value, limit=16, minimum=0, item_limit=512):
    _require(type(value) is list and minimum <= len(value) <= limit, 'List must be bounded')
    for item in value:
        _text(item, item_limit)
    _require(len(set(value)) == len(value), 'Duplicate values are not allowed')


def _sha(value):
    _require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value), 'Invalid SHA-256')


def _encode(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (ValueError, TypeError, UnicodeError, RecursionError) as exc:
        raise ValidationError('Invalid JSON value') from exc


def digest(value):
    return hashlib.sha256(_encode(value)).hexdigest()


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def _read_json(path, limit=MAX_STORE_BYTES):
    with Path(path).open('rb') as stream:
        raw = stream.read(limit + 1)
    _require(len(raw) <= limit, 'JSON file exceeds byte limit')
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValidationError('Nonfinite JSON number')))
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise ValidationError('Invalid JSON document') from exc


def validate_profile(profile):
    _require(len(_encode(profile)) <= MAX_PROFILE_BYTES, 'Profile exceeds byte limit')
    _keys(profile, 'id version name pillar purpose suggested_hosts intents skills tools context inputs outputs rules test_cases provenance authority')
    _id(profile['id']); _integer(profile['version'], maximum=MAX_VERSIONS)
    _text(profile['name'], 100); _text(profile['purpose'])
    _require(profile['pillar'] in PILLARS and profile['authority'] == AUTHORITY, 'Invalid pillar or authority')
    for key in ('suggested_hosts', 'intents', 'skills', 'tools', 'context', 'inputs', 'outputs'):
        _list(profile[key], 8, minimum=1 if key in ('suggested_hosts', 'intents', 'inputs', 'outputs') else 0)
    _require(all(host in HOSTS for host in profile['suggested_hosts']), 'Unknown host')
    _require(all(intent == intent.strip().casefold() for intent in profile['intents']), 'Intents must be normalized exact labels')
    _keys(profile['provenance'], 'method sources selected_source_ids template')
    provenance = profile['provenance']
    _require(provenance['method'] in ('original-authorship-v1', 'deterministic-extraction-v1'), 'Unknown provenance method')
    _list(provenance['selected_source_ids'], 16, 1, 80)
    sources = provenance['sources']
    _require(type(sources) is list and 1 <= len(sources) <= 16, 'Missing or excessive provenance sources')
    by_id = {}
    for source in sources:
        _keys(source, 'id kind reference sha256 session_id')
        _id(source['id']); _text(source['reference'], 256); _sha(source['sha256'])
        _require(source['id'] not in by_id, 'Duplicate source ID')
        _require(source['kind'] in ('authored', 'accepted_decision', 'experiment', 'rejected', 'quoted'), 'Unknown source kind')
        if provenance['method'] == 'original-authorship-v1':
            _require(source['kind'] == 'authored' and source['session_id'] is None, 'Authored provenance cannot impersonate sessions')
        else:
            _require(source['kind'] != 'authored', 'Session provenance cannot impersonate authorship')
            _id(source['session_id'])
        by_id[source['id']] = source
    _require(set(by_id) == set(provenance['selected_source_ids']), 'Provenance must match the exact selection')
    template = provenance['template']
    if provenance['method'] == 'original-authorship-v1':
        _require(template is None, 'Original profiles have no synthesized template')
    else:
        _keys(template, 'id version sha256')
        _id(template['id']); _integer(template['version'], maximum=MAX_VERSIONS); _sha(template['sha256'])
    rules = profile['rules']
    _require(type(rules) is list and 1 <= len(rules) <= 16, 'Rules must be nonempty and bounded')
    rule_ids = set()
    for rule in rules:
        _keys(rule, 'id text source_ids')
        _id(rule['id']); _text(rule['text']); _list(rule['source_ids'], 16, 1, 80)
        _require(rule['id'] not in rule_ids, 'Duplicate rule ID'); rule_ids.add(rule['id'])
        _require(all(sid in by_id and by_id[sid]['kind'] in ('authored', 'accepted_decision') for sid in rule['source_ids']),
                 'Rules may cite only selected authored material or accepted decisions')
    cases = profile['test_cases']
    _require(type(cases) is list and 2 <= len(cases) <= 8, 'Routing examples must be bounded')
    outcomes = set()
    for case in cases:
        _keys(case, 'intent matches'); _text(case['intent'], 100)
        _require(type(case['matches']) is bool and case['matches'] == (case['intent'].strip().casefold() in profile['intents']),
                 'Routing example disagrees with exact intent labels')
        outcomes.add(case['matches'])
    _require(outcomes == {True, False}, 'Both positive and negative routing examples are required')
    return profile


def builtin_profiles():
    document = _read_json(BUILTINS)
    _keys(document, 'schema_version profiles')
    _require(type(document['schema_version']) is int and document['schema_version'] == 1, 'Unknown built-in schema')
    _require(type(document['profiles']) is list and len(document['profiles']) == 5, 'Five built-in profiles are required')
    profiles = [validate_profile(profile) for profile in document['profiles']]
    _require(len({p['id'] for p in profiles}) == 5 and {p['pillar'] for p in profiles} == set(PILLARS), 'Built-in coverage is invalid')
    return profiles


def synthesize(template, *, profile_id, name, selected_source_ids, excerpts):
    """Copy accepted decisions verbatim into an unreviewed candidate, not semantic extraction.

    `sanitized=True` is the caller's attestation, not a secret-detector guarantee.
    Nonaccepted text is hashed then discarded; no session lookup is available.
    """
    validate_profile(template); _id(profile_id); _text(name, 100)
    _list(selected_source_ids, 16, 1, 80)
    _require(type(excerpts) is list and 1 <= len(excerpts) <= 16, 'Explicit excerpts are required')
    sources, rules, seen = [], [], set()
    total = 0
    for excerpt in excerpts:
        _keys(excerpt, 'id session_id kind text sanitized reference')
        _id(excerpt['id']); _id(excerpt['session_id']); _text(excerpt['text'], 2048); _text(excerpt['reference'], 256)
        _require(excerpt['sanitized'] is True, 'The caller must supply sanitized material')
        _require(excerpt['id'] in selected_source_ids and excerpt['id'] not in seen, 'Unselected or duplicate excerpt')
        _require(excerpt['kind'] in ('accepted_decision', 'experiment', 'rejected', 'quoted'), 'Unknown excerpt classification')
        seen.add(excerpt['id']); raw = excerpt['text'].encode('utf-8'); total += len(raw)
        _require(total <= 16_384, 'Selected text exceeds total byte limit')
        sources.append({key: excerpt[key] for key in ('id', 'session_id', 'kind', 'reference')} | {'sha256': hashlib.sha256(raw).hexdigest()})
        if excerpt['kind'] == 'accepted_decision':
            _text(excerpt['text'])
            rules.append({'id': f'rule-{len(rules) + 1}', 'text': excerpt['text'], 'source_ids': [excerpt['id']]})
    _require(seen == set(selected_source_ids), 'Missing selected excerpt')
    _require(rules, 'No accepted decisions to turn into candidate rules')
    profile = copy.deepcopy(template)
    profile.update(id=profile_id, version=1, name=name, rules=rules, provenance={
        'method': 'deterministic-extraction-v1', 'sources': sources, 'selected_source_ids': list(selected_source_ids),
        'template': {'id': template['id'], 'version': template['version'], 'sha256': digest(template)}})
    return validate_profile(profile)


def _replay(document):
    _keys(document, 'schema_version revision events')
    _require(type(document['schema_version']) is int and document['schema_version'] == 1, 'Unknown registry schema')
    _integer(document['revision'], 0)
    events = document['events']
    _require(type(events) is list and len(events) == document['revision'] <= MAX_EVENTS, 'Invalid event revision')
    profiles, pins = {}, {}
    for sequence, event in enumerate(events, 1):
        _keys(event, 'sequence action actor at data'); _text(event['actor'], 100); _text(event['at'], 40)
        _require(type(event['sequence']) is int and event['sequence'] == sequence, 'Nonsequential event history')
        try:
            _require(datetime.fromisoformat(event['at']).utcoffset() is not None, 'Timestamp needs a timezone')
        except ValueError as exc:
            raise ValidationError('Invalid timestamp') from exc
        data, action = event['data'], event['action']
        if action == 'draft':
            _keys(data, 'profile content_sha256'); p = validate_profile(data['profile'])
            _require(data['content_sha256'] == digest(p), 'Profile content hash mismatch')
            item = profiles.setdefault(p['id'], {'versions': [], 'active_version': None, 'last_active_version': None, 'disabled': False})
            _require(len(profiles) <= MAX_PROFILES and p['version'] == len(item['versions']) + 1, 'Profile limit or nonsequential version')
            item['versions'].append({'profile': p, 'content_sha256': data['content_sha256'], 'review': None})
            continue
        fields = {'review': 'id version content_sha256 source_rules', 'activate': 'id version',
                  'rollback': 'id version', 'disable': 'id',
                  'pin': 'id task_id project_id host available_hosts'}
        _require(type(action) is str and action in fields, 'Unknown lifecycle action')
        _keys(data, fields[action]); _id(data['id'])
        _require(data['id'] in profiles, 'Unknown profile')
        item = profiles[data['id']]
        if action in ('review', 'activate', 'rollback'):
            _integer(data['version'], maximum=len(item['versions']))
            version = item['versions'][data['version'] - 1]
            if action == 'review':
                expected = {r['id']: r['source_ids'] for r in version['profile']['rules']}
                _require(version['review'] is None and data['content_sha256'] == version['content_sha256'] and
                         data['source_rules'] == expected, 'Review must bind the exact content and every source-to-rule mapping')
                version['review'] = {'actor': event['actor'], 'at': event['at'], 'sequence': sequence}
            else:
                _require(version['review'] is not None, 'Only reviewed versions can be activated')
                if action == 'rollback':
                    _require(item['last_active_version'] is not None and data['version'] < item['last_active_version'], 'Rollback must target an earlier reviewed version')
                item['active_version'], item['last_active_version'], item['disabled'] = data['version'], data['version'], False
        elif action == 'disable':
            _require(item['active_version'] is not None, 'Profile is not active')
            item['active_version'], item['disabled'] = None, True
        else:
            _id(data['task_id']); _id(data['project_id']); _list(data['available_hosts'], 3, item_limit=20)
            _require(all(host in HOSTS for host in data['available_hosts']), 'Unknown availability observation')
            _require(item['active_version'] is not None, 'Profile is not active')
            version = item['versions'][item['active_version'] - 1]
            _require(data['host'] in version['profile']['suggested_hosts'] and data['host'] in data['available_hosts'], 'Requested host is unavailable or unsupported')
            _require(data['task_id'] not in pins and len(pins) < MAX_PINS, 'Task pin already exists or pin limit reached')
            pins[data['task_id']] = {'task_id': data['task_id'], 'project_id': data['project_id'], 'host': data['host'],
                'profile_id': data['id'], 'version': item['active_version'], 'content_sha256': version['content_sha256'],
                'profile': version['profile'], 'registry_revision': sequence, 'created_at': event['at'], 'runnable': False, 'authority': AUTHORITY}
    return profiles, pins


class Registry:
    """Bounded single-file event history. Failed writes leave committed state intact.

    A leftover .lock after a crash requires operator inspection; never automatically
    break a possibly live lock. All writers must use this API. Review records are
    caller assertions, not authenticated identities or host approvals.
    """
    def __init__(self, path):
        self.path = Path(path)

    def _read(self):
        try:
            try:
                document = _read_json(self.path)
            except FileNotFoundError:
                document = {'schema_version': 1, 'revision': 0, 'events': []}
            profiles, pins = _replay(document)
        except ValidationError as exc:
            raise DamagedError('Persisted registry is unreadable; it was retained for inspection') from exc
        return document, profiles, pins

    def _append(self, action, data, expected_revision, actor):
        _integer(expected_revision, 0); _text(actor, 100)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock = self.path.with_name(self.path.name + '.lock')
        try:
            handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except (FileExistsError, PermissionError) as exc:
            # Windows reports a lock another writer is deleting as access denied: busy there, a real error elsewhere.
            if isinstance(exc, PermissionError) and os.name != 'nt':
                raise
            raise LockedError('Registry writer is busy; inspect a persistent lock before recovery') from exc
        try:
            os.close(handle)
            document, _, _ = self._read()
            if document['revision'] != expected_revision:
                raise ConflictError('Stale registry revision')
            if document['revision'] >= MAX_EVENTS:
                raise CapacityError('Registry event limit reached; history was retained')
            document['revision'] += 1
            document['events'].append({'sequence': document['revision'], 'action': action, 'actor': actor,
                'at': datetime.now(timezone.utc).isoformat(), 'data': copy.deepcopy(data)})
            _replay(document)
            raw = _encode(document)
            if len(raw) > MAX_STORE_BYTES:
                raise CapacityError('Registry byte limit reached; history was retained')
            write_atomic(self.path, raw, mode=0o600)
            return document['revision']
        finally:
            lock.unlink()

    def snapshot(self):
        document, profiles, _ = self._read()
        return {'revision': document['revision'], 'runnable': False, 'authority': AUTHORITY,
                'profiles': [{'id': key, 'name': item['versions'][(item['active_version'] or len(item['versions'])) - 1]['profile']['name'],
                    'pillar': item['versions'][(item['active_version'] or len(item['versions'])) - 1]['profile']['pillar'], 'latest_version': len(item['versions']),
                    'active_version': item['active_version'], 'state': 'active' if item['active_version'] else
                    'disabled' if item['disabled'] else 'reviewed' if item['versions'][-1]['review'] else 'draft'}
                    for key, item in sorted(profiles.items())]}

    def history(self):
        return copy.deepcopy(self._read()[0]['events'])

    def draft(self, profile, *, expected_revision, actor):
        validate_profile(profile)
        return self._append('draft', {'profile': profile, 'content_sha256': digest(profile)}, expected_revision, actor)

    def review(self, profile_id, version, *, content_sha256, source_rules, expected_revision, actor):
        return self._append('review', {'id': profile_id, 'version': version, 'content_sha256': content_sha256,
                                     'source_rules': source_rules}, expected_revision, actor)

    def activate(self, profile_id, version, *, expected_revision, actor):
        return self._append('activate', {'id': profile_id, 'version': version}, expected_revision, actor)

    def rollback(self, profile_id, version, *, expected_revision, actor):
        return self._append('rollback', {'id': profile_id, 'version': version}, expected_revision, actor)

    def disable(self, profile_id, *, expected_revision, actor):
        return self._append('disable', {'id': profile_id}, expected_revision, actor)

    def preview(self, profile_id, version):
        _, profiles, _ = self._read(); _id(profile_id)
        _require(profile_id in profiles, 'Unknown profile'); item = profiles[profile_id]
        _integer(version, maximum=len(item['versions'])); record = item['versions'][version - 1]
        profile = record['profile']; sources = {s['id']: s for s in profile['provenance']['sources']}
        return copy.deepcopy({'profile': profile, 'content_sha256': record['content_sha256'], 'review': record['review'],
            'runnable': False, 'authority': AUTHORITY,
            'rules': [r | {'sources': [sources[sid] for sid in r['source_ids']]} for r in profile['rules']]})

    def route(self, intent, host, available_hosts):
        """Exact declared-intent match only; no semantic ranking or native dispatch."""
        _text(intent, 100); _list(available_hosts, 3, item_limit=20)
        _require(host in HOSTS and all(h in HOSTS for h in available_hosts), 'Unknown host')
        if host not in available_hosts:
            return []
        _, profiles, _ = self._read()
        return [{'id': key, 'version': item['active_version'], 'runnable': False, 'authority': AUTHORITY}
                for key, item in sorted(profiles.items()) if item['active_version'] is not None
                and host in item['versions'][item['active_version'] - 1]['profile']['suggested_hosts']
                and intent.strip().casefold() in item['versions'][item['active_version'] - 1]['profile']['intents']]

    def instantiate(self, profile_id, *, task_id, project_id, host, available_hosts, expected_revision, actor):
        self._append('pin', {'id': profile_id, 'task_id': task_id, 'project_id': project_id,
                     'host': host, 'available_hosts': available_hosts}, expected_revision, actor)
        return self.get_pin(task_id)

    def get_pin(self, task_id):
        _id(task_id); pins = self._read()[2]
        _require(task_id in pins, 'Unknown task pin')
        return copy.deepcopy(pins[task_id])

    def find_pin(self, task_id, project_id):
        """Return a scoped pin or None; malformed registries still raise."""
        _id(task_id); _id(project_id)
        pin = self._read()[2].get(task_id)
        return copy.deepcopy(pin) if pin is not None and pin['project_id'] == project_id else None

    def list_pins(self, project_id):
        """Bounded project-filtered summaries, without duplicating pinned profiles."""
        _id(project_id)
        document, _, pins = self._read()
        fields = ('task_id', 'project_id', 'profile_id', 'version', 'host', 'content_sha256',
                  'registry_revision', 'created_at', 'runnable', 'authority')
        return {'revision': document['revision'], 'project_id': project_id,
                'pins': [{key: pin[key] for key in fields} for _, pin in sorted(pins.items())
                         if pin['project_id'] == project_id], 'runnable': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('builtins', 'list', 'history', 'draft', 'review', 'activate', 'disable', 'rollback', 'preview', 'route', 'instantiate', 'get-pin', 'synthesize'))
    parser.add_argument('--store', type=Path, help='Explicit project-local registry path; never a host agent registry')
    parser.add_argument('--input', type=Path, help='Explicit bounded JSON arguments; no session search')
    args = parser.parse_args(argv)
    try:
        payload = _read_json(args.input, 65_536) if args.input else {}
        if args.command == 'builtins':
            result = builtin_profiles()
        elif args.command == 'synthesize':
            _require(type(payload) is dict, 'JSON arguments must be an object')
            result = synthesize(**payload)
        else:
            _require(args.store is not None, 'An explicit store path is required')
            registry = Registry(args.store)
            method = {'list': 'snapshot', 'get-pin': 'get_pin'}.get(args.command, args.command)
            _require(type(payload) is dict, 'JSON arguments must be an object')
            result = getattr(registry, method)(**payload)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValidationError, OSError, TypeError) as exc:
        # Do not echo payloads, private text, paths or raw exception details.
        print(json.dumps({'error': 'conflict' if isinstance(exc, ConflictError) else 'invalid-or-unavailable'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
