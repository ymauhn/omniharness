"""Offline discovery contracts; fixtures never touch the user's installed registry."""
import copy
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from harness import skill_catalog as catalog


def write_skill(path, name='graphify', body='Variant A.', description='Build a code map.'):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'---\nname: {name}\ndescription: {description}\nlicense: MIT\nmetadata:\n  version: "0.1.0"\n---\n{body}\n', encoding='utf-8')
    return path


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='omni-catalog-')
        self.base = Path(self.temp.name)
        self.home = self.base / 'home'
        self.root = self.base / 'root'
        self.data = self.base / 'data'
        self.data.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def build(self, **kwargs):
        return catalog.build_snapshot(home=self.home, root=self.root, data=self.data, **kwargs)

    def test_same_name_different_sources_do_not_merge(self):
        write_skill(self.root / '.agents/skills/graphify/SKILL.md')
        write_skill(self.home / '.codex/skills/graphify/SKILL.md', body='Different implementation.')
        snapshot = self.build()
        self.assertEqual(len(snapshot['rows']), 2, 'Each canonical source variant needs its own row')
        self.assertEqual(len({row['skill_id'] for row in snapshot['rows']}), 2)
        self.assertEqual(len({row['source_sha256'] for row in snapshot['rows']}), 2)
        before = {row['source_key']: row['skill_id'] for row in snapshot['rows']}
        write_skill(self.root / '.agents/skills/graphify/SKILL.md', body='Edited body.')
        after = self.build()
        self.assertEqual(before, {row['source_key']: row['skill_id'] for row in after['rows']})
        self.assertNotEqual(snapshot['snapshot_id'], after['snapshot_id'])

    def test_filtered_query_paginates_after_ranking_with_exact_total(self):
        for name in ('alpha', 'bravo', 'charlie'):
            write_skill(self.root / '.agents/skills' / name / 'SKILL.md', name=name, description='Review code')
        snapshot = self.build()
        first = catalog.query_snapshot(snapshot, 'review', limit=1, ring='installed')
        second = catalog.query_snapshot(snapshot, 'review', limit=1, ring='installed', offset=1)
        self.assertEqual(first['total'], 3)
        self.assertNotEqual(first['results'][0]['skill_id'], second['results'][0]['skill_id'])
        self.assertEqual(catalog.query_snapshot(snapshot, 'review', ring='catalog')['total'], 0)
        with self.assertRaises(ValueError):
            catalog.query_snapshot(snapshot, 'review', offset=-1)

    def overlay(self, path, **metadata):
        return {'schema_version': 1, 'entries': [{'source_key': catalog.source_key(path, self.root, self.home),
                'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'metadata': metadata}]}

    def test_aliases_deduplicate_canonical_source_but_retain_hosts(self):
        original = write_skill(self.root / '.agents/skills/graphify/SKILL.md')
        alias = self.home / '.codex/skills/graphify/SKILL.md'
        alias.parent.mkdir(parents=True)
        # The scanner's source canonicalization seam models a directory-junction
        # alias without requiring Windows symlink privileges in the test runner.
        alias.write_bytes(original.read_bytes())
        real_canonical = catalog._canonical
        def canonical(path):
            resolved = real_canonical(path)
            return real_canonical(original) if resolved == real_canonical(alias) else resolved
        with patch.object(catalog, '_canonical', side_effect=canonical):
            snapshot = self.build()
        self.assertEqual(len(snapshot['rows']), 1)
        self.assertEqual(snapshot['rows'][0]['hosts'], ['codex', 'repo'])
        self.assertEqual(snapshot['coverage']['discovered_paths'], 2)

    def test_current_overlay_accent_alias_and_no_match(self):
        path = write_skill(self.root / '.agents/skills/code-review/SKILL.md', 'code-review', description='Review source code.')
        overlay = self.overlay(path, aliases={'pt': ['revisão de código', 'revisar codigo antes do commit'], 'en': ['review code']},
                               taxonomy=['engineering'], use_cases={'pt': ['revisar código legado']}, reviewed_at='2026-09-25',
                               when_to_avoid=['astronomia'])
        snapshot = self.build(overlay=overlay)
        row = snapshot['rows'][0]
        self.assertEqual(row['version'], '0.1.0')
        self.assertEqual(row['license'], 'MIT')
        self.assertIsNone(row['compatibility'])
        self.assertEqual(row['curation'], 'current')
        result = catalog.query_snapshot(snapshot, 'REVISAO DE CODIGO')
        self.assertTrue(result['results'][0]['relevance']['exact_alias'])
        self.assertFalse(result['results'][0]['runnable'])
        self.assertEqual(result['results'][0]['authority']['status'], 'unknown')
        self.assertTrue(catalog.query_snapshot(snapshot, 'astronomia')['abstained'])
        self.assertTrue(catalog.query_snapshot(snapshot, 'xyzzy_unmatched')['abstained'])

    def test_stale_overlay_is_ignored_instead_of_curated(self):
        path = write_skill(self.root / '.agents/skills/graphify/SKILL.md')
        overlay = self.overlay(path, aliases={'pt': ['mapa fantástico']})
        write_skill(path, body='Changed after curation.')
        snapshot = self.build(overlay=overlay)
        self.assertEqual(snapshot['rows'][0]['curation'], 'stale')
        self.assertIsNone(snapshot['rows'][0]['metadata']['aliases'])
        self.assertTrue(catalog.query_snapshot(snapshot, 'fantástico')['abstained'])
        self.assertIn('stale_overlay', [issue['code'] for issue in snapshot['issues']])

    def test_snapshot_id_ignores_generation_time_but_binds_metadata_and_relations(self):
        path = write_skill(self.root / '.agents/skills/alpha/SKILL.md', 'alpha')
        write_skill(self.root / '.agents/skills/beta/SKILL.md', 'beta')
        first = self.build(generated_at='2026-09-24T00:00:00Z')
        second = self.build(generated_at='2026-09-25T00:00:00Z')
        self.assertEqual(first['snapshot_id'], second['snapshot_id'])
        curated = self.build(overlay=self.overlay(path, inputs=['source files']))
        self.assertNotEqual(first['snapshot_id'], curated['snapshot_id'])
        (self.data / 'skills-graph.toml').write_text('[[edge]]\nfrom = "alpha"\nto = "beta"\ntype = "precedes"\n', encoding='utf-8')
        related = self.build()
        self.assertNotEqual(first['snapshot_id'], related['snapshot_id'])
        self.assertEqual(related['relations'][0]['resolution'], 'exact')

    def test_remote_and_catalog_are_never_runnable_and_ambiguous_graphs_stay_explicit(self):
        write_skill(self.root / '.agents/skills/graphify/SKILL.md')
        write_skill(self.home / '.codex/skills/graphify/SKILL.md', body='Other.')
        (self.data / 'remote.json').write_text(json.dumps({'entries': [{'id': 'remote-review', 'description': 'Remote review'}]}), encoding='utf-8')
        (self.data / 'skills-graph.toml').write_text('[[node]]\nid = "catalog-review"\nring = "catalog"\ndescription = "Review catalog"\n\n[[edge]]\nfrom = "graphify"\nto = "remote-review"\ntype = "candidate-for"\n', encoding='utf-8')
        snapshot = self.build()
        results = catalog.query_snapshot(snapshot, 'review')['results']
        self.assertEqual({row['availability']['ring'] for row in results}, {'catalog', 'remote'})
        self.assertTrue(all(row['runnable'] is False and row['availability']['status'] == 'not_installed' for row in results))
        edge = snapshot['relations'][0]
        self.assertEqual(edge['resolution'], 'ambiguous')
        self.assertEqual(len(edge['from_skill_ids']), 2)

    def test_invalid_overlay_and_corrupted_snapshot_fail_closed(self):
        path = write_skill(self.root / '.agents/skills/graphify/SKILL.md')
        for overlay in [{}, {'schema_version': 2, 'entries': []}, {'schema_version': True, 'entries': []},
                        self.overlay(path, aliases=['not a locale map']), self.overlay(path, authority='allowed'),
                        self.overlay(path, reviewed_at='yesterday')]:
            with self.assertRaises(ValueError):
                self.build(overlay=overlay)
        snapshot = self.build()
        for mutation in [lambda s: s.update(schema_version=2), lambda s: s['rows'][0].update(name='tampered'), lambda s: s['rows'][0].update(runnable=True)]:
            changed = copy.deepcopy(snapshot)
            mutation(changed)
            with self.assertRaises(ValueError):
                catalog.query_snapshot(changed, 'graphify')
        malformed = copy.deepcopy(snapshot)
        malformed['rows'][0]['metadata']['aliases'] = ['bad']
        with self.assertRaises(ValueError):
            catalog.validate_snapshot(malformed)

    def test_malformed_registry_is_reported_and_catalog_build_is_incomplete(self):
        write_skill(self.root / '.agents/skills/alpha/SKILL.md', 'alpha')
        registry = self.home / '.claude/plugins/installed_plugins.json'
        registry.parent.mkdir(parents=True)
        registry.write_text('{broken', encoding='utf-8')
        snapshot = self.build()
        self.assertFalse(snapshot['coverage']['complete_for_discovery_scope'])
        self.assertIn('discovery_failed', [issue['code'] for issue in snapshot['issues']])

    def test_read_and_count_limits_are_reported_not_green(self):
        write_skill(self.root / '.agents/skills/alpha/SKILL.md', 'alpha', body='x' * 200)
        snapshot = self.build(limits=catalog.Limits(file_bytes=80))
        self.assertFalse(snapshot['coverage']['complete_for_discovery_scope'])
        self.assertEqual(snapshot['rows'][0]['availability'], 'unreadable')
        self.assertIsNone(snapshot['rows'][0]['source_sha256'])
        self.assertIn('source_read', [issue['code'] for issue in snapshot['issues']])
        write_skill(self.root / '.agents/skills/beta/SKILL.md', 'beta')
        truncated = self.build(limits=catalog.Limits(rows=1))
        self.assertFalse(truncated['coverage']['complete_for_discovery_scope'])
        self.assertEqual(len(truncated['rows']), 1)

    def test_atomic_write_preserves_previous_snapshot_on_replace_failure(self):
        write_skill(self.root / '.agents/skills/alpha/SKILL.md', 'alpha')
        snapshot = self.build()
        destination = self.base / 'snapshot.json'
        catalog.write_snapshot(snapshot, destination)
        before = destination.read_bytes()
        with patch.object(catalog.os, 'replace', side_effect=OSError('fixture replacement failure')):
            with self.assertRaises(OSError):
                catalog.write_snapshot(self.build(generated_at='different'), destination)
        self.assertEqual(destination.read_bytes(), before)
        self.assertEqual(list(self.base.glob('snapshot.json.*.tmp')), [])
        catalog.validate_snapshot(json.loads(before))

    def test_cli_writes_queryable_snapshot_and_rejects_invalid_input(self):
        write_skill(self.root / '.agents/skills/alpha/SKILL.md', 'alpha')
        destination = self.base / 'snapshot.json'
        self.assertEqual(catalog.main(['build', '--root', str(self.root), '--home', str(self.home), '--data', str(self.data), '--out', str(destination)]), 0)
        self.assertEqual(catalog.main(['query', str(destination), 'alpha']), 0)
        self.assertEqual(catalog.main(['query', str(destination), 'alpha', '--limit', '0']), 2)

    def test_inaccessible_existing_skill_root_is_incomplete_not_empty_green(self):
        write_skill(self.root / '.agents/skills/alpha/SKILL.md', 'alpha')
        original_scandir = os.scandir
        def scandir(path):
            if Path(path) == self.root / '.agents/skills':
                raise PermissionError('fixture denied existing root')
            return original_scandir(path)
        with patch.object(catalog.os, 'scandir', side_effect=scandir):
            snapshot = self.build()
        self.assertFalse(snapshot['coverage']['complete_for_discovery_scope'])
        self.assertIn('directory_read', [issue['code'] for issue in snapshot['issues']])

    def test_empty_nonmatching_directories_still_consume_discovery_budget(self):
        for index in range(8):
            (self.root / f'.agents/skills/empty-{index}').mkdir(parents=True)
        snapshot = self.build(limits=catalog.Limits(directory_entries=1))
        self.assertFalse(snapshot['coverage']['complete_for_discovery_scope'])
        self.assertIn('discovery_limit', [issue['code'] for issue in snapshot['issues']])

    def test_requested_host_breaks_equal_relevance_tie(self):
        write_skill(self.home / '.claude/skills/shared/SKILL.md', 'shared')
        write_skill(self.home / '.codex/skills/shared/SKILL.md', 'shared')
        snapshot = self.build()
        for host in ('claude', 'codex'):
            result = catalog.query_snapshot(snapshot, 'shared', host=host, limit=1)['results'][0]
            self.assertEqual(result['availability']['discovered_hosts'], [host])
            self.assertEqual(result['availability']['host_match'], 'observed')
            self.assertFalse(result['runnable'])

    def test_denied_registry_stat_is_incomplete_not_missing(self):
        registry = self.home / '.claude/plugins/installed_plugins.json'
        registry.parent.mkdir(parents=True)
        registry.write_text('{"plugins": {}}', encoding='utf-8')
        original_stat = os.stat
        def denied(path, *args, **kwargs):
            if Path(path) == registry:
                raise PermissionError('fixture denied existing registry stat')
            return original_stat(path, *args, **kwargs)
        with patch.object(catalog.os, 'stat', side_effect=denied):
            snapshot = self.build()
        self.assertFalse(snapshot['coverage']['complete_for_discovery_scope'])
        self.assertIn('source_stat', [issue['code'] for issue in snapshot['issues']])

    def test_failed_reads_consume_and_cannot_exceed_total_byte_budget(self):
        scan = catalog._Discovery(self.root, self.home, catalog.Limits(file_bytes=10, total_bytes=15))
        files = [self.base / f'oversize-{index}' for index in range(3)]
        for file in files:
            file.write_bytes(b'x' * 11)
        consumed = []
        original_open = open
        class Counted:
            def __init__(self, stream): self.stream = stream
            def __enter__(self): return self
            def __exit__(self, *args): self.stream.close()
            def fileno(self): return self.stream.fileno()
            def read(self, size):
                data = self.stream.read(size)
                consumed.append(len(data))
                return data
        with patch('builtins.open', side_effect=lambda *args, **kwargs: Counted(original_open(*args, **kwargs))):
            for file in files:
                self.assertEqual(scan.read(file), '')
        self.assertLessEqual(sum(consumed), 15)
        self.assertEqual(scan.bytes, sum(consumed))
        self.assertEqual(len(scan.issues), 3)

    def test_rehashed_impossible_snapshot_claims_are_rejected(self):
        write_skill(self.root / '.agents/skills/alpha/SKILL.md', 'alpha')
        write_skill(self.root / '.agents/skills/beta/SKILL.md', 'beta')
        (self.data / 'skills-graph.toml').write_text('[[edge]]\nfrom = "alpha"\nto = "beta"\ntype = "precedes"\n', encoding='utf-8')
        snapshot = self.build()
        mutations = [
            lambda s: s['rows'][0].update(source_sha256=None),
            lambda s: s['rows'][0]['authority'].update(allowed=True),
            lambda s: s['issues'].append({'code': 'fixture', 'source': 'fixture', 'detail': 'failed', 'severity': 'error'}),
            lambda s: s['coverage'].update(rows=99),
            lambda s: s['relations'][0].update(proposed=True),
            lambda s: s['relations'][0].update(resolution='ambiguous'),
            lambda s: s['relations'][0].update(extra='unrecognized'),
            lambda s: s['issues'].append({'code': 'fixture', 'source': 'fixture', 'detail': 'failed', 'severity': 'not-a-level'}),
        ]
        for mutate in mutations:
            changed = copy.deepcopy(snapshot)
            mutate(changed)
            payload = {key: value for key, value in changed.items() if key not in ('snapshot_id', 'generated_at')}
            changed['snapshot_id'] = 'sha256:' + hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
            with self.subTest(mutation=mutate):
                with self.assertRaises(ValueError):
                    catalog.validate_snapshot(changed)


if __name__ == '__main__':
    unittest.main()
