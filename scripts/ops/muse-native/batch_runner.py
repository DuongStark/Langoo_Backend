#!/usr/bin/env python3
"""M10.5: prepare once, run/resume a native Muse batch queue on VPS."""
import argparse
import contextlib
import concurrent.futures
import fcntl
import json
import os
import resource
import sys
import threading
import time
import uuid
from pathlib import Path
from batch_core import VERSION, digest, final_batch, prepare, prompt, validate, validated_reply

TRANSPORT = Path('/opt/langoo/services/muse-native')
COOKIE_FILE = Path('/opt/langoo/storage/muse-native/cookies.json')
ACCOUNT_LOCK = COOKIE_FILE.with_name('runner-account.lock')
COUNTER_LOCK = threading.Lock()
CONNECTION_LOCK = threading.Lock()
WORKER_LOCAL = threading.local()
CONNECTIONS = []


class GenerationRejected(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__('Generation endpoint rejected request')


def observe_frame(gw, frame):
    """Do not silently discard generation endpoint errors during history RPCs."""
    if frame.stream_id == getattr(gw, 'generation_stream', None):
        kind = frame.WhichOneof('kind')
        if kind == 'response':
            gw.generation_status = int(frame.response.status)
            if not 200 <= gw.generation_status < 300:
                raise GenerationRejected(gw.generation_status)
        elif kind == 'reset':
            raise GenerationRejected(-1)  # Reset may still be ambiguous; never auto-resend.


def write(path, value):
    temp = path.with_name(path.name + '.tmp')
    with temp.open('w', encoding='utf-8') as fh:
        json.dump(value, fh, ensure_ascii=False, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.chmod(temp, 0o600)
    temp.replace(path)
    # Make the rename durable too, including intent saved before network send.
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def gateway():
    sys.path.insert(0, str(TRANSPORT))
    from muse import Gateway, load_cookies
    class ObservedGateway(Gateway):
        def _read_frame(self):
            frame = super()._read_frame()
            observe_frame(self, frame)
            return frame
    return ObservedGateway(load_cookies(str(COOKIE_FILE)))


def acquire(reuse):
    if not reuse:
        return gateway()
    if getattr(WORKER_LOCAL, 'gateway', None) is None:
        WORKER_LOCAL.gateway = gateway()
        with CONNECTION_LOCK:
            CONNECTIONS.append(WORKER_LOCAL.gateway)
    return WORKER_LOCAL.gateway


def safe_error(exc, phase):
    result = {'error_type': type(exc).__name__, 'error_phase': phase}
    for field in ('code', 'status'):
        value = getattr(exc, field, None)
        if isinstance(value, int) and not isinstance(value, bool):
            result['error_' + field] = int(value)
    # Classify a few known network errors; never store an external message/URL.
    message = str(exc).lower()
    result['known_error_labels'] = [label for label in ('ssl certificate', 'handshake', '429', '403',
                                                       '502', '503', 'too many', 'resolve host', 'timed out')
                                    if label in message]
    return result


def new_session(value):
    if isinstance(value, dict):
        for row in (value, value.get('session'), value.get('result')):
            if isinstance(row, dict):
                for field in ('session_id', 'id'):
                    sid = row.get(field)
                    if isinstance(sid, str):
                        try:
                            uuid.UUID(sid)
                            return sid
                        except ValueError:
                            pass
    raise ValueError('No new side-chat UUID')


def reserve(out, cap):
    with COUNTER_LOCK:
        counter = read(out / 'dispatch-count.json') if (out / 'dispatch-count.json').exists() else {'count': 0}
        if counter['count'] >= cap:
            raise ValueError('Dispatch cap exhausted')
        counter.update(count=counter['count'] + 1, cap=cap)
        write(out / 'dispatch-count.json', counter)


def poll(gw, state, batch, timeout, interval):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        history = gw.call_json('chat.history', body={'session_id': state['session_id'], 'limit': 10}, timeout=20)
        for event in history.get('chat_events', []):
            payload = event.get('payload', {})
            if not isinstance(payload, dict) or event.get('event_name') != 'message.assistant' or (event.get('seq', 0) or 0) <= 0:
                continue
            if payload.get('reply_to_message_id') or event.get('reply_to_message_id'):
                continue
            reply = payload.get('display_text') or payload.get('content') or event.get('text')
            if not isinstance(reply, str) or len(reply) > 30000:
                continue
            state['raw_reply'] = reply
            try:
                value, normalized = validated_reply(reply, state['job_id'], batch['tasks'])
            except (ValueError, TypeError, KeyError) as exc:
                # Partial streamed JSON can become valid later. A complete JSON
                # object with invalid binding/schema is a reviewable failure,
                # not a reason to wait out the full remote timeout.
                try:
                    clean = reply.strip()
                    if clean.startswith('```'):
                        clean = clean.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
                    complete_json = json.loads(clean)
                except (ValueError, IndexError):
                    continue
                if isinstance(complete_json, dict):
                    state.update(state='invalid_output', error_type='InvalidOutput',
                                 validation_error=type(exc).__name__)
                    return
                continue
            state.update(state='complete', output=value)
            state['reason_over_target'] = any(len(row['reason']) > 300 for row in value['items'])
            if normalized is not None:
                state.update(normalized_reply=normalized, normalization='redundant_selection_metadata')
            return
        time.sleep(interval)
    state.update(state='uncertain', error_type='TimeoutPendingRemote')


def repairable(state, batch):
    """Only a complete structured reply scoped to exactly this batch can retry.

    Missing/partial replies or foreign words remain ambiguous and quarantined.
    The next attempt ranks the SAME frozen input; it never trusts a bad reply.
    """
    if state.get('state') == 'complete' or not state.get('dispatch_started'):
        return False
    text = state.get('raw_reply')
    if not isinstance(text, str) or len(text) > 30000:
        return False
    try:
        clean = text.strip()
        if clean.startswith('```'):
            clean = clean.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
        value = json.loads(clean)
        rows = value.get('items') if isinstance(value, dict) else None
        return (isinstance(rows, list) and len(rows) == len(batch['tasks'])
                and all(isinstance(r, dict) and isinstance(r.get('lemma'), str) for r in rows)
                and len({r['lemma'] for r in rows}) == len(rows)
                and {r['lemma'] for r in rows} == {t['lemma'] for t in batch['tasks']})
    except (ValueError, IndexError):
        return False


def execute(out, batch, cap, timeout, interval, reconcile=False, reuse=False, repair=False):
    path = out / 'jobs' / (batch['batch_id'] + '.json')
    if path.exists():
        state = read(path)
        if state['state'] == 'complete':
            validate(state.get('normalized_reply') or state['raw_reply'], state['job_id'], batch['tasks'])
            return state
        if repair:
            if not repairable(state, batch) or state.get('repair_attempt', 0) >= 2:
                raise ValueError('Ambiguous dispatch cannot be repaired automatically')
            archive = out / 'attempts'
            archive.mkdir(mode=0o700, exist_ok=True)
            write(archive / (batch['batch_id'] + '-' + digest(state)[:24] + '.json'), state)
            state = {'batch_id': batch['batch_id'], 'job_id': uuid.uuid4().hex[:12],
                     'state': 'preparing', 'started_at': time.time(), 'dispatch_started': False,
                     'repair_attempt': state.get('repair_attempt', 0) + 1}
            write(path, state)
        elif state.get('dispatch_started'):
            if not reconcile or not state.get('session_id'):
                return state  # Never automatically repeat an uncertain dispatch.
        elif reconcile:
            return state
        else:
            errors = state.get('preflight_errors', []) + [{k: state[k] for k in (
                'started_at', 'finished_at', 'error_type', 'error_phase', 'error_code', 'error_status',
                'known_error_labels', 'elapsed_ms') if k in state}]
            state = {'batch_id': batch['batch_id'], 'job_id': str(uuid.uuid4()),
                     'state': 'preparing', 'started_at': time.time(), 'dispatch_started': False,
                     'preflight_errors': errors, 'repair_attempt': state.get('repair_attempt', 0)}
            write(path, state)  # Safe: previous attempt never reached dispatch intent.
    else:
        if reconcile:
            return None
        state = {'batch_id': batch['batch_id'], 'job_id': uuid.uuid4().hex[:12],
                 'state': 'preparing', 'started_at': time.time(), 'dispatch_started': False}
        write(path, state)
    if reconcile:
        prior = {k: state[k] for k in ('error_type', 'error_phase', 'error_code', 'error_status', 'finished_at') if k in state}
        if prior:
            state.setdefault('prior_errors', []).append(prior)
        for key in ('error_type', 'error_phase', 'error_code', 'error_status'):
            state.pop(key, None)
    gw = None
    started = time.monotonic()
    phase = 'connect'
    try:
        gw = acquire(reuse)
        if not reconcile:
            phase = 'session_start'
            sid = new_session(gw.call_json('session.start', body={'method': '/api/session/start', 'params': {
                'origin': 'fresh', 'lifecycle': 'persistent', 'title': 'Langoo M10.5 batch ' + batch['batch_id']}}, timeout=25))
            state['session_id'] = sid  # Private checkpoint for reconciliation; not copied into public reports.
            history = gw.call_json('chat.history', body={'session_id': sid, 'limit': 1}, timeout=20)
            if history.get('chat_events'):
                raise ValueError('New chat not empty')
            text = prompt(batch['tasks'], state['job_id'])
            reserve(out, cap)
            state.update(state='dispatched', dispatch_started=True, dispatch_at=time.time(), input_chars=len(text))
            write(path, state)  # Intent must be durable BEFORE the network send.
            phase = 'send'
            gw.generation_status = None
            gw.generation_stream = gw._open('chat.stream', body={'session_id': sid, 'items': [{'type': 'text', 'text': text}],
                                                                'node_id': str(uuid.uuid4()), 'capabilities': {}})
        phase = 'poll'
        poll(gw, state, batch, timeout, interval)
    except Exception as exc:
        state.update(state='uncertain' if state.get('dispatch_started') else 'blocked',
                     **safe_error(exc, phase))
        # Do not serialize external exception text: it can contain auth URLs.
    finally:
        if gw and getattr(gw, 'generation_status', None) is not None:
            state['generation_status'] = gw.generation_status
        if gw and (not reuse or state['state'] != 'complete'):
            try:
                gw.close()
            except Exception:
                pass
            if reuse:
                with CONNECTION_LOCK:
                    if gw in CONNECTIONS:
                        CONNECTIONS.remove(gw)
                WORKER_LOCAL.gateway = None
        duration = round((time.monotonic() - started) * 1000)
        if reconcile:
            state['reconcile_elapsed_ms'] = duration
        else:
            state['elapsed_ms'] = duration
        state['finished_at'] = time.time()
        if reconcile:
            state['reconciled'] = True
        write(path, state)
    print(json.dumps({'batch': batch['batch_id'], 'state': state['state'],
                      'words': [t['lemma'] for t in batch['tasks']], 'elapsed_ms': state.get('elapsed_ms', state.get('reconcile_elapsed_ms')),
                      **{k: state[k] for k in ('error_type', 'error_phase', 'error_code', 'error_status') if k in state}}), flush=True)
    return state


def inspect(out, manifest, snapshot):
    batches = list(manifest['batches'])
    dynamic = out / 'final-batches.json'
    extra = read(dynamic) if dynamic.exists() else []
    # Validate persisted dependent tasks against frozen sources + part outputs
    # before accepting their output or dispatching them.
    source_parts = {}
    for batch in batches:
        path = out / 'jobs' / (batch['batch_id'] + '.json')
        if path.exists():
            state = read(path)
            if state['state'] == 'complete':
                value = validate(state.get('normalized_reply') or state['raw_reply'], state['job_id'], batch['tasks'])
                for t in batch['tasks']:
                    source_parts[t['task_id']] = next(r for r in value['items'] if r['lemma'] == t['lemma'])
    if len({b['batch_id'] for b in extra}) != len(extra):
        raise ValueError('Duplicate dependent batch')
    for b in extra:
        if len(b.get('tasks', [])) != 1:
            raise ValueError('Invalid dependent batch')
        lemma = b['tasks'][0]['lemma']
        word = next((w for w in manifest['words'] if w['lemma'] == lemma), None)
        if not word or not word['part_task_ids'] or not all(p in source_parts for p in word['part_task_ids']):
            raise ValueError('Dependent batch without completed fragments')
        record = next(r for r in snapshot['records'] if r['lemma'] == lemma)
        expected = final_batch(record, [source_parts[p] for p in word['part_task_ids']], manifest['config'])
        if b != expected:
            raise ValueError('Dependent batch drift')
    batches.extend(extra)
    completed_tasks = {}
    for batch in batches:
        path = out / 'jobs' / (batch['batch_id'] + '.json')
        if path.exists():
            state = read(path)
            if state['state'] == 'complete':
                value = validate(state.get('normalized_reply') or state['raw_reply'], state['job_id'], batch['tasks'])
                for t in batch['tasks']:
                    completed_tasks[t['task_id']] = next(r for r in value['items'] if r['lemma'] == t['lemma'])
    blocked_finals = []
    for word in manifest['words']:
        parts = word['part_task_ids']
        if parts and all(p in completed_tasks for p in parts) and not any(b['tasks'][0]['lemma'] == word['lemma'] for b in extra):
            record = next(r for r in snapshot['records'] if r['lemma'] == word['lemma'])
            try:
                extra.append(final_batch(record, [completed_tasks[p] for p in parts], manifest['config']))
            except ValueError as exc:
                blocked_finals.append({'lemma': word['lemma'], 'error': str(exc)})
    write(dynamic, extra)
    final_rows = [completed_tasks[r['lemma'] + ':final:0'] for r in snapshot['records']
                  if r['lemma'] + ':final:0' in completed_tasks]
    write(out / 'results.json', {'version': VERSION, 'snapshot_sha256': manifest['snapshot_sha256'],
                                'items': final_rows, 'complete': len(final_rows) == len(snapshot['records']),
                                'blocked_finals': blocked_finals})
    return manifest['batches'] + extra


def load(out):
    manifest, snapshot = read(out / 'manifest.json'), read(out / 'input.json')
    if manifest['version'] != VERSION or manifest['snapshot_sha256'] != digest(snapshot):
        raise ValueError('Snapshot/version drift')
    rebuilt = prepare(snapshot, manifest['config']['prompt_budget_chars'], manifest['config']['max_words'], manifest['config']['solo_senses'])
    if rebuilt != manifest:
        raise ValueError('Manifest drift')
    return manifest, snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('--input', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--budget', type=int, default=40000)
    p.add_argument('--max-words', type=int, default=5)
    p.add_argument('--solo-senses', type=int, default=80)
    for name in ('run', 'reconcile', 'status'):
        p = sub.add_parser(name)
        p.add_argument('--out', required=True, type=Path)
        if name != 'status':
            p.add_argument('--workers', type=int, default=3)
            p.add_argument('--timeout', type=int, default=180)
            p.add_argument('--interval', type=float, default=2)
            p.add_argument('--cap', type=int)  # default: finite upper bound from prepared DAG
            p.add_argument('--fresh-connections', action='store_true', help='diagnostic: reconnect for every batch')
            p.add_argument('--repair-budget', type=int, default=2, help='finite total retries of complete malformed replies; never ambiguous sends')
            p.add_argument('--failure-streak', type=int, default=6, help='stop filling queue after consecutive failures; checkpoints remain resumable')
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'prepare':
        snapshot = read(args.input)
        manifest = prepare(snapshot, args.budget, args.max_words, args.solo_senses)
        args.out.mkdir(mode=0o700, parents=True, exist_ok=False)
        (args.out / 'jobs').mkdir(mode=0o700)
        write(args.out / 'input.json', snapshot)
        write(args.out / 'manifest.json', manifest)
        print(json.dumps({'words': len(manifest['words']), 'batches': len(manifest['batches']),
                          'polysemous': sum(w['polysemous'] for w in manifest['words']),
                          'max_dispatches': manifest['planned_max_dispatches']}))
        return 0
    with contextlib.ExitStack() as stack:
        lock = stack.enter_context((args.out / 'runner.lock').open('a'))
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # One scheduler per run directory.
        if args.command != 'status':
            account = stack.enter_context(ACCOUNT_LOCK.open('r'))
            fcntl.flock(account, fcntl.LOCK_EX | fcntl.LOCK_NB)  # Total worker cap across native runs.
        manifest, snapshot = load(args.out)
        if args.command == 'status':
            batches = inspect(args.out, manifest, snapshot)
            result = read(args.out / 'results.json')
            problems = []
            for batch in batches:
                path = args.out / 'jobs' / (batch['batch_id'] + '.json')
                state = read(path) if path.exists() else {'state': 'pending'}
                if state['state'] != 'complete':
                    problems.append({'batch_id': batch['batch_id'], 'state': state['state'],
                                     'words': [t['lemma'] for t in batch['tasks']],
                                     'repairable_complete_reply': repairable(state, batch),
                                     **{k: state[k] for k in ('error_type', 'repair_attempt') if k in state}})
            print(json.dumps({'words_complete': len(result['items']), 'total': len(manifest['words']),
                              'complete': result['complete'], 'blocked_finals': result['blocked_finals'],
                              'pending_or_failed_batches': problems}))
            return 0
        if not 1 <= args.workers <= 4 or args.timeout < 30 or args.interval < 1 or not 0 <= args.repair_budget <= 10 or not 1 <= args.failure_streak <= 20:
            raise ValueError('Invalid run limits')
        cap = args.cap if args.cap is not None else manifest['planned_max_dispatches'] + args.repair_budget
        if cap < 1 or cap > 10000:
            raise ValueError('Invalid dispatch cap')
        started = time.monotonic()
        started_at = time.time()
        # Checkpoint/journal is authoritative; no process-local queue checkpoint.
        if args.command == 'reconcile':
            for batch in inspect(args.out, manifest, snapshot):
                execute(args.out, batch, cap, args.timeout, args.interval, reconcile=True)
        else:
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                pending = {}
                attempted = set()
                repaired = set()
                failure_streak = 0
                while True:
                    batches = inspect(args.out, manifest, snapshot)
                    known = {b['batch_id'] for b in pending.values()}
                    ready = []
                    for b in batches:
                        path = args.out / 'jobs' / (b['batch_id'] + '.json')
                        if b['batch_id'] not in known and b['batch_id'] not in attempted:
                            if not path.exists() or (read(path)['state'] != 'complete' and not read(path).get('dispatch_started')):
                                ready.append(b)
                    # Fill freed worker slots immediately, including newly ready finals.
                    slots = max(0, args.workers - len(pending)) if failure_streak < args.failure_streak else 0
                    for b in ready[:slots]:
                        future = pool.submit(execute, args.out, b, cap, args.timeout, args.interval, reuse=not args.fresh_connections)
                        pending[future] = b
                        attempted.add(b['batch_id'])
                    used_repairs = sum(read(p).get('repair_attempt', 0) for p in (args.out / 'jobs').glob('*.json'))
                    for b in batches:
                        if len(pending) >= args.workers or used_repairs >= args.repair_budget or failure_streak >= args.failure_streak:
                            break
                        path = args.out / 'jobs' / (b['batch_id'] + '.json')
                        if b['batch_id'] not in known and b['batch_id'] not in repaired and path.exists():
                            state = read(path)
                            if repairable(state, b) and state.get('repair_attempt', 0) < 2:
                                future = pool.submit(execute, args.out, b, cap, args.timeout, args.interval,
                                                     reuse=not args.fresh_connections, repair=True)
                                pending[future] = b
                                repaired.add(b['batch_id'])
                                used_repairs += 1
                    if not pending:
                        break
                    done, _ = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
                    for future in done:
                        result_state = future.result()
                        failure_streak = 0 if result_state['state'] == 'complete' else failure_streak + 1
                        del pending[future]
            for gw in CONNECTIONS:
                try:
                    gw.close()
                except Exception:
                    pass
        inspect(args.out, manifest, snapshot)
        result = read(args.out / 'results.json')
        states = [read(p) for p in (args.out / 'jobs').glob('*.json')]
        stats = {'task': 'M10.5', 'workers': args.workers, 'reuse_connections': not args.fresh_connections,
                 'command': args.command, 'started_at': started_at, 'finished_at': time.time(),
                 'wall_ms': round((time.monotonic() - started) * 1000),
                 'words_complete': len(result['items']), 'total_words': len(manifest['words']),
                 'dispatches': read(args.out / 'dispatch-count.json')['count'] if (args.out / 'dispatch-count.json').exists() else 0,
                 'complete_batches': sum(s['state'] == 'complete' for s in states),
                 'uncertain_batches': sum(s['state'] == 'uncertain' for s in states),
                 'blocked_batches': sum(s['state'] == 'blocked' for s in states),
                 'normalized_batches': sum(bool(s.get('normalization')) for s in states),
                 'reason_over_target_batches': sum(bool(s.get('reason_over_target')) for s in states),
                 'invalid_output_batches': sum(s['state'] == 'invalid_output' for s in states),
                 'repair_dispatches_budget': args.repair_budget,
                 'repair_attempts': sum(s.get('repair_attempt', 0) for s in states),
                 'needs_review_words': sum(r['needs_review'] for r in result['items']),
                 'latencies_ms': [s['elapsed_ms'] for s in states if s['state'] == 'complete' and 'elapsed_ms' in s],
                 'peak_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                 'snapshot_sha256': manifest['snapshot_sha256']}
        ledger_path = args.out / 'invocations.json'
        ledger = read(ledger_path) if ledger_path.exists() else []
        if any(row['snapshot_sha256'] != manifest['snapshot_sha256'] for row in ledger):
            raise ValueError('Invocation ledger drift')
        ledger.append(dict(stats))
        write(ledger_path, ledger)
        stats['cumulative_active_ms'] = sum(row['wall_ms'] for row in ledger)
        stats['cumulative_peak_rss_kib'] = max(row['peak_rss_kib'] for row in ledger)
        write(args.out / ('reconcile-stats.json' if args.command == 'reconcile' else 'execution-stats.json'), stats)
        print(json.dumps(stats), flush=True)
        return 0 if result['complete'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({'error_type': type(exc).__name__}), file=sys.stderr)
        sys.exit(1)
