"""Consumption evidence across the eval and coordinator boundaries; no model calls."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from evals import run, records
from harness.swarm_accounting import Ledger, usage_from_stream


def workspace(root, *, cost=0.02):
    manifest = records.manifest(run.ROOT, run.CASES / 'detour-bounded', 'harness', 1, 60,
                                {'home_isolation': 'offline-fixture'})
    manifest['session_id'] = 'fixture-session'
    manifest['invocation'] = 'fresh-single-input'
    model = {'inputTokens': 10, 'outputTokens': 5,
             'cacheReadInputTokens': 20, 'cacheCreationInputTokens': 3}
    result = {'type': 'result', 'subtype': 'success', 'session_id': 'fixture-session',
              'result': 'Detour 1\nViability test: a\nDetour 2\nViability test: b\n'
                        'Detour 3\nViability test: c\nVerdict: keep.', 'num_turns': 2,
              'modelUsage': {'main': model, 'child': model}, 'total_cost_usd': cost,
              'usage': {'input_tokens': 1, 'output_tokens': 1}}
    init = {'type': 'system', 'subtype': 'init', 'session_id': 'fixture-session',
            'model': 'fixture-model', 'claude_code_version': 'fixture-cli'}
    data = ('\n'.join(map(json.dumps, (init, result))) + '\n').encode()
    (root / '_stream.jsonl').write_bytes(data)
    (root / '_manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    (root / '_process.json').write_text(json.dumps({'exit_code': 0, 'failures': []}), encoding='utf-8')
    return data


class SharedReceipts(unittest.TestCase):
    def test_runner_refuses_flags_that_break_single_invocation_evidence(self):
        run.records.platform.uname()
        for flags in (['--resume', 'old'], ['-c'], ['--session-id=old'],
                      ['--output-format', 'json'], ['--input-format', 'stream-json']):
            with self.subTest(flags=flags), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                case = root / 'cases' / 'detour-bounded'
                case.mkdir(parents=True)
                (case / 'prompt.md').write_text('Offline fixture.')
                (case / 'arms.json').write_text(json.dumps({'harness': {'flags': flags}}))
                with patch.object(run, 'CASES', case.parent), patch.object(run, 'RESULTS', root / 'results'), \
                     patch.object(run.subprocess, 'Popen') as spawn:
                    self.assertEqual(run.main(['run', 'detour-bounded', '--arm', 'harness']), 1)
                    self.assertEqual(spawn.call_count, 0)

    def test_eval_and_coordinator_use_the_same_whole_tree_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            data = workspace(ws)
            expected = usage_from_stream(data, session='fixture-session', exit_code=0)
            rec = run.evaluate_ws('detour-bounded', 'harness', ws, 1, 0)
            self.assertTrue(rec['task_pass'])
            self.assertEqual(rec['tokens_out'], 10)
            self.assertEqual(rec['tokens_in'], 20)
            self.assertEqual(rec['total_tokens'], 76)
            self.assertEqual(rec['usage_receipt'], expected)
            self.assertEqual(rec['estimated_usd'], 0.02)
            self.assertIsNone(rec['billed_usd'])
            self.assertEqual(rec['coverage']['cost_usd'], 'estimated')

    def test_stale_or_misbound_results_cannot_approve_with_or_without_manifest(self):
        for tail in ({'type': 'user'}, {'type': 'stream_event'},
                     {'type': 'system', 'subtype': 'init', 'session_id': 'fixture-session'},
                     {'type': 'assistant', 'message': {'content': []}}):
            with self.subTest(tail=tail), tempfile.TemporaryDirectory() as tmp:
                ws = Path(tmp)
                data = workspace(ws) + json.dumps(tail).encode()
                (ws / '_stream.jsonl').write_bytes(data)
                with self.assertRaises(ValueError):
                    usage_from_stream(data, session='fixture-session', exit_code=0)
                # A legacy workspace without a launch manifest still cannot pass stale output.
                (ws / '_manifest.json').rename(ws / '_legacy_manifest.json')
                self.assertFalse(run.evaluate_ws('detour-bounded', 'harness', ws, 1, 0)['run_valid'])
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            data = workspace(ws)
            init = json.dumps({'type': 'system', 'subtype': 'init', 'session_id': 'wrong'}) + '\n'
            (ws / '_stream.jsonl').write_bytes(init.encode() + data)
            self.assertFalse(run.evaluate_ws('detour-bounded', 'harness', ws, 1, 0)['run_valid'])

    def test_comparison_requires_bound_compatible_receipts_and_uses_total_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for i, cost in enumerate((0.02, 0.03)):
                ws = root / str(i)
                ws.mkdir()
                workspace(ws, cost=cost)
                rec = run.evaluate_ws('detour-bounded', 'harness', ws, 1, 0)
                (root / f'{i}.json').write_text(json.dumps(rec))
            report = records.compare(root)
            self.assertEqual(report['groups'][0]['metrics_compared'], ['total_tokens', 'estimated_usd'])
            self.assertIn('estimated_usd', report['alerts'][0])
            for change in ({'usage_scope': 'main-loop'}, {'counter_scope': 'turn'}, {'schema_version': 99}):
                altered = json.loads(json.dumps(rec))
                altered['usage_receipt'].update(change)
                (root / '1.json').write_text(json.dumps(altered))
                report = records.compare(root)
                self.assertEqual(report['groups'][0]['metrics_compared'], [])
                self.assertEqual(report['alerts'], [])
            rec['total_tokens'] = 0
            (root / '1.json').write_text(json.dumps(rec))
            self.assertTrue(records.compare(root)['alerts'][0].startswith('INVALID_RECORD'))

    def test_missing_hash_and_malformed_manifest_cannot_certify_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            workspace(ws)
            rec = run.evaluate_ws('detour-bounded', 'harness', ws, 1, 0)
            rec['usage_receipt']['source_sha256'] = None
            rec['source']['files'].pop('_stream.jsonl')
            history = ws / 'history'
            history.mkdir()
            (history / 'record.json').write_text(json.dumps(rec))
            self.assertTrue(records.compare(history)['alerts'][0].startswith('INVALID_RECORD'))
            for name in ('_manifest.json', '_process.json'):
                workspace(ws)
                (ws / name).write_text('[1]')
                self.assertFalse(run.evaluate_ws('detour-bounded', 'harness', ws, 1, 0)['run_valid'])

    def test_failure_preserves_observed_usage_and_missing_money_does_not_erase_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            workspace(ws, cost=None)
            (ws / '_process.json').write_text(json.dumps({'exit_code': 1, 'failures': []}))
            rec = run.evaluate_ws('detour-bounded', 'harness', ws, 1, 1)
            self.assertFalse(rec['run_valid'])
            self.assertIsNone(rec['task_pass'])
            self.assertEqual(rec['total_tokens'], 76)
            self.assertIsNone(rec['estimated_usd'])
            self.assertEqual(rec['coverage']['total_tokens'], 'measured')
            self.assertFalse(rec['usage_receipt']['usage_complete'])

    def test_corrupt_counters_and_crash_zeros_remain_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            original = workspace(ws)
            for bad in (None, True, -1, 0.5, float('nan')):
                events = [json.loads(line) for line in original.splitlines()]
                events[-1]['modelUsage']['child']['inputTokens'] = bad
                data = '\n'.join(map(json.dumps, events)).encode()
                receipt = usage_from_stream(data, session='fixture-session', exit_code=0)
                self.assertIsNone(receipt['total_tokens'])
                self.assertEqual(receipt['estimated_usd'], 0.02)
            for bad in (None, True, -1, float('nan'), float('inf'), 10**400):
                data = workspace(ws, cost=bad)
                receipt = usage_from_stream(data, session='fixture-session', exit_code=0)
                self.assertEqual(receipt['total_tokens'], 76)
                self.assertIsNone(receipt['estimated_usd'])
            events = [json.loads(line) for line in original.splitlines()]
            events[-1].update(subtype='error_during_execution', total_cost_usd=0)
            (ws / '_stream.jsonl').write_text('\n'.join(map(json.dumps, events)))
            rec = run.evaluate_ws('detour-bounded', 'harness', ws, 1, 0)
            self.assertFalse(rec['run_valid'])
            self.assertIsNone(rec['total_tokens'])
            self.assertIsNone(rec['estimated_usd'])

    def test_unknown_receipt_retains_the_same_contract_in_ledger_and_eval(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            workspace(ws)
            data = b'{truncated'
            (ws / '_stream.jsonl').write_bytes(data)
            ledger = Ledger(ws / 'coordinator.sqlite')
            ledger.create('run', estimated_usd=1, tokens=100, approval='offline-fixture')
            lease = ledger.reserve('run', 'attempt', estimated_usd=1, tokens=100)
            ledger.start(lease, session='fixture-session')
            settled = ledger.settle(lease, data, exit_code=0)
            rec = run.evaluate_ws('detour-bounded', 'harness', ws, 1, 0)
            self.assertFalse(rec['run_valid'])
            self.assertEqual({k: v for k, v in settled.items() if k != 'reservation_exceeded'}, rec['usage_receipt'])
            self.assertFalse(settled['usage_complete'])
            self.assertIsNone(ledger.status('run')['measured_tokens'])
            self.assertEqual(ledger.status('run')['held_tokens'], 100)
