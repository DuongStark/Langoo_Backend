#!/usr/bin/env python3
"""DB4-D4/D5: run frozen R1, conditional R2, then publish a read-only report."""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
RUNNER = ROOT / 'scripts/db4/muse-batch-runner.py'
REPORT = ROOT / 'scripts/db4/batch-report.ts'
CHILD: subprocess.Popen[str] | None = None
STOP = False


class OrchestrationError(RuntimeError):
    pass


def handle_stop(_signum, _frame):
    global STOP
    STOP = True
    if CHILD is not None and CHILD.poll() is None:
        CHILD.send_signal(signal.SIGINT)


def run_command(command: list[str], cwd: Path) -> tuple[int, str, str]:
    global CHILD
    CHILD = subprocess.Popen(
        command,
        cwd=cwd,
        env={**os.environ, 'NODE_OPTIONS': ''},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    stdout, stderr = CHILD.communicate()
    code = CHILD.returncode
    CHILD = None
    return code, stdout, stderr


def parse_result(stdout: str, stage: str) -> dict:
    try:
        return json.loads(stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as exc:
        raise OrchestrationError(f'{stage} returned no structured result') from exc


def runner_phase(args, phase: str, validation_manifest: str | None = None,
                 dispatch_cap: int | None = None) -> dict:
    command = [
        sys.executable,
        '-B',
        str(RUNNER),
        'run',
        '--artifact-root',
        str(args.artifact_root),
        '--manifest',
        args.manifest,
        '--phase',
        phase,
        '--workers',
        str(args.workers),
        '--timeout',
        str(args.timeout),
        '--repo-root',
        str(ROOT),
    ]
    if validation_manifest:
        command.extend(['--validation-manifest', validation_manifest])
    if dispatch_cap is not None:
        command.extend(['--max-dispatches', str(dispatch_cap)])
    code, stdout, _stderr = run_command(command, ROOT)
    if STOP:
        raise OrchestrationError('Run paused by systemd stop request')
    result = parse_result(stdout, phase.upper())
    if code != 0:
        raise OrchestrationError(f'{phase.upper()} runner failed: {result.get("errorType", "RunnerError")}')
    return result


def publish_report(args) -> dict:
    command = [
        'node',
        '--max-old-space-size=448',
        '--import',
        'tsx',
        str(REPORT),
        '--artifact-dir',
        str(args.artifact_root),
        '--manifest',
        args.manifest,
    ]
    code, stdout, _stderr = run_command(command, ROOT)
    if STOP:
        raise OrchestrationError('Run paused by systemd stop request')
    result = parse_result(stdout, 'Batch report')
    if code != 0:
        raise OrchestrationError(f'Batch report failed: {result.get("errorType", "ReportError")}')
    return result


def run_shadow(args) -> dict:
    r1 = runner_phase(args, 'r1', dispatch_cap=getattr(args, 'r1_cap', None))
    if r1.get('breakerOpen'):
        report = publish_report(args)
        return {'state': 'parked_transport', 'r1': r1, 'r2': None, 'report': report, 'apply': False}

    validation = r1.get('validationManifest')
    if not isinstance(validation, dict) or not isinstance(validation.get('path'), str):
        raise OrchestrationError('R1 did not produce an identity-bound validation manifest')
    r2 = runner_phase(
        args,
        'r2',
        validation['path'],
        getattr(args, 'r2_cap', None),
    )
    report = publish_report(args)
    state = 'parked_transport' if r2.get('breakerOpen') else 'reported'
    return {'state': state, 'r1': r1, 'r2': r2, 'report': report, 'apply': False}


def cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-root', type=Path, required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--timeout', type=int, default=240)
    parser.add_argument('--r1-cap', type=int)
    parser.add_argument('--r2-cap', type=int)
    args = parser.parse_args()
    args.artifact_root = args.artifact_root.resolve(strict=True)
    if not 1 <= args.workers <= 8 or not 30 <= args.timeout <= 240:
        raise OrchestrationError('Worker/timeout is outside the frozen runner cap')
    for cap in (args.r1_cap, args.r2_cap):
        if cap is not None and not 1 <= cap <= 5000:
            raise OrchestrationError('Phase dispatch cap must be 1..5000')

    signal.signal(signal.SIGINT, handle_stop)
    signal.signal(signal.SIGTERM, handle_stop)

    print(json.dumps(run_shadow(args)))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(cli())
    except KeyboardInterrupt:
        print(json.dumps({'state': 'paused', 'apply': False}), file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        print(json.dumps({'errorType': type(exc).__name__, 'apply': False}), file=sys.stderr)
        raise SystemExit(1)
