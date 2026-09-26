"""Resident CPU Laya JSONL worker. Stdin is data; stdout is protocol only.

Launched by classifier-service.mjs after explicit enable. No JEV integration.
The parent owns deadlines and termination of this single inference process.
"""
import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import sys

if __package__ in (None, ''):  # Allow Python -I with this exact trusted script path.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from harness import prompt_classifier as adapter

MAX_FRAME_BYTES = 16384
REVISION = 'e4e9ddf21a7b1903b7acffd8814ad4307bf63a67'
GOOD_REASONS = {'selected','none','below_threshold','selected_fit_failed'}


class Worker:
    def __init__(self, factory):
        self.factory = factory
        self.model = None

    def handle(self, request):
        identifier = request.get('id') if type(request) is dict else None
        if type(identifier) is not int or not 0 < identifier <= 2**53-1:
            return {'id':None,'ok':False,'error':'invalid_request'}
        try:
            if request.get('op') == 'warm' and set(request) == {'id','op'}:
                if self.model is None:
                    model = self.factory()
                    result = model.select('Review code correctness.', [adapter.Candidate('warm:review','Review code correctness')])
                    if type(result) is not adapter.Selection or result.provider != 'laya' or result.runnable is not False or result.reason not in GOOD_REASONS:
                        raise ValueError()
                    self.model = model
                return {'id':identifier,'ok':True,'ready':True}
            if request.get('op') != 'select' or set(request) != {'id','op','prompt','candidates'} or self.model is None:
                raise ValueError()
            if type(request['candidates']) is not list or not 1 <= len(request['candidates']) <= adapter.MAX_CANDIDATES:
                raise ValueError()
            if any(type(candidate) is not dict or set(candidate) != {'source_id','description'} for candidate in request['candidates']):
                raise ValueError()
            candidates = [adapter.Candidate(**candidate) for candidate in request['candidates']]
            adapter._request(request['prompt'],candidates,adapter.SelectionConfig())
            result = self.model.select(request['prompt'], candidates)
            if type(result) is not adapter.Selection or result.provider != 'laya' or result.runnable is not False or result.reason not in GOOD_REASONS:
                raise ValueError()
            if (result.reason == 'selected' and result.source_id not in {candidate.source_id for candidate in candidates}) or (result.reason != 'selected' and result.source_id is not None):
                raise ValueError()
            if result.probability is not None and not adapter._probability(result.probability):
                raise ValueError()
            if type(result.usage) is not adapter.Usage or any(value is not None and (type(value) is not int or not 0 <= value <= 2**53-1) for value in (result.usage.input_tokens,result.usage.output_tokens)):
                raise ValueError()
            return {'id':identifier,'ok':True,'selection':asdict(result)}
        except Exception:
            return {'id':identifier,'ok':False,'error':'unavailable'}


def serve(input_stream, output_stream, worker):
    while True:
        line = input_stream.readline(MAX_FRAME_BYTES + 1)
        if not line:
            return 0
        try:
            if len(line) > MAX_FRAME_BYTES or not line.endswith(b'\n'):
                raise ValueError()
            request = adapter._json(line[:-1])
            result = worker.handle(request)
        except Exception:
            result = {'id':None,'ok':False,'error':'invalid_request'}
        encoded = json.dumps(result,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8') + b'\n'
        output_stream.write(encoded)
        output_stream.flush()
        if result['id'] is None:
            return 2


def load_manifest(manifest):
    with Path(manifest).open('rb') as stream:
        data = stream.read(adapter.MAX_RESPONSE_BYTES + 1)
    value = adapter._json(data)
    if type(value) is not dict or type(value.get('schema_version')) is not int or value['schema_version'] != 1 or value.get('provider') != 'laya' or value.get('package_version') != '0.3.20' or value.get('revision') != REVISION or value.get('model') != 'convaiinnovations/laya-multilingual':
        raise ValueError()
    files = value['runtime_files']
    if type(files) is not dict or not 1 <= len(files) <= 16:
        raise ValueError()
    if any(type(item) is not dict or set(item) != {'sha256','bytes'} or type(item['bytes']) is not int or item['bytes'] < 0 or
           not isinstance(item['sha256'],str) or not re.fullmatch(r'[0-9a-f]{64}',item['sha256']) for item in files.values()):
        raise ValueError()
    return {name:item['sha256'] for name,item in files.items()}


def main():
    # Preserve only the protocol descriptor; silence Python and native ML writes.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()),'wb',buffering=0)
    with open(os.devnull,'wb') as silence:
        os.dup2(silence.fileno(),1)
        os.dup2(silence.fileno(),2)
        os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',
                          USE_TF='0',TOKENIZERS_PARALLELISM='false',OMP_NUM_THREADS='4',MKL_NUM_THREADS='4',OPENBLAS_NUM_THREADS='4')
        parser = argparse.ArgumentParser(add_help=False)
        parser.add_argument('--checkpoint',required=True)
        parser.add_argument('--manifest',required=True)
        args = parser.parse_args()
        def factory():
            hashes = load_manifest(args.manifest)
            import torch
            torch.set_num_threads(4)
            torch.set_num_interop_threads(1)
            return adapter.LayaClassifier(args.checkpoint,hashes)
        try:
            return serve(sys.stdin.buffer,protocol,Worker(factory))
        finally:
            protocol.close()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        raise SystemExit(2)
