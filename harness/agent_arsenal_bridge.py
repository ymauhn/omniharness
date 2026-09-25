"""Bounded stdin bridge from the local Lab to the existing agent arsenal.

Each project owns one registry file. The Lab authenticates callers and verifies
real project/task/host bindings before invoking this module. This bridge never
discovers sessions, dispatches models, or treats a review actor as an authority.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from harness.agent_arsenal import (
    ConflictError, Registry, ValidationError, _id, _pairs, builtin_profiles,
    synthesize, validate_profile,
)

MAX_REQUEST_BYTES = 65_536
PROJECT_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
ACTOR = 'local-owner'  # A local caller assertion, not authenticated review evidence.


class NotFoundError(ValueError):
    pass


def _fields(request, names):
    if type(request) is not dict or set(request) != set(names.split()):
        raise ValidationError('Invalid bridge request fields')


def _project(request, data_dir):
    project_id = request.get('projectId')
    if type(project_id) is not str or PROJECT_ID.fullmatch(project_id) is None:
        raise ValidationError('Invalid project ID')
    return Registry(Path(data_dir) / 'arsenal' / f'{project_id}.json')


def _builtin(identifier):
    if type(identifier) is not str:
        raise ValidationError('Invalid built-in ID')
    profile = next((item for item in builtin_profiles() if item['id'] == identifier), None)
    if profile is None:
        raise NotFoundError('Unknown built-in profile')
    return profile


def _changed(registry, revision, **extra):
    # A different writer may commit after our append releases its lock. The
    # response's revision must describe its included snapshot, not our event.
    snapshot = registry.snapshot()
    return {'revision': snapshot['revision'], 'snapshot': snapshot, **extra}


def handle(request, data_dir):
    """One strict operation; any project/task authorization is the Lab caller's duty."""
    if type(request) is not dict or type(request.get('op')) is not str:
        raise ValidationError('Invalid bridge request')
    op = request['op']
    if op == 'builtins':
        _fields(request, 'op')
        return {'profiles': builtin_profiles(), 'runnable': False}
    registry = _project(request, data_dir)
    if op == 'list':
        _fields(request, 'op projectId')
        return registry.snapshot()
    if op == 'preview':
        _fields(request, 'op projectId profileId version')
        return registry.preview(request['profileId'], request['version'])
    if op == 'import-builtin':
        _fields(request, 'op projectId builtinId expectedRevision')
        profile = _builtin(request['builtinId'])
        revision = registry.draft(profile, expected_revision=request['expectedRevision'], actor=ACTOR)
        return _changed(registry, revision, preview=registry.preview(profile['id'], profile['version']))
    if op == 'derive':
        _fields(request, 'op projectId templateId profileId name selectedSourceIds excerpts expectedRevision')
        template = _builtin(request['templateId'])
        profile = synthesize(template, profile_id=request['profileId'], name=request['name'],
                             selected_source_ids=request['selectedSourceIds'], excerpts=request['excerpts'])
        row = next((item for item in registry.snapshot()['profiles'] if item['id'] == profile['id']), None)
        if row is None and profile['id'] in {item['id'] for item in builtin_profiles()}:
            raise ValidationError('Import a built-in profile before extending it')
        if row is not None:
            profile['version'] = row['latest_version'] + 1
            validate_profile(profile)
        revision = registry.draft(profile, expected_revision=request['expectedRevision'], actor=ACTOR)
        return _changed(registry, revision, preview=registry.preview(profile['id'], profile['version']))
    if op == 'review':
        _fields(request, 'op projectId profileId version contentSha256 sourceRules expectedRevision')
        revision = registry.review(request['profileId'], request['version'],
                                   content_sha256=request['contentSha256'], source_rules=request['sourceRules'],
                                   expected_revision=request['expectedRevision'], actor=ACTOR)
        return _changed(registry, revision)
    if op in ('activate', 'rollback'):
        _fields(request, 'op projectId profileId version expectedRevision')
        revision = getattr(registry, op)(request['profileId'], request['version'],
                                         expected_revision=request['expectedRevision'], actor=ACTOR)
        return _changed(registry, revision)
    if op == 'disable':
        _fields(request, 'op projectId profileId expectedRevision')
        revision = registry.disable(request['profileId'], expected_revision=request['expectedRevision'], actor=ACTOR)
        return _changed(registry, revision)
    if op == 'pin':
        _fields(request, 'op projectId profileId taskId host availableHosts expectedRevision')
        pin = registry.instantiate(request['profileId'], task_id=request['taskId'], project_id=request['projectId'],
                                   host=request['host'], available_hosts=request['availableHosts'],
                                   expected_revision=request['expectedRevision'], actor=ACTOR)
        return _changed(registry, pin['registry_revision'], pin=pin)
    if op == 'get-pin':
        _fields(request, 'op projectId taskId')
        _id(request['taskId'])
        try:
            pin = registry.find_pin(request['taskId'], request['projectId'])
        except ValidationError as exc:
            raise OSError('Unreadable project arsenal') from exc
        if pin is None:
            raise NotFoundError('Task pin not found in this project')
        return pin
    if op == 'list-pins':
        _fields(request, 'op projectId')
        result = registry.list_pins(request['projectId'])
        return {'revision': result['revision'], 'projectId': result['project_id'],
                'pins': result['pins'], 'runnable': False}
    raise ValidationError('Unknown bridge operation')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise ValidationError('Bridge request exceeds byte limit')
        request = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                             parse_constant=lambda _: (_ for _ in ()).throw(ValidationError('Invalid number')))
        response = {'ok': True, 'result': handle(request, args.data_dir)}
    except ConflictError:
        response = {'ok': False, 'code': 'conflict'}
    except NotFoundError:
        response = {'ok': False, 'code': 'not_found'}
    except (ValidationError, TypeError, ValueError, KeyError, RecursionError, UnicodeError):
        response = {'ok': False, 'code': 'invalid'}
    except OSError:
        response = {'ok': False, 'code': 'unavailable'}
    sys.stdout.buffer.write((json.dumps(response, ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
