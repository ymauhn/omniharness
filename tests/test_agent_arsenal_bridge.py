"""Regression for the bridge's observed revision under a concurrent writer."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from harness import agent_arsenal as arsenal
from harness import agent_arsenal_bridge as bridge


class ArsenalBridgeTests(unittest.TestCase):
    def test_mutation_revision_matches_snapshot_after_interleaving_writer(self):
        project_id = '9e4b0afb-7554-4cc6-9724-8bceab68cb39'
        builtins = arsenal.builtin_profiles()
        with tempfile.TemporaryDirectory(prefix='omni-bridge-revision-') as data_dir:
            original_snapshot = arsenal.Registry.snapshot
            interleaved = []

            def snapshot_after_other_commit(registry):
                if not interleaved:
                    interleaved.append(True)
                    arsenal.Registry(registry.path).draft(builtins[1], expected_revision=1, actor='fixture-other')
                return original_snapshot(registry)

            with patch.object(arsenal.Registry, 'snapshot', snapshot_after_other_commit):
                result = bridge.handle({'op': 'import-builtin', 'projectId': project_id,
                                        'builtinId': builtins[0]['id'], 'expectedRevision': 0}, Path(data_dir))
            self.assertEqual(result['revision'], 2)
            self.assertEqual(result['snapshot']['revision'], 2)
            self.assertEqual(len(result['snapshot']['profiles']), 2)
            self.assertEqual(result['preview']['profile']['id'], builtins[0]['id'])

    def call(self, data_dir, request):
        stdin = io.TextIOWrapper(io.BytesIO(json.dumps(request).encode('utf-8')), encoding='utf-8')
        stdout = io.TextIOWrapper(io.BytesIO(), encoding='utf-8')
        with patch('sys.stdin', stdin), patch('sys.stdout', stdout):
            self.assertEqual(bridge.main(['--data-dir', str(data_dir)]), 0)
        return json.loads(stdout.buffer.getvalue())

    def test_lock_damage_and_capacity_are_distinct_from_conflict_and_invalid_request(self):
        project_id = '9e4b0afb-7554-4cc6-9724-8bceab68cb39'
        write = {'op': 'import-builtin', 'projectId': project_id,
                 'builtinId': arsenal.builtin_profiles()[0]['id'], 'expectedRevision': 0}
        with tempfile.TemporaryDirectory(prefix='omni-bridge-codes-') as data_dir:
            store = Path(data_dir) / 'arsenal' / f'{project_id}.json'
            store.parent.mkdir(parents=True)
            lock = store.with_name(store.name + '.lock')
            lock.write_text('interrupted writer', encoding='utf-8')
            self.assertEqual(self.call(data_dir, write), {'ok': False, 'code': 'locked'})
            self.assertEqual(lock.read_text(encoding='utf-8'), 'interrupted writer')  # Never broken automatically.
            lock.unlink()  # This test owns the synthetic lock.
            with patch.object(arsenal, 'MAX_EVENTS', 0):
                self.assertEqual(self.call(data_dir, write), {'ok': False, 'code': 'full'})
            store.write_text('{"schema_version":1,"revision":1,"events":[]}', encoding='utf-8')
            for request in ({'op': 'list', 'projectId': project_id}, write):
                self.assertEqual(self.call(data_dir, request), {'ok': False, 'code': 'damaged'})


if __name__ == '__main__':
    unittest.main()
