import importlib.util
import tempfile
import json
import hashlib
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('run-shadow.py')
UNIT = Path(__file__).with_name('langoo-db4-batch@.service')
SPEC = importlib.util.spec_from_file_location('db4_run_shadow', SCRIPT)
assert SPEC and SPEC.loader
RUN_SHADOW = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUN_SHADOW)


class ShadowCoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.args = SimpleNamespace(r1_cap=2, r2_cap=1)

    def test_r2_uses_complete_r1_validation_then_publishes_report(self):
        calls = []

        def phase(_args, phase, validation=None, dispatch_cap=None):
            calls.append((phase, validation, dispatch_cap))
            if phase == 'r1':
                return {
                    'breakerOpen': False,
                    'validationManifest': {'path': 'batch-runs/run/validation/r1/head/manifest.json'},
                }
            return {'breakerOpen': False}

        with patch.object(RUN_SHADOW, 'runner_phase', side_effect=phase), patch.object(
            RUN_SHADOW, 'publish_report', return_value={'manifest': {'path': 'report.json'}},
        ) as report:
            result = RUN_SHADOW.run_shadow(self.args)

        self.assertEqual(calls[0], ('r1', None, 2))
        self.assertEqual(calls[1], ('r2', 'batch-runs/run/validation/r1/head/manifest.json', 1))
        report.assert_called_once_with(self.args)
        self.assertEqual(result['state'], 'reported')
        self.assertFalse(result['apply'])

    def test_open_r1_breaker_parks_before_r2_and_reports(self):
        calls = []
        with patch.object(
            RUN_SHADOW,
            'runner_phase',
            side_effect=lambda _args, phase, validation=None, dispatch_cap=None: (
                calls.append((phase, validation, dispatch_cap)) or {'breakerOpen': True}
            ),
        ), patch.object(
            RUN_SHADOW, 'publish_report', return_value={'manifest': {'path': 'report.json'}},
        ) as report:
            result = RUN_SHADOW.run_shadow(self.args)

        self.assertEqual(calls, [('r1', None, 2)])
        report.assert_called_once_with(self.args)
        self.assertEqual(result['state'], 'parked_transport')
        self.assertIsNone(result['r2'])

    def test_repair_resume_dispatches_only_repair_then_gates_original_r2(self):
        self.args.repair_manifest = 'batch-runs/run/repairs/wave/manifest.json'
        self.args.repair_cap = 1
        calls = []
        def phase(_args, phase, validation=None, dispatch_cap=None, repair_only=False):
            calls.append((phase, validation, dispatch_cap, repair_only))
            return {'breakerOpen': False, 'validationManifest': {'path': 'effective-r1.json'}}
        with patch.object(RUN_SHADOW, 'runner_phase', side_effect=phase), patch.object(
            RUN_SHADOW, 'publish_report', return_value={'manifest': {'path': 'report.json'}},
        ):
            result = RUN_SHADOW.run_shadow(self.args)
        self.assertEqual(calls, [('r1', None, 1, True), ('r2', 'effective-r1.json', 1, False)])
        self.assertFalse(result['apply'])

    def test_recover_r1_plans_repair_without_dispatching_another_original_r1(self):
        self.args.recover_r1 = True
        self.args.repair_cap = 1
        self.args.repair_manifest = None
        calls = []
        def prepare(args):
            args.repair_manifest = 'wave.json'
            return {'planned': 1, 'manifest': {'path': 'wave.json'}}
        def phase(_args, phase, validation=None, dispatch_cap=None, repair_only=False):
            calls.append((phase, repair_only))
            return {'breakerOpen': False, 'validationManifest': {'path': 'effective-r1.json'}}
        with patch.object(RUN_SHADOW, 'prepare_repair', side_effect=prepare), patch.object(
            RUN_SHADOW, 'runner_phase', side_effect=phase,
        ), patch.object(RUN_SHADOW, 'publish_report', return_value={}):
            RUN_SHADOW.run_shadow(self.args)
        self.assertEqual(calls, [('r1', True), ('r2', False)])

    def test_prior_report_requires_bound_complete_unchanged_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            def write(path, value):
                content = value if isinstance(value, bytes) else json.dumps(value).encode()
                (root / path).write_bytes(content)
                return {'path': path, 'sha256': hashlib.sha256(content).hexdigest()}
            manifest_ref = write('run.json', {'runId': 'fixture', 'cohort': {'counts': {'selected': 2}}})
            rows_ref = write('results.jsonl', b'{"target":1}\n{"target":2}\n')
            summary_ref = write('summary.json', {'selected': 2, 'gates': {'apply': False, 'promotionReady': False}})
            report = {'task': 'db4_batch_report_manifest', 'runId': 'fixture', 'runManifest': manifest_ref,
                      'selected': 2, 'apply': False, 'targetResults': rows_ref, 'summary': summary_ref}
            write('report.json', report)
            args = SimpleNamespace(artifact_root=root, manifest='run.json', wait_for_report='report.json')
            RUN_SHADOW.wait_prior_report(args)
            (root / 'results.jsonl').write_bytes(b'{"target":3}\n{"target":2}\n')
            with self.assertRaisesRegex(RUN_SHADOW.OrchestrationError, 'hash mismatch'):
                RUN_SHADOW.wait_prior_report(args)
            write('results.jsonl', b'{"target":1}\n{"target":2}\n')
            report['summary'] = write('summary.json', {'selected': 2, 'gates': {'apply': False, 'promotionReady': True}})
            write('report.json', report)
            with self.assertRaisesRegex(RUN_SHADOW.OrchestrationError, 'open gates'):
                RUN_SHADOW.wait_prior_report(args)

    def test_systemd_uses_muse_native_venv_for_transport_dependencies(self):
        unit = UNIT.read_text(encoding='utf-8')
        self.assertIn(
            'ExecStart=/opt/langoo/services/muse-native/venv/bin/python -B ',
            unit,
        )


if __name__ == '__main__':
    unittest.main()
