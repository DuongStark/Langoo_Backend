import importlib.util
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

    def test_systemd_uses_muse_native_venv_for_transport_dependencies(self):
        unit = UNIT.read_text(encoding='utf-8')
        self.assertIn(
            'ExecStart=/opt/langoo/services/muse-native/venv/bin/python -B ',
            unit,
        )


if __name__ == '__main__':
    unittest.main()
