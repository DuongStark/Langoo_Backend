import json
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

UNIT = Path(__file__).with_name('langoo-db4-transport-canary-20261011.service')


class CanaryUnitTests(unittest.TestCase):
    def test_post_gate_waits_for_the_native_command_to_finish(self):
        text = UNIT.read_text()
        self.assertIn('Type=oneshot\n', text)
        self.assertIn('TimeoutStartSec=2h\n', text)

    def test_post_gate_requires_a_saved_reply_for_the_one_new_intent(self):
        line = next(s for s in UNIT.read_text().splitlines() if s.startswith('ExecStartPost='))
        program = shlex.split(line.split('=', 1)[1])[2]
        cases = [
            ([{'type': 'dispatch_intent_persisted', 'jobKey': 'new'},
              {'type': 'response_saved', 'jobKey': 'new'}], 0),
            ([{'type': 'dispatch_intent_persisted', 'jobKey': 'new'},
              {'type': 'response_saved', 'jobKey': 'old'}], 1),
            ([{'type': 'dispatch_intent_persisted', 'jobKey': 'new'},
              {'type': 'transport_unknown', 'jobKey': 'new'}], 1),
            ([{'type': 'dispatch_intent_persisted', 'jobKey': 'new'},
              {'type': 'response_saved', 'jobKey': 'new'},
              {'type': 'breaker_opened', 'jobKey': None}], 1),
            ([{'type': 'dispatch_intent_persisted', 'jobKey': 'new'},
              {'type': 'dispatch_intent_persisted', 'jobKey': 'second'},
              {'type': 'response_saved', 'jobKey': 'new'}], 1),
        ]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'events.jsonl'
            start = program.index("Path('") + len("Path('")
            end = program.index("')", start)
            isolated = program[:start] + str(path) + program[end:]
            for rows, expected in cases:
                path.write_text('\n'.join(json.dumps(r) for r in [
                    {'type': 'response_saved', 'jobKey': 'old'},
                    {'type': 'breaker_cleared', 'jobKey': None}, *rows,
                ]) + '\n')
                with self.subTest(rows=rows):
                    result = subprocess.run(['python3', '-c', isolated], capture_output=True, text=True)
                    self.assertEqual(result.returncode, expected, result.stderr)


if __name__ == '__main__':
    unittest.main()
