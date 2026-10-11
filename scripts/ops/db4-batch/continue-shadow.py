#!/usr/bin/env python3
"""DB4-D4/D5: finish every ready initial-generation request after recovery.

This opt-in operational scope collects proposals; expansion/audit/apply stay closed.
The mapping runner remains in its original immutable, identity-bound release.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import signal
import subprocess
import time
from pathlib import Path


class ContinuationError(RuntimeError):
    pass


def continue_run(args, coordinator, prior):
    def check_stop():
        if coordinator.STOP:
            raise ContinuationError('Continuation stopped before phase dispatch')
    check_stop()
    if prior.get('state') != 'reported' or prior.get('apply') is not False:
        raise ContinuationError('Predecessor must be reported with apply=false')
    report_ref = prior.get('report', {}).get('manifest')
    if not isinstance(report_ref, dict):
        raise ContinuationError('Predecessor returned no final report manifest')
    report = json.loads(coordinator.checked_artifact(args.artifact_root, report_ref))
    args.wait_for_report = report_ref['path']
    coordinator.wait_prior_report(args)
    manifest = json.loads(coordinator.checked_artifact(args.artifact_root, report['runManifest']))
    summary = json.loads(coordinator.checked_artifact(args.artifact_root, report['summary']))
    if manifest.get('mode') != 'shadow' or manifest.get('apply') is not False:
        raise ContinuationError('Continuation requires a shadow-only frozen run')
    wave_ref = summary.get('formatRepairWave')
    args.repair_manifest = None
    pin = manifest.get('git', {})
    if wave_ref:
        wave = json.loads(coordinator.checked_artifact(args.artifact_root, wave_ref))
        if (wave.get('task') != 'db4_batch_format_repair_wave'
                or wave.get('runId') != manifest['runId']
                or wave.get('runManifest') != report['runManifest']
                or wave.get('apply') is not False):
            raise ContinuationError('Repair wave differs from the reported run')
        pin = wave.get('git', {})
        args.repair_manifest = wave_ref['path']
    if pin.get('revision') != args.revision or pin.get('dirtySourceSha256') is not None:
        raise ContinuationError('Mapping release differs from the original/repair pin')
    ready = manifest['retrieval']['readyCount']
    if not isinstance(ready, int) or isinstance(ready, bool) or not 1 <= ready <= 1000:
        raise ContinuationError('Initial-generation ready denominator must be 1..1000')
    print(json.dumps({'task': 'db4_full_initial_progress', 'stage': 'original_r1',
                      'ready': ready, 'workers': args.workers}), flush=True)
    check_stop()
    r1 = coordinator.runner_phase(args, 'r1', dispatch_cap=ready, repair_only=False)
    r2 = None
    if not r1.get('breakerOpen'):
        validation = r1.get('validationManifest', {}).get('path')
        if not isinstance(validation, str):
            raise ContinuationError('Full R1 returned no identity-bound validation')
        check_stop()
        r2 = coordinator.runner_phase(args, 'r2', validation, ready, repair_only=False)
    check_stop()
    report = coordinator.publish_report(args)
    parked = r1.get('breakerOpen') or (r2 and r2.get('breakerOpen'))
    return {'task': 'db4_full_initial_run', 'scope': 'all_ready_initial_generation',
            'state': 'parked_transport' if parked else 'reported', 'ready': ready,
            'r1': r1, 'r2': r2, 'report': report, 'apply': False,
            'expansion': 'not_run', 'pilotA': 'not_run', 'pilotB': 'not_run'}


def wait_service(unit, timeout, stopped, invocation=None):
    if not re.fullmatch(r'langoo-db4-[A-Za-z0-9_.@-]+\.service', unit):
        raise ContinuationError('Predecessor must be an explicit Langoo DB4 service')
    print(json.dumps({'task': 'db4_full_initial_progress', 'stage': 'wait_predecessor',
                      'unit': unit}), flush=True)
    deadline = time.monotonic() + timeout
    while True:
        if stopped() or time.monotonic() >= deadline:
            raise ContinuationError('Predecessor wait stopped/timed out; no dispatch')
        result = subprocess.run(['systemctl', 'show', unit, '-p', 'LoadState',
                                 '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result', '-p', 'ExecMainStatus'],
                                capture_output=True, text=True, timeout=15)
        fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
        if result.returncode:
            raise ContinuationError('Predecessor service is missing; no dispatch')
        if fields.get('LoadState') == 'not-found' and fields.get('ActiveState') == 'inactive':
            # systemd collects successful transient units. Their current-boot
            # completion artifact must come from the exact captured invocation.
            return predecessor_result(unit, invocation)
        if fields.get('LoadState') != 'loaded':
            raise ContinuationError('Predecessor service is missing; no dispatch')
        if (fields.get('ActiveState') == 'inactive'
                or (fields.get('ActiveState') == 'active' and fields.get('SubState') == 'exited')):
            if fields.get('Result') == 'success' and fields.get('ExecMainStatus') == '0':
                return predecessor_result(unit, invocation)
            raise ContinuationError('Predecessor failed; no dispatch')
        if fields.get('ActiveState') == 'failed':
            raise ContinuationError('Predecessor failed; no dispatch')
        time.sleep(5)


def predecessor_result(unit, invocation=None):
    if not isinstance(invocation, str) or not re.fullmatch(r'[0-9a-f]{32}', invocation):
        raise ContinuationError('Predecessor requires an exact invocation ID')
    result = subprocess.run(['journalctl', '-b', '0', '-u', unit, '-n', '30', '--no-pager', '-o', 'json'],
                            capture_output=True, text=True, timeout=15)
    if result.returncode or len(result.stdout.encode()) > 1024 * 1024:
        raise ContinuationError('Predecessor journal unavailable/oversized')
    for line in reversed(result.stdout.splitlines()):
        try:
            entry = json.loads(line)
            if entry.get('_SYSTEMD_INVOCATION_ID') != invocation:
                continue
            value = json.loads(entry['MESSAGE'])
        except (ValueError, KeyError, TypeError):
            continue
        if isinstance(value, dict):
            if 'errorType' in value:
                raise ContinuationError('Predecessor ended with an error; no dispatch')
            if 'state' in value and 'report' in value:
                return value
    raise ContinuationError('Predecessor produced no structured final result')


def load_coordinator(release, revision):
    head = subprocess.run(['git', '-C', str(release), 'rev-parse', 'HEAD'],
                          capture_output=True, text=True, check=True, timeout=15).stdout.strip()
    dirty = subprocess.run(['git', '-C', str(release), 'status', '--porcelain'],
                           capture_output=True, text=True, check=True, timeout=15).stdout.strip()
    if head != revision or dirty:
        raise ContinuationError('Pinned coordinator release must be clean and match revision')
    spec = importlib.util.spec_from_file_location('db4_pinned_coordinator',
                                                 release / 'scripts/ops/db4-batch/run-shadow.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-root', type=Path, required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--runner-release', type=Path, required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--wait-service', required=True)
    parser.add_argument('--predecessor-invocation', required=True)
    parser.add_argument('--wait-seconds', type=int, default=10800)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--timeout', type=int, default=240)
    args = parser.parse_args()
    if (not re.fullmatch(r'[0-9a-f]{40}', args.revision)
            or not re.fullmatch(r'[0-9a-f]{32}', args.predecessor_invocation) or not 1 <= args.workers <= 8
            or not 30 <= args.timeout <= 240 or not 1 <= args.wait_seconds <= 86400):
        raise ContinuationError('Revision, worker, timeout or wait cap is invalid')
    args.artifact_root = args.artifact_root.resolve(strict=True)
    args.runner_release = args.runner_release.resolve(strict=True)
    coordinator = load_coordinator(args.runner_release, args.revision)
    signal.signal(signal.SIGINT, coordinator.handle_stop)
    signal.signal(signal.SIGTERM, coordinator.handle_stop)
    prior = wait_service(args.wait_service, args.wait_seconds, lambda: coordinator.STOP,
                         args.predecessor_invocation)
    if coordinator.STOP:
        raise ContinuationError('Continuation stopped before dispatch')
    print(json.dumps(continue_run(args, coordinator, prior)))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(cli())
    except Exception as exc:
        print(json.dumps({'errorType': type(exc).__name__, 'apply': False}), flush=True)
        raise SystemExit(1)
