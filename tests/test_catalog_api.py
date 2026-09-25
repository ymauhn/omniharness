import tempfile
import unittest
import json
import subprocess
import sys
from pathlib import Path

from harness.catalog_api import view
from harness.skill_catalog import build_snapshot


class CatalogViewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='omni-catalog-view-')
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.root = root
        data = root / 'data'
        data.mkdir()
        for name in ('review-a', 'review-b'):
            skill = root / '.agents/skills' / name / 'SKILL.md'
            skill.parent.mkdir(parents=True)
            skill.write_text(f'---\nname: {name}\ndescription: Review code.\n---\nPrivate skill body not sent to UI', encoding='utf-8')
        self.snapshot = build_snapshot(root=root, home=root / 'empty-home', data=data)

    def test_list_search_and_detail_share_source_identity_without_body_or_absolute_path(self):
        first = view(self.snapshot, {'limit': 1})
        second = view(self.snapshot, {'limit': 1, 'offset': 1})
        self.assertEqual(first['total'], 2)
        self.assertNotEqual(first['rows'][0]['id'], second['rows'][0]['id'])
        result = view(self.snapshot, {'q': 'review', 'limit': 1})
        self.assertEqual(result['total'], 2)
        row = result['rows'][0]
        self.assertNotIn('source_path', row)
        self.assertNotIn('Private skill body', str(result))
        self.assertFalse(row['runnable'])
        self.assertEqual(row['authority']['status'], 'unknown')
        detail = view(self.snapshot, {'op': 'get', 'skill_id': row['id']})
        self.assertEqual(detail['row']['source_sha256'], row['source_sha256'])
        self.assertIsNone(view(self.snapshot, {'op': 'get', 'skill_id': 'missing'})['row'])

    def test_bad_shapes_limits_and_unrecognized_fields_are_rejected(self):
        for request in ([], {'offset': -1}, {'limit': True}, {'limit': 0}, {'ring': 'else'}, {'q': []}, {'path': '/private'}, {'op': 'execute'}):
            with self.subTest(request=request), self.assertRaises(ValueError):
                view(self.snapshot, request)

    def test_out_of_range_page_and_no_match_are_honest_empty_results(self):
        self.assertEqual(view(self.snapshot, {'offset': 20})['rows'], [])
        self.assertEqual(view(self.snapshot, {'q': 'unmatchedxyz'})['total'], 0)
        self.assertEqual(view(self.snapshot, {'ring': 'catalog'})['total'], 0)

    def test_real_cli_build_and_query_use_local_snapshot_and_explicit_fixture_home(self):
        overlay = self.root / 'docs/skills-graph/skill-metadata.json'
        overlay.parent.mkdir(parents=True)
        overlay.write_text('{"schema_version":1,"entries":[]}', encoding='utf-8')
        command = [sys.executable, '-m', 'harness.catalog_api', '--root', str(self.root),
                   '--home', str(self.root / 'empty-home'), '--snapshot', str(self.root / 'catalog.json')]
        built = subprocess.run(command, input=b'{"op":"build"}', capture_output=True, timeout=20)
        self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
        self.assertEqual(json.loads(built.stdout)['coverage']['canonical_installed_sources'], 2)
        query = subprocess.run(command, input=b'{"q":"review","limit":1}', capture_output=True, timeout=20)
        self.assertEqual(query.returncode, 0, query.stdout + query.stderr)
        self.assertEqual(json.loads(query.stdout)['total'], 2)


if __name__ == '__main__':
    unittest.main()
