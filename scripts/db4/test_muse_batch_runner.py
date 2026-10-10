"""Offline state-machine tests for the DB4-D4/D5 native Muse batch runner."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


RUNNER_PATH = Path(__file__).with_name('muse-batch-runner.py')
SPEC = importlib.util.spec_from_file_location('db4_muse_batch_runner', RUNNER_PATH)
runner = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(runner)


class SimulatedCrash(BaseException):
    pass


def make_request(index: int, phase: str = 'r1', dependency: str | None = None):
    job_key = f'{index + 1:064x}'
    target_key = f'{index + 101:064x}'
    bundle_key = f'{index + 201:064x}'
    return {
        'jobKey': job_key,
        'targetKey': target_key,
        'senseKey': f'jmdict:100{index}:{index + 1}',
        'phase': phase,
        'generation': 1,
        'bundleKey': bundle_key,
        'promptVersion': f'db4-d4-semantic-match-v2.1-{phase}',
        'promptHash': 'a' * 64,
        'renderedContextHash': 'b' * 64,
        'dependencyJobKey': dependency,
        'payload': {
            'schemaVersion': 1,
            'phase': phase,
            'seed': f'fixture:{index}:{phase}',
            'promptVersion': f'db4-d4-semantic-match-v2.1-{phase}',
            'bundle': {'bundleKey': bundle_key, 'sense': {'id': str(index + 1)}},
        },
    }


def make_run(requests, cap: int = 10):
    jobs = []
    for request in requests:
        jobs.append({
            'jobKey': request['jobKey'],
            'targetKey': request['targetKey'],
            'senseKey': request['senseKey'],
            'shardId': 'dev-01',
            'generation': 1,
            'kind': 'review',
            'phase': request['phase'],
            'attempt': 1,
        })
    return {
        'manifest': {
            'runId': 'fixture-run',
            'caps': {
                'workers': 8,
                'requestTimeoutSeconds': 240,
                'mappingDispatches': cap,
            },
        },
        'prefix': 'runs/fixture-run',
        'schedule': jobs,
        'jobs_by_key': {job['jobKey']: job for job in jobs},
        'requests': {
            'r1': [request for request in requests if request['phase'] == 'r1'],
            'r2': [request for request in requests if request['phase'] == 'r2'],
        },
        'prompt': {'system': 'system prompt', 'r1': 'review prompt', 'r2': 'challenge prompt'},
    }


class FakeTransport(runner.Transport):
    def __init__(self, root: Path, mode: str = 'success'):
        self.root = root
        self.mode = mode
        self.prompts = {}
        self.prepare_calls = 0
        self.generate_calls = 0
        self.saw_intent_before_generate = False

    def prepare(self, request):
        self.prepare_calls += 1
        if self.mode == 'prepare_error':
            raise TimeoutError('fixture session failure')
        return {'sessionId': f'private-session-{self.prepare_calls}'}

    def generate(self, session, request, message, on_ack):
        self.generate_calls += 1
        ledger_path = self.root / 'runs/fixture-run/ledger/events.jsonl'
        events = [json.loads(line) for line in ledger_path.read_text().splitlines()]
        self.saw_intent_before_generate = any(
            event['jobKey'] == request['jobKey']
            and event['type'] == 'dispatch_intent_persisted'
            for event in events
        )
        if self.mode == 'crash_after_intent':
            raise SimulatedCrash()
        on_ack()
        if self.mode == 'unknown_after_ack':
            raise TimeoutError('fixture lost completion')
        if self.mode in ('rate_limit', 'auth_block'):
            error = TimeoutError('fixture gateway rejection')
            error.status = 429 if self.mode == 'rate_limit' else 401
            raise error
        return '{"fixture":"complete"}'

    def reconcile(self, session, request):
        return None


class BatchRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='db4-runner-')
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_r1(self, run, transport_factory, **kwargs):
        return runner.run_queue(
            self.root,
            run,
            'r1',
            1,
            30,
            1.0,
            transport_factory,
            validate_after=False,
            **kwargs,
        )

    def test_event_hash_chain_matches_typescript_contract(self):
        expected = {
            'eventId': 'e2755709976c42cc937a6bbffc756a9f8fe15ec8fd94164dd6b9442d92130c38',
            'eventSha256': 'b5b730f5a5ca079cf53f2202b2de9db433ceaa7185ffa92d575e9cf430d1ac11',
        }
        event = runner.make_event(
            'fixture-run', 0, None, None, 'run_started',
            {'mode': 'shadow', 'apply': False}, '2026-10-10T00:00:00.000Z',
        )
        self.assertEqual(event['eventId'], expected['eventId'])
        self.assertEqual(event['eventSha256'], expected['eventSha256'])
        self.assertEqual(runner.verify_events([event], 'fixture-run'), [event])

    def test_intent_is_durable_before_generation_and_completed_raw_is_saved(self):
        request = make_request(0)
        run = make_run([request])
        transport = FakeTransport(self.root)
        result = self.run_r1(run, lambda: transport)
        self.assertEqual(result['dispatchIntents'], 1)
        self.assertTrue(transport.saw_intent_before_generate)
        self.assertEqual(transport.generate_calls, 1)
        events = runner.read_ledger_readonly(self.root, run['prefix'], 'fixture-run')
        self.assertEqual(sum(event['type'] == 'response_saved' for event in events), 1)
        private = runner.job_state(self.root, run['prefix'], request['jobKey'])
        self.assertEqual(private['state'], 'response_saved')

    def test_unknown_after_intent_is_parked_and_never_resent(self):
        request = make_request(0)
        run = make_run([request])
        first = FakeTransport(self.root, 'unknown_after_ack')
        self.run_r1(run, lambda: first)
        self.assertEqual(first.generate_calls, 1)
        second = FakeTransport(self.root)
        result = self.run_r1(run, lambda: second)
        self.assertEqual(second.prepare_calls, 0)
        self.assertEqual(second.generate_calls, 0)
        self.assertEqual(result['dispatchIntents'], 1)

    def test_crash_after_persisted_intent_is_not_resent(self):
        request = make_request(0)
        run = make_run([request])
        first = FakeTransport(self.root, 'crash_after_intent')
        with self.assertRaises(SimulatedCrash):
            self.run_r1(run, lambda: first)
        events = runner.read_ledger_readonly(self.root, run['prefix'], 'fixture-run')
        self.assertEqual(sum(event['type'] == 'dispatch_intent_persisted' for event in events), 1)
        self.assertEqual(sum(event['type'] == 'dispatch_acknowledged' for event in events), 0)
        second = FakeTransport(self.root)
        self.run_r1(run, lambda: second)
        self.assertEqual(second.generate_calls, 0)

    def test_pre_intent_failure_can_resume_unsent_job(self):
        request = make_request(0)
        run = make_run([request])
        failed = FakeTransport(self.root, 'prepare_error')
        first = self.run_r1(run, lambda: failed)
        self.assertEqual(first['dispatchIntents'], 0)
        resumed = FakeTransport(self.root)
        second = self.run_r1(run, lambda: resumed)
        self.assertEqual(second['dispatchIntents'], 1)
        self.assertEqual(resumed.generate_calls, 1)

    def test_dispatch_cap_counts_persisted_intents(self):
        requests = [make_request(0), make_request(1)]
        run = make_run(requests, cap=1)
        transports = []

        def factory():
            transport = FakeTransport(self.root)
            transports.append(transport)
            return transport

        result = self.run_r1(run, factory)
        self.assertEqual(result['dispatchIntents'], 1)
        self.assertEqual(sum(item.generate_calls for item in transports), 1)

    def test_invocation_cap_reserves_slots_before_concurrent_dispatch(self):
        requests = [make_request(index) for index in range(3)]
        run = make_run(requests)
        transports = []

        def factory():
            transport = FakeTransport(self.root)
            transports.append(transport)
            return transport

        result = runner.run_queue(
            self.root,
            run,
            'r1',
            8,
            30,
            1.0,
            factory,
            validate_after=False,
            max_new_dispatches=1,
        )

        self.assertEqual(result['dispatchedThisInvocation'], 1)
        self.assertTrue(result['invocationDispatchCapReached'])
        self.assertEqual(sum(item.generate_calls for item in transports), 1)
        self.assertEqual(result['states']['pending'], 2)

    def test_rate_limit_cools_down_once_and_continues_only_unsent_jobs(self):
        requests = [make_request(0), make_request(1)]
        run = make_run(requests, cap=10)
        transports = []
        cooldowns = []

        def factory():
            transport = FakeTransport(
                self.root,
                'rate_limit' if not transports else 'success',
            )
            transports.append(transport)
            return transport

        result = self.run_r1(
            run,
            factory,
            cooldown_sleep=cooldowns.append,
            max_cooldown=60,
        )
        self.assertEqual(cooldowns, [60])
        self.assertEqual([item.generate_calls for item in transports], [1, 1])
        self.assertEqual(result['dispatchIntents'], 2)
        self.assertFalse(result['breakerOpen'])
        events = runner.read_ledger_readonly(self.root, run['prefix'], 'fixture-run')
        self.assertTrue(any(event['type'] == 'breaker_recovered' for event in events))

    def test_auth_failure_opens_breaker_and_stops_new_dispatch(self):
        requests = [make_request(0), make_request(1)]
        run = make_run(requests, cap=10)
        transports = []

        def factory():
            transport = FakeTransport(
                self.root,
                'auth_block' if not transports else 'success',
            )
            transports.append(transport)
            return transport

        result = self.run_r1(run, factory)
        self.assertTrue(result['breakerOpen'])
        self.assertEqual(result['dispatchIntents'], 1)
        self.assertEqual(len(transports), 1)
        with self.assertRaises(runner.RunnerError):
            self.run_r1(run, lambda: FakeTransport(self.root))

    def test_r2_is_eligible_only_after_validated_unique_exact(self):
        r1_a = make_request(0, 'r1')
        r1_b = make_request(1, 'r1')
        r1_c = make_request(2, 'r1')
        r2_a = make_request(0, 'r2', r1_a['jobKey'])
        r2_b = make_request(1, 'r2', r1_b['jobKey'])
        r2_c = make_request(2, 'r2', r1_c['jobKey'])
        rows = [
            {'jobKey': r1_a['jobKey'], 'state': 'validated', 'r2Eligible': True},
            {'jobKey': r1_b['jobKey'], 'state': 'pending', 'r2Eligible': None},
            {'jobKey': r1_c['jobKey'], 'state': 'invalid_output', 'r2Eligible': False},
        ]
        ready, skipped, parked = runner.eligible_r2_jobs([r2_a, r2_b, r2_c], rows)
        self.assertEqual([row['jobKey'] for row in ready], [r2_a['jobKey']])
        self.assertEqual([(row['jobKey'], reason) for row, reason in skipped], [(r2_c['jobKey'], 'r1_invalid')])
        self.assertEqual([row['jobKey'] for row in parked], [r2_b['jobKey']])

    def test_r2_validation_requires_a_complete_identity_bound_r1_manifest(self):
        r1 = make_request(0, 'r1')
        r2 = make_request(0, 'r2', r1['jobKey'])
        run = make_run([r1, r2])
        run['manifest_path'] = 'runs/fixture-run/run-manifest.json'
        schedule_bytes = (json.dumps(run['schedule'], separators=(',', ':')) + '\n').encode()
        schedule_ref = {
            'path': 'runs/fixture-run/schedule.jsonl',
            'sha256': runner.sha256(schedule_bytes),
        }
        run['manifest']['artifacts'] = {'schedule': schedule_ref}
        manifest_bytes = (json.dumps(run['manifest'], separators=(',', ':')) + '\n').encode()
        manifest_path = self.root / run['manifest_path']
        manifest_path.parent.mkdir(parents=True)
        manifest_path.write_bytes(manifest_bytes)
        run['manifest_sha256'] = runner.sha256(manifest_bytes)
        schedule_path = self.root / schedule_ref['path']
        schedule_path.write_bytes(schedule_bytes)

        ledger = runner.Ledger(self.root, run['prefix'], 'fixture-run')
        ledger.append(None, 'run_started', {'mode': 'shadow', 'apply': False})
        ledger.append(r1['jobKey'], 'job_planned', {'phase': 'r1'})
        ledger.append(r1['jobKey'], 'dispatch_intent_persisted', {'phase': 'r1'})
        ledger.append(r1['jobKey'], 'response_saved', {
            'phase': 'r1',
            'responsePath': run['prefix'] + '/responses/raw/' + r1['jobKey'] + '.txt',
            'responseSha256': 'c' * 64,
            'bytes': 2,
        })
        result_row = {
            'runId': 'fixture-run',
            'jobKey': r1['jobKey'],
            'targetKey': r1['targetKey'],
            'senseKey': r1['senseKey'],
            'phase': 'r1',
            'state': 'validated',
            'rawResponse': None,
            'outputHash': 'd' * 64,
            'output': {'fixture': 'D1 validated'},
            'r2Eligible': True,
            'errorType': None,
        }
        result_bytes = (json.dumps(result_row, separators=(',', ':')) + '\n').encode()
        result_ref = {
            'path': run['prefix'] + '/validation/r1/results.jsonl',
            'sha256': runner.sha256(result_bytes),
        }
        result_path = self.root / result_ref['path']
        result_path.parent.mkdir(parents=True)
        result_path.write_bytes(result_bytes)
        ledger_bytes = (self.root / run['prefix'] / 'ledger/events.jsonl').read_bytes()
        validation_manifest = {
            'schemaVersion': 1,
            'task': 'db4_batch_validation',
            'runId': 'fixture-run',
            'phase': 'r1',
            'runManifest': {
                'path': run['manifest_path'],
                'sha256': run['manifest_sha256'],
            },
            'schedule': schedule_ref,
            'sourceLedger': {
                'path': run['prefix'] + '/ledger/events.jsonl',
                'sha256': runner.sha256(ledger_bytes),
            },
            'sourceLedgerHead': ledger.events[-1]['eventSha256'],
            'results': result_ref,
            'counts': {'validated': 1, 'r2_eligible': 1},
            'allRequestsRetained': True,
        }
        validation_path = run['prefix'] + '/validation/r1/manifest.json'
        runner.atomic_immutable(
            self.root / validation_path,
            (json.dumps(validation_manifest, separators=(',', ':')) + '\n').encode(),
        )
        _, rows = runner.validate_r2_gate(self.root, validation_path, run, ledger)
        self.assertEqual(rows[0]['r2Eligible'], True)
        ledger.append(r2['jobKey'], 'job_planned', {'phase': 'r2'})
        runner.validate_r2_gate(self.root, validation_path, run, ledger)

    def test_lock_refuses_a_second_runner_and_status_read_is_read_only(self):
        lock_path = self.root / 'locks/account.lock'
        first = runner.acquire_lock(lock_path)
        try:
            with self.assertRaises(runner.RunnerError):
                runner.acquire_lock(lock_path)
        finally:
            first.close()
        self.assertFalse((self.root / 'runs/fixture-run/ledger').exists())
        self.assertEqual(runner.read_ledger_readonly(self.root, 'runs/fixture-run', 'fixture-run'), [])
        self.assertFalse((self.root / 'runs/fixture-run/ledger').exists())


if __name__ == '__main__':
    unittest.main()
