"""Protocol checks without ML imports, downloads, or actual provider requests."""
from dataclasses import asdict
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock

from harness import classifier_worker as worker
from harness.prompt_classifier import Selection, Usage


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.model = Mock()
        self.model.select.return_value = Selection('laya', 'source:a', 'selected', Usage(7, 0))
        self.factory = Mock(return_value=self.model)
        self.worker = worker.Worker(self.factory)

    def warm(self):
        return self.worker.handle({'id':1,'op':'warm'})

    def request(self):
        return {'id':2,'op':'select','prompt':'Review code','candidates':[{'source_id':'source:a','description':'Code review'}]}

    def test_explicit_warm_then_reuse_and_no_execution_authority(self):
        self.factory.assert_not_called()
        self.assertFalse(self.worker.handle(self.request())['ok'])
        self.assertEqual(self.warm(), {'id':1,'ok':True,'ready':True})
        self.assertEqual(self.warm(), {'id':1,'ok':True,'ready':True})
        result = self.worker.handle(self.request())
        self.assertEqual(result['selection'], asdict(self.model.select.return_value))
        self.assertFalse(result['selection']['runnable'])
        self.factory.assert_called_once()
        self.assertEqual(self.model.select.call_count, 2)

    def test_invalid_candidates_and_extra_session_fields_never_reach_inference(self):
        self.warm(); self.model.select.reset_mock()
        for mutate in [lambda r:r.update(session={'private':'secret'}),
                       lambda r:r.update(prompt='x'*2049),
                       lambda r:r.update(candidates=[]),
                       lambda r:r['candidates'][0].update(source_id='none'),
                       lambda r:r['candidates'][0].update(description='x'*257),
                       lambda r:r.update(id=True)]:
            request=self.request();mutate(request)
            self.assertFalse(self.worker.handle(request)['ok'])
        self.model.select.assert_not_called()

    def test_warm_failures_are_generic_and_do_not_leave_a_ready_model(self):
        self.factory.side_effect=RuntimeError('SECRET /private/model/path')
        result=self.warm()
        self.assertEqual(result,{'id':1,'ok':False,'error':'unavailable'})
        self.assertNotIn('SECRET',str(result))
        self.assertFalse(self.worker.handle(self.request())['ok'])

    def test_provider_failure_invalid_result_and_unknown_usage(self):
        self.warm()
        self.model.select.return_value=Selection('laya',reason='none')
        self.assertEqual(self.worker.handle(self.request())['selection']['usage'],{'input_tokens':None,'output_tokens':None})
        for result in [Selection('laya',reason='provider_failed'), Selection('laya','outside','selected'), Selection('laya','source:a','selected',runnable=True)]:
            self.model.select.return_value=result
            self.assertFalse(self.worker.handle(self.request())['ok'])

    def test_jsonl_bounds_duplicate_keys_and_eof_do_not_echo_input(self):
        for raw in [b'{"id":1,"id":2,"op":"warm"}\n', b'SECRET'+b'x'*worker.MAX_FRAME_BYTES+b'\n', b'{"id":1,"op":"warm"}']:
            output=io.BytesIO()
            self.assertEqual(worker.serve(io.BytesIO(raw),output,self.worker),2)
            self.assertEqual(json.loads(output.getvalue()),{'id':None,'ok':False,'error':'invalid_request'})
            self.assertNotIn(b'SECRET',output.getvalue())
        self.factory.assert_not_called()

    def test_two_frames_and_clean_eof(self):
        data=b'{"id":1,"op":"warm"}\n'+json.dumps(self.request()).encode()+b'\n'
        output=io.BytesIO()
        self.assertEqual(worker.serve(io.BytesIO(data),output,self.worker),0)
        rows=[json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([row['id'] for row in rows],[1,2])
        self.assertTrue(all(row['ok'] for row in rows))

    def test_manifest_uses_reviewed_runtime_hashes_and_rejects_wrong_identity(self):
        source=Path(__file__).resolve().parents[1]/'docs/experiments/laya-artifacts-2026-09-25.json'
        value=json.loads(source.read_text())
        hashes=worker.load_manifest(source)
        self.assertEqual(hashes['model.safetensors'],value['runtime_files']['model.safetensors']['sha256'])
        self.assertIn('tokenizer/tokenizer_config.json.pre-omniharness',hashes)
        with tempfile.TemporaryDirectory() as directory:
            manifest=Path(directory)/'manifest.json'
            for mutate in [lambda v:v.update(revision='unreviewed'),lambda v:v.update(model='other'),lambda v:v.update(schema_version=True),lambda v:v['runtime_files']['model.safetensors'].update(sha256='invalid')]:
                candidate=json.loads(source.read_text());mutate(candidate);manifest.write_text(json.dumps(candidate))
                with self.assertRaises(ValueError):worker.load_manifest(manifest)

    def test_real_worker_missing_manifest_returns_only_generic_json_without_ml_dependency(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            result=subprocess.run([sys.executable,'-I','-u',str(Path(worker.__file__).resolve()),'--checkpoint',str(root/'PRIVATE_CHECKPOINT'),'--manifest',str(root/'SECRET_MANIFEST')],
                                  input=b'{"id":1,"op":"warm"}\n',capture_output=True,timeout=5)
        self.assertEqual(result.returncode,0)
        self.assertEqual(json.loads(result.stdout),{'id':1,'ok':False,'error':'unavailable'})
        self.assertEqual(result.stderr,b'')
        self.assertNotIn(b'SECRET',result.stdout)


if __name__ == '__main__':
    unittest.main()
