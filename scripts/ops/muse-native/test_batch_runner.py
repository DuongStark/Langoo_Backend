"""M10.5: meaningful inventory coverage, binding and resume tests, offline."""
import concurrent.futures
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
import batch_core as core
import batch_runner as runner
import batch_report


def record(lemma='test', count=3, offset=0):
    return {'lemma': lemma, 'senses': [
        {'senseId': str(offset + n + 1), 'lexemeId': '100', 'lemma': lemma,
         'definition': lemma + ' sense ' + str(n) + ' ' + ('x' * 130),
         'rawDefinition': 'Parent', 'glossEnContext': ['Parent', 'Leaf ' + str(n)],
         'source': 'wiktextract', 'sourceVersion': 'v1', 'pos': 'noun', 'senseNo': n + 1}
        for n in range(count)]}


def snapshot(*records):
    return {'read_only': True, 'records': list(records)}


def answer(tasks, marker='marker'):
    return {'job_id': marker, 'items': [{'lemma': t['lemma'],
        'selections': [{'id': t['senses'][0]['id'], 'anchor': t['senses'][0]['anchor']}],
        'reason': 'Nghĩa đời thường.', 'needs_review': False} for t in tasks]}


class Tests(unittest.TestCase):
    def test_failure_streak_stops_queue_after_inflight_jobs_drain(self):
        import sys
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            src = snapshot(*[record('word' + str(i), 2, i * 100) for i in range(10)])
            manifest = core.prepare(src, max_words=1)
            (out / 'jobs').mkdir()
            runner.write(out / 'input.json', src)
            runner.write(out / 'manifest.json', manifest)
            account = out / 'account.lock'
            account.touch()
            calls = []
            def fail(out, batch, *_args, **_kwargs):
                calls.append(batch['batch_id'])
                state = {'state': 'blocked', 'dispatch_started': False, 'elapsed_ms': 1}
                runner.write(out / 'jobs' / (batch['batch_id'] + '.json'), state)
                return state
            argv = ['batch_runner.py', 'run', '--out', str(out), '--workers', '3', '--failure-streak', '1']
            with patch.object(sys, 'argv', argv), patch.object(runner, 'ACCOUNT_LOCK', account), patch.object(runner, 'execute', side_effect=fail):
                self.assertEqual(runner.main(), 1)
            self.assertEqual(len(calls), 3)
            self.assertFalse((out / 'dispatch-count.json').exists())
            self.assertEqual(runner.read(out / 'results.json')['items'], [])

    def test_per_batch_repair_limit_survives_new_invocations(self):
        b = core.prepare(snapshot(record()))['batches'][0]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'jobs').mkdir()
            state = {'state': 'invalid_output', 'dispatch_started': True, 'repair_attempt': 2,
                     'raw_reply': json.dumps(answer(b['tasks'], 'wrong-marker'))}
            runner.write(out / 'jobs' / (b['batch_id'] + '.json'), state)
            with patch.object(runner, 'gateway') as gateway:
                with self.assertRaises(ValueError):
                    runner.execute(out, b, 10, 30, 1, repair=True)
                gateway.assert_not_called()
            self.assertFalse((out / 'dispatch-count.json').exists())

    def test_reconcile_interrupted_intent_without_latency_never_sends(self):
        b = core.prepare(snapshot(record()))['batches'][0]
        class FakeGateway:
            def close(self):
                pass
            def _open(self, *_args, **_kwargs):
                raise AssertionError('Reconciliation must never generate')
        def finish(_gw, state, batch, *_args):
            value = answer(batch['tasks'], state['job_id'])
            state.update(state='complete', output=value, raw_reply=json.dumps(value))
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'jobs').mkdir()
            path = out / 'jobs' / (b['batch_id'] + '.json')
            runner.write(path, {'state': 'dispatched', 'dispatch_started': True,
                                'session_id': 'private', 'job_id': 'marker'})
            with patch.object(runner, 'gateway', return_value=FakeGateway()), patch.object(runner, 'poll', side_effect=finish):
                state = runner.execute(out, b, 2, 30, 1, reconcile=True)
            self.assertEqual(state['state'], 'complete')
            self.assertIn('reconcile_elapsed_ms', state)
            self.assertNotIn('elapsed_ms', state)
            self.assertFalse((out / 'dispatch-count.json').exists())

    def test_complete_invalid_json_fails_fast_without_waiting_timeout(self):
        b = core.prepare(snapshot(record()))['batches'][0]
        value = answer(b['tasks'], 'wrong-marker')
        class FakeGateway:
            def call_json(self, *args, **kwargs):
                return {'chat_events': [{'event_name': 'message.assistant', 'seq': 1,
                                         'payload': {'content': json.dumps(value)}}]}
        state = {'session_id': 'private', 'job_id': 'expected'}
        with patch.object(runner.time, 'sleep') as sleep:
            runner.poll(FakeGateway(), state, b, 180, 2)
            self.assertEqual(state['state'], 'invalid_output')
            sleep.assert_not_called()

    def test_repair_archives_old_reply_and_reserves_new_dispatch(self):
        b = core.prepare(snapshot(record()))['batches'][0]
        class FakeGateway:
            def call_json(self, method, **kwargs):
                if method == 'session.start':
                    return {'id': '00000000-0000-0000-0000-000000000001'}
                return {'chat_events': []}
            def _open(self, *args, **kwargs):
                return 7
            def close(self):
                pass
        def finish(gw, state, batch, *_):
            value = answer(batch['tasks'], state['job_id'])
            state.update(state='complete', output=value, raw_reply=json.dumps(value))
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'jobs').mkdir()
            old = {'batch_id': b['batch_id'], 'job_id': 'old-marker', 'state': 'invalid_output',
                   'dispatch_started': True, 'raw_reply': json.dumps(answer(b['tasks'], 'wrong-marker'))}
            runner.write(out / 'jobs' / (b['batch_id'] + '.json'), old)
            runner.write(out / 'dispatch-count.json', {'count': 1, 'cap': 2})
            with patch.object(runner, 'gateway', return_value=FakeGateway()), patch.object(runner, 'poll', side_effect=finish):
                state = runner.execute(out, b, 2, 30, 1, repair=True)
            self.assertEqual(state['state'], 'complete')
            self.assertEqual(state['repair_attempt'], 1)
            self.assertEqual(runner.read(out / 'dispatch-count.json')['count'], 2)
            archived = list((out / 'attempts').glob('*.json'))
            self.assertEqual(len(archived), 1)
            self.assertEqual(runner.read(archived[0]), old)

    def test_only_complete_scoped_replies_can_be_repaired(self):
        b = core.prepare(snapshot(record()))['batches'][0]
        state = {'state': 'uncertain', 'dispatch_started': True}
        self.assertFalse(runner.repairable(state, b))
        state['raw_reply'] = '{"job_id":'
        self.assertFalse(runner.repairable(state, b))
        state['raw_reply'] = json.dumps(answer(b['tasks']))
        self.assertTrue(runner.repairable(state, b))
        wrong = answer(b['tasks'])
        wrong['items'][0]['lemma'] = 'different-job'
        state['raw_reply'] = json.dumps(wrong)
        self.assertFalse(runner.repairable(state, b))
    def test_reason_soft_target_but_binding_remains_strict(self):
        tasks = [core.task(core.compact(record()), 'final')]
        value = answer(tasks)
        value['items'][0]['reason'] = 'x' * 350
        core.validated_reply(json.dumps(value), 'marker', tasks)
        value['items'][0]['reason'] = 'x' * 1001
        with self.assertRaises(ValueError):
            core.validated_reply(json.dumps(value), 'marker', tasks)

    def test_report_refuses_review_drift_and_foreign_fix(self):
        src = snapshot(record())
        tasks = [core.task(core.compact(src['records'][0]), 'final')]
        output = {'snapshot_sha256': core.digest(src), 'items': answer(tasks)['items'], 'complete': True}
        review = {'snapshot_sha256': core.digest(src), 'output_sha256': core.digest(output),
                  'items': [{'lemma': 'test', 'verdict': 'pass', 'primary_ok': True, 'primary_vi': 'Nghĩa thử', 'note': ''}]}
        stats = {'latencies_ms': [1000], 'wall_ms': 1000, 'workers': 3, 'dispatches': 1, 'peak_rss_kib': 1024}
        result, _ = batch_report.build(src, output, review, stats)
        self.assertTrue(result['gate_pass'])
        review['items'][0]['suggested_ids'] = ['999']
        with self.assertRaises(ValueError):
            batch_report.build(src, output, review, stats)
        review['items'][0]['suggested_ids'] = []
        review['output_sha256'] = 'changed'
        with self.assertRaises(ValueError):
            batch_report.build(src, output, review, stats)
    def test_redundant_selection_metadata_only(self):
        tasks = [core.task(core.compact(record()), 'final')]
        value = answer(tasks)
        value['items'][0]['selections'][0].update(reason='Extra detail', needs_review=True)
        result, normalized = core.validated_reply(json.dumps(value), 'marker', tasks)
        self.assertIsNotNone(normalized)
        self.assertTrue(result['items'][0]['needs_review'])
        self.assertEqual(result['items'][0]['selections'][0]['id'], '1')
        value['items'][0]['selections'][0]['anchor'] = 'Wrong definition'
        with self.assertRaises(ValueError):
            core.validated_reply(json.dumps(value), 'marker', tasks)
        value['items'][0]['selections'][0]['other_field'] = 1
        with self.assertRaises(ValueError):
            core.validated_reply(json.dumps(value), 'marker', tasks)
    def test_generation_error_is_not_silently_discarded(self):
        gw = SimpleNamespace(generation_stream=7)
        frame = SimpleNamespace(stream_id=7, response=SimpleNamespace(status=429), WhichOneof=lambda _: 'response')
        with self.assertRaises(runner.GenerationRejected) as context:
            runner.observe_frame(gw, frame)
        self.assertEqual(context.exception.status, 429)
        frame.stream_id = 8
        runner.observe_frame(gw, frame)  # unrelated streams are not mixed into this job
        frame.stream_id = 7
        frame.response.status = 200
        runner.observe_frame(gw, frame)
        self.assertEqual(gw.generation_status, 200)

    def test_per_thread_connections_are_reused_and_isolated(self):
        barrier = threading.Barrier(3)
        def work():
            first = runner.acquire(True)
            barrier.wait(timeout=5)
            self.assertIs(first, runner.acquire(True))
            return id(first)
        with patch.object(runner, 'gateway', side_effect=lambda: object()) as create:
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                values = list(pool.map(lambda _: work(), range(3)))
            self.assertEqual(len(set(values)), 3)
            self.assertEqual(create.call_count, 3)
        runner.CONNECTIONS.clear()

    def test_safe_errors_keep_only_numeric_codes_and_known_labels(self):
        class Failure(RuntimeError):
            code = 22
            status = 503
        value = runner.safe_error(Failure('secret/auth_token=ABC http 503'), 'connect')
        self.assertEqual(value['error_code'], 22)
        self.assertEqual(value['error_status'], 503)
        self.assertNotIn('ABC', json.dumps(value))

    def test_fragment_coverage_no_cut_and_solo(self):
        source = snapshot(record(count=30))
        m = core.prepare(source, budget=5000, solo_senses=10)
        batches = m['batches']
        self.assertGreater(len(batches), 1)
        ids = [s['id'] for b in batches for t in b['tasks'] for s in t['senses']]
        self.assertEqual(set(ids), {s['senseId'] for s in source['records'][0]['senses']})
        self.assertEqual(len(ids), 30)
        self.assertTrue(all(b['solo'] and core.fits(b['tasks'], 5000) for b in batches))
        self.assertEqual(m, core.prepare(source, budget=5000, solo_senses=10))

    def test_pack_small_words_and_track_solo(self):
        m = core.prepare(snapshot(record('a', 2), record('b', 3, 100), record('c', 10, 200)), solo_senses=10)
        self.assertEqual(len(m['batches']), 2)
        self.assertEqual(sorted(len(b['tasks']) for b in m['batches']), [1, 2])
        self.assertEqual(m['words'][0]['lemma'], 'c')

    def test_oversize_and_bad_inventory(self):
        r = record()
        r['senses'][0]['definition'] = 'x' * 10000
        with self.assertRaises(ValueError):
            core.prepare(snapshot(r), budget=5000)
        with self.assertRaises(ValueError):
            core.prepare(snapshot(record(), record()))
        with self.assertRaises(ValueError):
            core.prepare({'read_only': False, 'records': [record()]})

    def test_marker_id_anchor_and_cross_word(self):
        tasks = [core.task(core.compact(record('a')), 'final'), core.task(core.compact(record('b', offset=100)), 'final')]
        value = answer(tasks)
        core.validate(json.dumps(value), 'marker', tasks)
        with self.assertRaises(ValueError):
            core.validate(json.dumps(value), 'other marker', tasks)
        for picks in ([{'id': '101', 'anchor': tasks[1]['senses'][0]['anchor']}],
                      [{'id': '1', 'anchor': 'wrong definition'}]):
            value['items'][0]['selections'] = picks
            with self.assertRaises(ValueError):
                core.validate(json.dumps(value), 'marker', tasks)

    def test_empty_duplicate_schema(self):
        tasks = [core.task(core.compact(record()), 'final')]
        value = answer(tasks)
        value['items'][0]['selections'] *= 2
        with self.assertRaises(ValueError):
            core.validate(json.dumps(value), 'marker', tasks)
        value['items'][0]['selections'] = []
        with self.assertRaises(ValueError):
            core.validate(json.dumps(value), 'marker', tasks)
        value['items'][0]['needs_review'] = True
        core.validate(json.dumps(value), 'marker', tasks)
        value['extra'] = 1
        with self.assertRaises(ValueError):
            core.validate(json.dumps(value), 'marker', tasks)

    def test_final_shortlist_binding(self):
        r = record()
        tasks = [core.task(core.compact(r), 'part')]
        rows = answer(tasks)['items']
        b = core.final_batch(r, rows, {'prompt_budget_chars': 40000})
        self.assertEqual([s['id'] for s in b['tasks'][0]['senses']], ['1'])
        self.assertEqual(b['tasks'][0]['coverage']['source_senses'], 3)
        rows[0]['selections'][0]['id'] = '999'
        with self.assertRaises(ValueError):
            core.final_batch(r, rows, {'prompt_budget_chars': 40000})

    def test_uncertain_no_resend_and_no_secret_error(self):
        b = core.prepare(snapshot(record()))['batches'][0]
        class BrokenGateway:
            def call_json(self, method, **kwargs):
                if method == 'session.start':
                    return {'id': '00000000-0000-0000-0000-000000000001'}
                return {'chat_events': []}
            def _open(self, *args, **kwargs):
                raise RuntimeError('SECRET-cookie-in-external-exception')
            def close(self):
                pass
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'jobs').mkdir()
            with patch.object(runner, 'gateway', return_value=BrokenGateway()) as create:
                state = runner.execute(out, b, 1, 30, 1)
                self.assertEqual(state['state'], 'uncertain')
                runner.execute(out, b, 1, 30, 1)
                self.assertEqual(create.call_count, 1)
            content = (out / 'jobs' / (b['batch_id'] + '.json')).read_text()
            self.assertNotIn('SECRET', content)
            self.assertEqual(runner.read(out / 'dispatch-count.json')['count'], 1)
            with self.assertRaises(ValueError):
                runner.reserve(out, 1)

    def test_snapshot_manifest_drift_and_completion(self):
        src = snapshot(record())
        m = core.prepare(src)
        b = m['batches'][0]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'jobs').mkdir()
            runner.write(out / 'input.json', src)
            runner.write(out / 'manifest.json', m)
            value = answer(b['tasks'])
            runner.write(out / 'jobs' / (b['batch_id'] + '.json'), {'state': 'complete', 'job_id': 'marker', 'raw_reply': json.dumps(value)})
            runner.inspect(out, m, src)
            self.assertTrue(runner.read(out / 'results.json')['complete'])
            runner.load(out)
            m['batches'][0]['tasks'][0]['senses'][0]['anchor'] = 'tampered'
            runner.write(out / 'manifest.json', m)
            with self.assertRaises(ValueError):
                runner.load(out)

    def test_dependent_batches_refuse_drift(self):
        src = snapshot(record(count=30))
        m = core.prepare(src, budget=5000)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'jobs').mkdir()
            for b in m['batches']:
                value = answer(b['tasks'])
                runner.write(out / 'jobs' / (b['batch_id'] + '.json'), {'state': 'complete', 'job_id': 'marker', 'raw_reply': json.dumps(value)})
            runner.inspect(out, m, src)
            dependent = runner.read(out / 'final-batches.json')
            self.assertEqual(len(dependent), 1)
            dependent[0]['tasks'][0]['senses'][0]['display_definition'] = 'Other meaning'
            runner.write(out / 'final-batches.json', dependent)
            with self.assertRaises(ValueError):
                runner.inspect(out, m, src)


if __name__ == '__main__':
    unittest.main()
