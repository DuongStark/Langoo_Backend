"""M10.5: bulk durability, data binding, bounded retries and direct output tests."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import bulk_runner as bulk
import batch_runner as runner
from batch_core import digest
from test_batch_runner import record, snapshot, answer


def inventory(folder, groups):
    folder.mkdir()
    shards = []
    for i, records in enumerate(groups):
        path = folder / ('snapshot-' + str(i) + '.json')
        runner.write(path, snapshot(*records))
        shards.append({'file': path.name, 'words': len(records),
                       'senses': sum(len(r['senses']) for r in records), 'file_sha256': bulk.file_hash(path)})
    runner.write(folder / 'inventory.json', {'read_only': True, 'words': sum(s['words'] for s in shards),
                                            'senses': sum(s['senses'] for s in shards), 'shards': shards})


def completed(folder):
    manifest = runner.read(folder / 'manifest.json')
    for batch in manifest['batches']:
        output = answer(batch['tasks'], 'marker')
        # An uncertainty flag is metadata, not a second semantic gate.
        for row in output['items']:
            row['needs_review'] = True
        runner.write(folder / 'jobs' / (batch['batch_id'] + '.json'),
                     {'batch_id': batch['batch_id'], 'state': 'complete', 'job_id': 'marker',
                      'raw_reply': json.dumps(output), 'dispatch_started': True, 'elapsed_ms': 100})
    runner.write(folder / 'dispatch-count.json', {'count': len(manifest['batches'])})


class Tests(unittest.TestCase):
    def setUp(self):
        bulk.STOP.clear()

    def test_interrupted_prepare_resumes_only_with_same_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory(root / 'inventory', [[record('cat')], [record('dog', offset=100)]])
            actual = bulk.write
            def interrupted(path, value):
                if path.name == 'bulk-manifest.json':
                    raise OSError('Simulated interruption before preparation commit')
                actual(path, value)
            with patch.object(bulk, 'write', side_effect=interrupted):
                with self.assertRaises(OSError):
                    bulk.prepare_bulk(root / 'inventory', root / 'run')
            with self.assertRaises(ValueError):
                bulk.prepare_bulk(root / 'inventory', root / 'run', workers=4)
            manifest = bulk.prepare_bulk(root / 'inventory', root / 'run')
            self.assertEqual(manifest['words'], 2)
            self.assertEqual(bulk.load_bulk(root / 'run')[0], manifest)
            with self.assertRaises(FileExistsError):
                bulk.prepare_bulk(root / 'inventory', root / 'run')

    def test_shards_output_direct_resume_no_dispatch_and_flags_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory(root / 'inventory', [[record('cat')], [record('dog', offset=100)]])
            manifest = bulk.prepare_bulk(root / 'inventory', root / 'run')
            calls = []
            def invoke(out, _, spec, command, state):
                self.assertEqual(command, 'run')
                calls.append(spec['name'])
                completed(out / 'shards' / spec['name'])
                return 0
            with patch.object(bulk, 'invoke', side_effect=invoke):
                self.assertEqual(bulk.run_bulk(root / 'run'), 0)
                self.assertEqual(bulk.run_bulk(root / 'run'), 0)
            self.assertEqual(len(calls), 2)
            rows = [json.loads(line) for line in (root / 'run' / 'results.jsonl').read_text().splitlines()]
            self.assertEqual({r['lemma'] for r in rows}, {'cat', 'dog'})
            self.assertTrue(all(r['needs_review'] for r in rows))
            self.assertTrue(all(r['policy'] == 'muse_direct_no_semantic_recheck' for r in rows))
            progress = runner.read(root / 'run' / 'progress.json')
            self.assertEqual(progress['state'], 'complete')
            self.assertEqual(progress['words_complete'], 2)
            self.assertFalse(progress['semantic_rechecked'])
            self.assertEqual(manifest['max_dispatches'], 22)

    def test_preflight_outage_pauses_at_first_shard_bounded_rounds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory(root / 'inventory', [[record('cat')], [record('dog', offset=100)]])
            bulk.prepare_bulk(root / 'inventory', root / 'run')
            calls = []
            def invoke(out, _, spec, command, state):
                calls.append((spec['name'], command))
                return 1
            with patch.object(bulk, 'invoke', side_effect=invoke), patch.object(bulk.STOP, 'wait', return_value=False):
                self.assertEqual(bulk.run_bulk(root / 'run'), 75)
            self.assertEqual(calls, [('shard-0001', 'run')] * 3)
            progress = runner.read(root / 'run' / 'progress.json')
            self.assertEqual(progress['state'], 'waiting_provider')
            self.assertEqual(progress['shards_settled'], 0)
            self.assertEqual(progress['dispatches'], 0)

    def test_unknown_send_only_reconciled_never_created_anew(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory(root / 'inventory', [[record('cat')]])
            bulk.prepare_bulk(root / 'inventory', root / 'run')
            folder = root / 'run' / 'shards' / 'shard-0001'
            manifest = runner.read(folder / 'manifest.json')
            batch = manifest['batches'][0]
            runner.write(folder / 'jobs' / (batch['batch_id'] + '.json'),
                         {'state': 'uncertain', 'dispatch_started': True, 'session_id': 'private', 'job_id': 'marker'})
            runner.write(folder / 'dispatch-count.json', {'count': 1})
            calls = []
            def invoke(*args):
                calls.append(args[3])
                return 1
            with patch.object(bulk, 'invoke', side_effect=invoke), patch.object(bulk.STOP, 'wait', return_value=False):
                self.assertEqual(bulk.run_bulk(root / 'run'), 0)
            self.assertEqual(calls[0], 'reconcile')
            self.assertEqual(runner.read(folder / 'dispatch-count.json')['count'], 1)
            self.assertEqual(runner.read(root / 'run' / 'progress.json')['state'], 'complete_with_unresolved')
            self.assertEqual(json.loads((root / 'run' / 'unresolved.json').read_text())[0]['lemma'], 'cat')
            self.assertNotIn('private', (root / 'run' / 'unresolved.json').read_text())

    def test_hash_drift_refused_source_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory(root / 'inventory', [[record('cat')]])
            bulk.prepare_bulk(root / 'inventory', root / 'run')
            manifest, state = bulk.load_bulk(root / 'run')
            manifest['config']['workers'] = 4
            runner.write(root / 'run' / 'bulk-manifest.json', manifest)
            with self.assertRaises(ValueError):
                bulk.load_bulk(root / 'run')
            state['manifest_sha256'] = digest(manifest)
            runner.write(root / 'run' / 'bulk-state.json', state)
            source = root / 'run' / 'shards' / 'shard-0001' / 'source.json'
            changed = runner.read(source)
            changed['records'][0]['senses'][0]['definition'] = 'Changed source'
            runner.write(source, changed)
            with self.assertRaises(ValueError):
                bulk.run_bulk(root / 'run')

    def test_empty_source_id_excluded_without_losing_word_or_full_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            r = record('cat')
            r['senses'].append({**r['senses'][0], 'senseId': '99', 'definition': '',
                                'rawDefinition': None, 'glossEnContext': []})
            inventory(root / 'inventory', [[r]])
            manifest = bulk.prepare_bulk(root / 'inventory', root / 'run')
            spec = manifest['shards'][0]
            folder = root / 'run' / 'shards' / spec['name']
            self.assertEqual(spec['runnable_words'], 1)
            self.assertEqual(spec['excluded_empty_senses'][0]['ids'], ['99'])
            self.assertEqual(runner.read(folder / 'source.json')['records'][0], r)
            self.assertEqual(len(runner.read(folder / 'input.json')['records'][0]['senses']), 3)
            self.assertEqual(spec['blocked_source'], [])

    def test_bad_source_preserved_and_other_words_continue(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bad = {'lemma': 'empty', 'senses': []}
            inventory(root / 'inventory', [[bad, record('cat')]])
            manifest = bulk.prepare_bulk(root / 'inventory', root / 'run')
            spec = manifest['shards'][0]
            self.assertEqual(spec['runnable_words'], 1)
            self.assertEqual(spec['blocked_source'], [{'lemma': 'empty', 'state': 'source_not_preparable'}])
            source = runner.read(root / 'run' / 'shards' / spec['name'] / 'source.json')
            self.assertEqual(source['records'][0], bad)

    def test_cross_shard_collision_and_path_traversal_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory(root / 'inventory', [[record('cat')], [record('dog')]])
            with self.assertRaises(ValueError):
                bulk.prepare_bulk(root / 'inventory', root / 'run')
            with self.assertRaises(ValueError):
                bulk.safe_child(root, '../cookies.json')

    def test_collector_checks_actual_reply_even_with_valid_outer_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory(root / 'inventory', [[record('cat')]])
            manifest = bulk.prepare_bulk(root / 'inventory', root / 'run')
            spec = manifest['shards'][0]
            folder = root / 'run' / 'shards' / spec['name']
            completed(folder)
            bulk.save_results(root / 'run', manifest, spec)
            path = next((folder / 'jobs').glob('*.json'))
            state = runner.read(path)
            output = json.loads(state['raw_reply'])
            output['items'][0]['selections'][0]['id'] = '999999'
            state['raw_reply'] = json.dumps(output)
            runner.write(path, state)
            with self.assertRaises(ValueError):
                bulk.save_results(root / 'run', manifest, spec)

    def test_exhausted_cap_is_quarantined_not_endless_preflight_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory(root / 'inventory', [[record('cat')]])
            manifest = bulk.prepare_bulk(root / 'inventory', root / 'run')
            spec = manifest['shards'][0]
            folder = root / 'run' / 'shards' / spec['name']
            runner.write(folder / 'dispatch-count.json', {'count': spec['max_dispatches']})
            result = bulk.save_results(root / 'run', manifest, spec)
            self.assertFalse(result['retryable_preflight'])


if __name__ == '__main__':
    unittest.main()
