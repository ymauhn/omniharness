"""Regression for the bridge's observed revision under a concurrent writer."""
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


if __name__ == '__main__':
    unittest.main()
