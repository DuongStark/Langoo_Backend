#!/usr/bin/env python3
"""DB4-D4/D5: run frozen R1, conditional R2, then publish a read-only report."""
from __future__ import annotations

import argparse
import json
import hashlib
import time
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
                 dispatch_cap: int | None = None, repair_only: bool = False) -> dict:
    print(json.dumps({'task': 'db4_shadow_progress', 'stage': phase, 'repairOnly': repair_only}), flush=True)
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
    if getattr(args, 'repair_manifest', None):
        command.extend(['--repair-manifest', args.repair_manifest])
    if repair_only:
        command.append('--repair-only')
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
    print(json.dumps({'task': 'db4_shadow_progress', 'stage': 'report'}), flush=True)
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
    if getattr(args, 'repair_manifest', None):
        command.extend(['--repair-manifest', args.repair_manifest])
    code, stdout, _stderr = run_command(command, ROOT)
    if STOP:
        raise OrchestrationError('Run paused by systemd stop request')
    result = parse_result(stdout, 'Batch report')
    if code != 0:
        raise OrchestrationError(f'Batch report failed: {result.get("errorType", "ReportError")}')
    return result


def prepare_repair(args) -> dict:
    print(json.dumps({'task': 'db4_shadow_progress', 'stage': 'prepare_repair'}), flush=True)
    command = ['node', '--max-old-space-size=256', '--import', 'tsx',
               str(ROOT / 'scripts/db4/batch-repair.ts'), 'prepare',
               '--artifact-dir', str(args.artifact_root), '--manifest', args.manifest,
               '--max-repairs', str(args.repair_cap)]
    if getattr(args, 'repair_manifest', None):
        command.extend(['--repair-manifest', args.repair_manifest])
    code, stdout, _stderr = run_command(command, ROOT)
    if STOP:
        raise OrchestrationError('Run paused by systemd stop request')
    result = parse_result(stdout, 'Repair preparation')
    if code != 0:
        raise OrchestrationError('Immutable repair preparation failed')
    if result.get('planned', 0):
        args.repair_manifest = result['manifest']['path']
    return result


def fresh_r1_validation(args) -> str:
    command = ['node', '--max-old-space-size=256', '--import', 'tsx',
               str(ROOT / 'scripts/db4/batch-validate.ts'),
               '--artifact-dir', str(args.artifact_root), '--manifest', args.manifest,
               '--phase', 'r1']
    if getattr(args, 'repair_manifest', None):
        command.extend(['--repair-manifest', args.repair_manifest])
    code, stdout, _stderr = run_command(command, ROOT)
    result = parse_result(stdout, 'Effective R1 validation')
    if STOP or code != 0:
        raise OrchestrationError('Effective R1 validation failed/paused')
    return result['manifest']['path']


def checked_artifact(root: Path, ref: dict) -> bytes:
    relative = ref.get('path')
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise OrchestrationError('Prior report artifact path is invalid')
    path = root / relative
    resolved = path.resolve(strict=True)
    if path.is_symlink() or root not in resolved.parents or resolved.stat().st_size > 64 * 1024 * 1024:
        raise OrchestrationError('Prior report artifact path/size is invalid')
    content = resolved.read_bytes()
    if hashlib.sha256(content).hexdigest() != ref.get('sha256'):
        raise OrchestrationError('Prior report artifact hash mismatch')
    return content


def wait_prior_report(args):
    report_path = getattr(args, 'wait_for_report', None)
    if not report_path:
        return
    root = args.artifact_root
    candidate = root / report_path
    if Path(report_path).is_absolute() or root not in candidate.resolve().parents:
        raise OrchestrationError('Prior report must be inside this artifact root')
    print(json.dumps({'task': 'db4_shadow_progress', 'stage': 'wait_prior_report'}), flush=True)
    deadline = time.monotonic() + 1800
    while not candidate.exists():
        if STOP or time.monotonic() >= deadline:
            raise OrchestrationError('Prior report wait paused/timed out; no dispatch')
        time.sleep(5)
    if candidate.is_symlink() or candidate.stat().st_size > 16 * 1024 * 1024:
        raise OrchestrationError('Prior report manifest path/size is invalid')
    report = json.loads(candidate.read_bytes())
    manifest_bytes = (root / args.manifest).read_bytes()
    manifest = json.loads(manifest_bytes)
    if (report.get('task') != 'db4_batch_report_manifest' or report.get('runId') != manifest['runId']
            or report.get('runManifest') != {'path': args.manifest, 'sha256': hashlib.sha256(manifest_bytes).hexdigest()}
            or report.get('selected') != manifest['cohort']['counts']['selected']
            or report.get('apply') is not False):
        raise OrchestrationError('Prior report run/denominator binding mismatch')
    summary = json.loads(checked_artifact(root, report['summary']))
    results = checked_artifact(root, report['targetResults'])
    if (summary.get('selected') != report['selected'] or not results.endswith(b'\n')
            or len(results.splitlines()) != report['selected']
            or summary.get('gates', {}).get('apply') is not False
            or summary.get('gates', {}).get('promotionReady') is not False):
        raise OrchestrationError('Prior report is incomplete or has open gates')


def run_shadow(args) -> dict:
    wait_prior_report(args)
    if getattr(args, 'recover_r1', False) and not getattr(args, 'repair_manifest', None):
        planned = prepare_repair(args)
        if not planned.get('planned', 0):
            return {'state': 'no_repair_available', 'r1': None, 'r2': None, 'report': publish_report(args), 'apply': False}
    if getattr(args, 'repair_manifest', None):
        if getattr(args, 'repair_phase', 'r1') == 'r2':
            validation_path = fresh_r1_validation(args)
            r2 = runner_phase(args, 'r2', validation_path,
                              getattr(args, 'repair_cap', 1), repair_only=True)
            report = publish_report(args)
            return {'state': 'parked_transport' if r2.get('breakerOpen') else 'reported',
                    'r1': None, 'r2': r2, 'report': report, 'apply': False}
        r1 = runner_phase(args, 'r1', dispatch_cap=getattr(args, 'repair_cap', 1), repair_only=True)
    else:
        r1 = runner_phase(args, 'r1', dispatch_cap=getattr(args, 'r1_cap', None))
        if not r1.get('breakerOpen') and getattr(args, 'auto_repair', False):
            planned = prepare_repair(args)
            if planned.get('planned', 0):
                r1 = runner_phase(args, 'r1', dispatch_cap=args.repair_cap, repair_only=True)
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
    if not r2.get('breakerOpen') and getattr(args, 'auto_repair', False):
        planned = prepare_repair(args)
        if planned.get('planned', 0):
            r2 = runner_phase(args, 'r2', fresh_r1_validation(args), args.repair_cap, repair_only=True)
    report = publish_report(args)
    state = 'parked_transport'  if r2.get('breakerOpen') else 'reported'
    return {'state': state, 'r1': r1, 'r2': r2, 'report': report, 'apply': False}


def cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-root', type=Path, required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--timeout', type=int, default=240)
    parser.add_argument('--r1-cap', type=int)
    parser.add_argument('--r2-cap', type=int)
    parser.add_argument('--repair-manifest')
    parser.add_argument('--repair-phase', choices=('r1', 'r2'), default='r1')
    parser.add_argument('--repair-cap', type=int, default=1)
    parser.add_argument('--auto-repair', action='store_true')
    parser.add_argument('--recover-r1', action='store_true')
    parser.add_argument('--wait-for-report')
    args = parser.parse_args()
    args.artifact_root = args.artifact_root.resolve(strict=True)
    if not 1 <= args.workers <= 8 or not 30 <= args.timeout <= 240:
        raise OrchestrationError('Worker/timeout is outside the frozen runner cap')
    for cap in (args.r1_cap, args.r2_cap, args.repair_cap):
        if cap is not None and not 1 <= cap <= 5000:
            raise OrchestrationError('Phase dispatch cap must be 1..5000')

    if not 1 <= args.repair_cap <= 1000:
        raise OrchestrationError('Repair cap must be 1..1000')
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
