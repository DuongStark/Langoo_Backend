import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
COORDINATOR = load('pinned_coordinator_fixture', HERE / 'run-shadow.py')
CONTINUE = load('continue_shadow_fixture', HERE / 'continue-shadow.py')


class ContinueShadowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.revision = 'a' * 40
        def write(path, value):
            data = value if isinstance(value, bytes) else json.dumps(value).encode()
            (self.root / path).write_bytes(data)
            return {'path': path, 'sha256': hashlib.sha256(data).hexdigest()}
        self.write = write
        self.manifest = write('run.json', {
            'runId': 'fixture', 'mode': 'shadow', 'apply': False,
            'cohort': {'counts': {'selected': 2}},
            'retrieval': {'readyCount': 2}, 'git': {'revision': 'b' * 40},
        })
        self.wave = write('wave.json', {
            'task': 'db4_batch_format_repair_wave', 'runId': 'fixture',
            'runManifest': self.manifest,
            'git': {'revision': self.revision, 'dirtySourceSha256': None}, 'apply': False,
        })
        self.summary = {'selected': 2, 'formatRepairWave': self.wave,
                        'gates': {'apply': False, 'promotionReady': False}}
        self.report = {'task': 'db4_batch_report_manifest', 'runId': 'fixture',
                       'runManifest': self.manifest, 'selected': 2, 'apply': False,
                       'targetResults': write('rows.jsonl', b'{}\n{}\n'),
                       'summary': write('summary.json', self.summary)}
        self.prior = {'state': 'reported', 'apply': False,
                      'report': {'manifest': write('report.json', self.report)}}
        self.args = SimpleNamespace(artifact_root=self.root, manifest='run.json',
                                    revision=self.revision, workers=8, timeout=240)

    def test_continues_original_r1_with_wave_then_gates_r2_using_complete_validation(self):
        calls = []
        def phase(args, phase, validation=None, dispatch_cap=None, repair_only=False):
            calls.append((phase, validation, dispatch_cap, repair_only, args.repair_manifest))
            return {'breakerOpen': False, 'validationManifest': {'path': 'fresh-r1.json'}}
        with patch.object(COORDINATOR, 'runner_phase', side_effect=phase), patch.object(
            COORDINATOR, 'publish_report', return_value={'manifest': {'path': 'final.json'}},
        ):
            result = CONTINUE.continue_run(self.args, COORDINATOR, self.prior)
        self.assertEqual(calls, [('r1', None, 2, False, 'wave.json'),
                                 ('r2', 'fresh-r1.json', 2, False, 'wave.json')])
        self.assertFalse(result['apply'])
        self.assertEqual(result['scope'], 'all_ready_initial_generation')

    def test_prior_parked_transport_stops_before_any_dispatch(self):
        self.prior['state'] = 'parked_transport'
        with patch.object(COORDINATOR, 'runner_phase') as phase:
            with self.assertRaisesRegex(CONTINUE.ContinuationError, 'reported'):
                CONTINUE.continue_run(self.args, COORDINATOR, self.prior)
        phase.assert_not_called()

    def test_tampered_report_stops_before_any_dispatch(self):
        (self.root / 'rows.jsonl').write_bytes(b'{"changed":true}\n{}\n')
        with patch.object(COORDINATOR, 'runner_phase') as phase:
            with self.assertRaisesRegex(Exception, 'hash mismatch'):
                CONTINUE.continue_run(self.args, COORDINATOR, self.prior)
        phase.assert_not_called()

    def test_foreign_wave_pin_stops_before_any_dispatch(self):
        wave = json.loads((self.root / 'wave.json').read_bytes())
        wave['git']['revision'] = 'c' * 40
        self.summary['formatRepairWave'] = self.write('wave.json', wave)
        self.report['summary'] = self.write('summary.json', self.summary)
        self.prior['report']['manifest'] = self.write('report.json', self.report)
        with patch.object(COORDINATOR, 'runner_phase') as phase:
            with self.assertRaisesRegex(CONTINUE.ContinuationError, 'pin'):
                CONTINUE.continue_run(self.args, COORDINATOR, self.prior)
        phase.assert_not_called()

    def test_full_r1_breaker_reports_and_never_calls_r2(self):
        with patch.object(COORDINATOR, 'runner_phase', return_value={'breakerOpen': True}) as phase, patch.object(
            COORDINATOR, 'publish_report', return_value={},
        ):
            result = CONTINUE.continue_run(self.args, COORDINATOR, self.prior)
        phase.assert_called_once()
        self.assertEqual(result['state'], 'parked_transport')
        self.assertIsNone(result['r2'])

    def test_failed_predecessor_service_stops_instead_of_reading_results(self):
        status = SimpleNamespace(returncode=0, stdout='LoadState=loaded\nActiveState=failed\nResult=exit-code\nExecMainStatus=1\n')
        with patch.object(CONTINUE.subprocess, 'run', return_value=status):
            with self.assertRaisesRegex(CONTINUE.ContinuationError, 'failed'):
                CONTINUE.wait_service('langoo-db4-recover-test.service', 10, lambda: False)

    def test_stop_during_report_verification_prevents_original_r1_dispatch(self):
        original = COORDINATOR.wait_prior_report
        def stop(args):
            original(args)
            COORDINATOR.STOP = True
        with patch.object(COORDINATOR, 'STOP', False), patch.object(
            COORDINATOR, 'wait_prior_report', side_effect=stop,
        ), patch.object(COORDINATOR, 'runner_phase') as phase, patch.object(
            COORDINATOR, 'publish_report', return_value={},
        ):
            with self.assertRaisesRegex(CONTINUE.ContinuationError, 'stopped'):
                CONTINUE.continue_run(self.args, COORDINATOR, self.prior)
        phase.assert_not_called()

    def test_collected_transient_unit_uses_final_result_of_expected_invocation(self):
        status = SimpleNamespace(returncode=0, stdout='LoadState=not-found\nActiveState=inactive\nResult=success\nExecMainStatus=0\n')
        with patch.object(CONTINUE.subprocess, 'run', return_value=status), patch.object(
            CONTINUE, 'predecessor_result', return_value=self.prior,
        ) as result:
            actual = CONTINUE.wait_service('langoo-db4-recover-test.service', 10, lambda: False, 'a' * 32)
        self.assertEqual(actual, self.prior)
        result.assert_called_once_with('langoo-db4-recover-test.service', 'a' * 32)

    def test_retained_successful_service_is_finished_when_substate_exited(self):
        status = SimpleNamespace(returncode=0, stdout='LoadState=loaded\nActiveState=active\nSubState=exited\nResult=success\nExecMainStatus=0\n')
        with patch.object(CONTINUE.subprocess, 'run', return_value=status), patch.object(
            CONTINUE, 'predecessor_result', return_value=self.prior,
        ), patch.object(CONTINUE.time, 'sleep', side_effect=AssertionError('must not wait after exited')):
            self.assertEqual(CONTINUE.wait_service('langoo-db4-recover-test.service', 10, lambda: False, 'a' * 32), self.prior)

    def test_older_invocation_final_cannot_satisfy_current_predecessor(self):
        journal = SimpleNamespace(returncode=0, stdout=json.dumps({
            'MESSAGE': json.dumps(self.prior), '_SYSTEMD_INVOCATION_ID': 'b' * 32,
        }))
        with patch.object(CONTINUE.subprocess, 'run', return_value=journal):
            with self.assertRaisesRegex(CONTINUE.ContinuationError, 'final result'):
                CONTINUE.predecessor_result('langoo-db4-recover-test.service', 'a' * 32)


if __name__ == '__main__':
    unittest.main()
