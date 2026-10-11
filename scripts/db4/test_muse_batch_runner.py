"""Offline state-machine tests for the DB4-D4/D5 native Muse batch runner."""
from __future__ import annotations

import importlib.util
import json
import struct
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch


RUNNER_PATH = Path(__file__).with_name('muse-batch-runner.py')
SPEC = importlib.util.spec_from_file_location('db4_muse_batch_runner', RUNNER_PATH)
runner = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(runner)


class SimulatedCrash(BaseException):
    pass


class NativeMuseEnvelopeChunkingTests(unittest.TestCase):
    def test_large_service_envelope_is_split_under_noise_limit(self):
        sent_frames = []
        encoded_frames = []

        class FakeRequest:
            def __init__(self, service, payload):
                self.service = service
                self.payload = payload

            def SerializeToString(self):
                return bytes([self.service]) + self.payload

        class FakeNoiseFrame:
            def __init__(self, chunk_id, chunk_index, total_chunks, payload):
                self.chunk_id = chunk_id
                self.chunk_index = chunk_index
                self.total_chunks = total_chunks
                self.payload = payload

            def SerializeToString(self):
                encoded = struct.pack(
                    '<qII', self.chunk_id, self.chunk_index, self.total_chunks
                ) + self.payload
                encoded_frames.append(encoded)
                return encoded

        class FakeNoise:
            def encrypt(self, value):
                return value

        class FakeSocket:
            def send_bytes(self, value):
                sent_frames.append(value)

        class FakeGateway:
            def __init__(self, cookies):
                self.cookies = cookies
                self._send_lock = threading.Lock()
                self.noise = FakeNoise()
                self.ws = FakeSocket()

        muse_module = types.ModuleType('muse')
        muse_module.Gateway = FakeGateway
        muse_module.NoiseTransportFrame = FakeNoiseFrame
        muse_module.ServiceRequest = FakeRequest
        muse_module.load_cookies = lambda path: 'fixture-cookie'
        noise_module = types.ModuleType('noise')
        noise_module.__path__ = []
        noise_constants = types.ModuleType('noise.constants')
        noise_constants.MAX_MESSAGE_LEN = 65_535

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cookie_file = root / 'cookies.json'
            cookie_file.write_text('{}', encoding='utf-8')
            with (
                patch.object(runner, 'TRANSPORT_ROOT', root),
                patch.object(runner, 'COOKIE_FILE', cookie_file),
                patch.dict('sys.modules', {
                    'muse': muse_module,
                    'noise': noise_module,
                    'noise.constants': noise_constants,
                }),
            ):
                gateway = runner.NativeMuseTransport._gateway()
                payload = b'large-request-' * 8_000
                gateway._send_envelope(2, payload)

        self.assertEqual(len(sent_frames), 3)
        self.assertEqual(len(encoded_frames), 3)
        self.assertEqual(
            b''.join(frame[16:] for frame in encoded_frames),
            bytes([2]) + payload,
        )
        self.assertLessEqual(max(map(len, sent_frames)), 65_535)
        self.assertEqual(
            [struct.unpack('<qII', frame[:16])[1:] for frame in encoded_frames],
            [(0, 3), (1, 3), (2, 3)],
        )


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
        self.assertEqual(run['requests']['r1'], [])
        events = runner.read_ledger_readonly(self.root, run['prefix'], 'fixture-run')
        self.assertEqual(sum(event['type'] == 'response_saved' for event in events), 1)
        ack = next(event for event in events if event['type'] == 'dispatch_acknowledged')
        self.assertEqual(ack['details'], {
            'phase': 'r1',
            'generation': 1,
            'attempt': 1,
            'acknowledged': True,
        })
        private = runner.job_state(self.root, run['prefix'], request['jobKey'])
        self.assertEqual(private['state'], 'response_saved')

    def test_unknown_after_intent_is_parked_and_never_resent(self):
        request = make_request(0)
        run = make_run([request])
        first = FakeTransport(self.root, 'unknown_after_ack')
        self.run_r1(run, lambda: first)
        self.assertEqual(first.generate_calls, 1)
        run = make_run([request])
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
        run = make_run([request])
        second = FakeTransport(self.root)
        self.run_r1(run, lambda: second)
        self.assertEqual(second.generate_calls, 0)

    def test_pre_intent_failure_can_resume_unsent_job(self):
        request = make_request(0)
        run = make_run([request])
        failed = FakeTransport(self.root, 'prepare_error')
        first = self.run_r1(run, lambda: failed)
        self.assertEqual(first['dispatchIntents'], 0)
        run = make_run([request])
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
        run['requests']['r1'] = []
        run['manifest']['retrieval'] = {'readyCount': 1}
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

    def test_phase_request_loader_does_not_read_the_other_phase(self):
        request = make_request(0, 'r1')
        prompt = {'system': 'system prompt', 'r1': 'review prompt', 'r2': 'challenge prompt'}
        revision = 'v2.1'
        request['promptHash'] = runner.hash_json({
            'revision': revision,
            'version': request['promptVersion'],
            'systemSha256': runner.sha256(prompt['system'].encode()),
            'phaseSha256': runner.sha256(prompt['r1'].encode()),
        })
        request['renderedContextHash'] = runner.hash_json(request['payload'])
        base = make_run([request])
        job = base['schedule'][0]
        job.update({
            'bundleKey': request['bundleKey'],
            'promptHash': request['promptHash'],
            'renderedHash': request['renderedContextHash'],
            'dependsOn': request['dependencyJobKey'],
        })
        r1_path = self.root / 'runs/fixture-run/r1.jsonl'
        r1_path.parent.mkdir(parents=True)
        r1_bytes = runner.json_bytes(request)
        r1_path.write_bytes(r1_bytes)
        run = {
            **base,
            'manifest': {
                'prompt': {'revision': revision},
                'retrieval': {'readyCount': 1},
                'caps': {'artifactBytes': 64 * 1024 * 1024},
            },
            'prompt_hashes': {
                'system': runner.sha256(prompt['system'].encode()),
                'r1': runner.sha256(prompt['r1'].encode()),
                'r2': runner.sha256(prompt['r2'].encode()),
            },
            'requests': {'r1': [], 'r2': []},
            'shards': [{
                'readyCount': 1,
                'requests': {
                    'r1': {
                        'path': 'runs/fixture-run/r1.jsonl',
                        'sha256': runner.sha256(r1_bytes),
                    },
                    'r2': {
                        'path': 'runs/fixture-run/missing-r2.jsonl',
                        'sha256': '0' * 64,
                    },
                },
            }],
        }

        loaded = runner.load_phase_requests(self.root, run, ['r1'])

        self.assertEqual([row['jobKey'] for row in loaded['r1']], [request['jobKey']])
        self.assertEqual(loaded['r2'], [])

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


class FormatRepairTransportTests(unittest.TestCase):
    def test_repair_prompt_preserves_raw_and_cannot_resend_old_or_repair_intent(self):
        request = make_request(10)
        request['repair'] = {
            'policyVersion': 'db4-format-only-repair-v1',
            'originalJobKey': 'f' * 64,
            'originalRawText': '{"reviews":[]}',
            'parserError': 'Incomplete shortlist verdicts',
        }
        message = runner.prompt_message({'system': 's', 'r1': 'r', 'r2': 'r2'}, request)
        self.assertIn('FORMAT-ONLY REPAIR', message)
        self.assertIn('Incomplete shortlist verdicts', message)
        self.assertIn('Do not change', message)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run = make_run([request])
            ledger = runner.Ledger(root, run['prefix'], run['manifest']['runId'])
            runner.append_phase_events(ledger, run['manifest']['runId'], run['schedule'])
            transport = FakeTransport(root)
            transport.prompts = run['prompt']
            first = runner.prepare_dispatch(root, run['prefix'], ledger, request, transport, 10, 2)
            second = runner.prepare_dispatch(root, run['prefix'], ledger, request, transport, 10, 2)
            self.assertEqual(first['state'], 'response_saved')
            self.assertFalse(second['sent'])
            self.assertEqual(transport.generate_calls, 1)
            self.assertEqual(ledger.dispatch_count(), 1)

class RepairWaveRecoveryTests(unittest.TestCase):
    def test_metadata_load_defers_payloads_and_rejects_mixed_parent_pins(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first, second = make_request(20), make_request(21)
            run = make_run([first, second])
            run['manifest']['caps']['artifactBytes'] = 64 * 1024 * 1024
            run.update(manifest_path='runs/fixture-run/run-manifest.json', manifest_sha256='c' * 64)
            def wave(index, original, revision, parent=None):
                job = dict(run['jobs_by_key'][original['jobKey']])
                job.update(jobKey=f'{index + 900:064x}', kind='format_repair', attempt=2, dependsOn=original['jobKey'])
                request = dict(original, jobKey=job['jobKey'])
                prefix = f"runs/fixture-run/repairs/wave-{index}"
                request_bytes = runner.json_bytes(request)
                request_path = root / prefix / 'requests.jsonl'
                request_path.parent.mkdir(parents=True)
                request_path.write_bytes(request_bytes)
                value = {'task': 'db4_batch_format_repair_wave', 'policyVersion': 'db4-format-only-repair-v1',
                         'runId': 'fixture-run', 'apply': False,
                         'runManifest': {'path': run['manifest_path'], 'sha256': run['manifest_sha256']},
                         'parent': parent, 'git': {'revision': revision, 'dirtySourceSha256': None},
                         'jobs': [job], 'count': 1,
                         'requests': {'path': prefix + '/requests.jsonl', 'sha256': runner.sha256(request_bytes)}}
                path = root / prefix / 'manifest.json'
                path.write_bytes(runner.json_bytes(value))
                return {'path': prefix + '/manifest.json', 'sha256': runner.sha256(path.read_bytes())}
            first_wave = wave(1, first, 'a' * 40)
            runner.load_repair_wave(root, run, first_wave['path'])
            self.assertNotIn('repair_requests', run)
            run['requests'] = {'r1': [], 'r2': []}
            runner.load_phase_requests(root, dict(run, repair_only=True), ['r1'])
            self.assertEqual(len(run['requests']['r1']), 1)
            second_wave = wave(2, second, 'b' * 40, first_wave)
            fresh = make_run([first, second])
            fresh.update(manifest_path=run['manifest_path'], manifest_sha256=run['manifest_sha256'])
            with self.assertRaisesRegex(runner.RunnerError, 'pin'):
                runner.load_repair_wave(root, fresh, second_wave['path'])

    def test_r2_repair_gate_uses_original_r2_r1_dependency(self):
        repair = make_request(30, phase='r2', dependency='original-r2')
        rows = [{'jobKey': 'original-r1', 'state': 'validated', 'r2Eligible': True}]
        ready, skipped, parked = runner.eligible_r2_jobs([repair], rows, {repair['jobKey']: 'original-r1'})
        self.assertEqual([row['jobKey'] for row in ready], [repair['jobKey']])
        self.assertEqual(skipped, [])
        self.assertEqual(parked, [])


if __name__ == '__main__':
    unittest.main()
