"""M10.5 contract tests; fake transport, no account/network required."""
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault('muse', types.SimpleNamespace(Gateway=None, load_cookies=lambda p: 'private'))
spec = importlib.util.spec_from_file_location('native_smoke', Path(__file__).with_name('native-smoke.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeSmokeTests(unittest.TestCase):
    def test_output_correlation_and_source_scope(self):
        value = {'job_id': 'unique', 'items': [{'lemma': lemma, 'sense_id': sid} for lemma, sid in module.EXPECTED.items()]}
        self.assertEqual(module.validate(json.dumps(value), 'unique'), value)
        with self.assertRaises(ValueError):
            module.validate(json.dumps(value), 'other-job')
        value['items'][0]['sense_id'] = '2001'
        with self.assertRaises(ValueError):
            module.validate(json.dumps(value), 'unique')

    def test_missing_duplicate_or_extra_fields_rejected(self):
        rows = [{'lemma': lemma, 'sense_id': sid} for lemma, sid in module.EXPECTED.items()]
        for value in ({'job_id': 'x', 'items': rows[:2]}, {'job_id': 'x', 'items': [rows[0], rows[0], rows[2]]}, {'job_id': 'x', 'items': rows, 'extra': True}, {'job_id': 'x', 'items': [None, rows[1], rows[2]]}):
            with self.assertRaises(ValueError):
                module.validate(json.dumps(value), 'x')

    def test_no_main_chat_or_unvalidated_session(self):
        with self.assertRaises(ValueError):
            module.session_id({'session_id': 'main'})
        self.assertEqual(module.session_id({'session': {'session_id': '12345678-1234-4234-8234-123456789012'}}), '12345678-1234-4234-8234-123456789012')

    def test_budget_and_uncertain_send_cannot_auto_retry(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(module, 'OUT', Path(temporary)):
            for _ in range(20):
                module.reserve_generation()
            with self.assertRaises(ValueError):
                module.reserve_generation()
            module.atomic('job.json', {'dispatch_started': True})
            with self.assertRaises(ValueError):
                module.run_job('job')

    def test_probe_error_never_logs_transport_secrets(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(module, 'OUT', Path(temporary)), patch.object(module, 'Gateway', side_effect=RuntimeError('secret_token_do_not_log')):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertFalse(module.probe())
            self.assertNotIn('secret_token_do_not_log', output.getvalue())
            self.assertNotIn('secret_token_do_not_log', (Path(temporary) / 'probe.json').read_text())


if __name__ == '__main__':
    unittest.main()
