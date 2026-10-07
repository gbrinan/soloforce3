"""JSON stdin/stdout bridge; calls the pinned upstream without modifying its files."""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def main():
    manifest = json.loads((ROOT / 'vendor/ingestiger/manifest.json').read_text(encoding='utf-8'))
    module_path = ROOT / 'vendor/ingestiger' / manifest['commit'] / 'skills/ingestiger/scripts/pipeline.py'
    spec = importlib.util.spec_from_file_location('ingestiger_pipeline', module_path)
    core = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(core)
    body = json.load(sys.stdin)
    operation = body['operation']
    if operation == 'probe':
        return {'python': sys.version.split()[0], 'schemaVersion': core.VERSION}
    if operation == 'prepare':
        return core.prepare(body['source'], body['model'], body['maxChars'], defer_oversized=body.get('deferOversized', False))
    if operation == 'build':
        with tempfile.TemporaryDirectory(prefix='ingestiger-candidate-') as temporary:
            output = Path(temporary) / 'candidate'
            core.build(body['request'], body['response'], output)
            return {'validation': json.loads((output / 'validation.json').read_text(encoding='utf-8'))}
    if operation == 'compose':
        spec = importlib.util.spec_from_file_location('ingestiger_knowledge', module_path.with_name('knowledge.py'))
        knowledge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(knowledge)
        return knowledge.compose(body['previous'], body['candidate'], body['review'])
    raise ValueError('Unknown operation')


if __name__ == '__main__':
    try:
        print(json.dumps({'ok': True, 'result': main()}, ensure_ascii=True))
    except (ValueError, KeyError, TypeError, OSError):
        # Source text and credentials never enter subprocess error logs.
        print(json.dumps({'ok': False, 'error': 'upstream_validation_failed'}))
        sys.exit(2)
