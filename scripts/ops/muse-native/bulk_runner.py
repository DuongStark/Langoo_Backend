#!/usr/bin/env python3
"""M10.5: bounded-shard, restartable VPS automation. Muse decides; no AI judge."""
import argparse
import fcntl
import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from batch_core import VERSION, digest, prepare
from batch_runner import inspect, load, read, repairable, write

BULK_VERSION = 'm10.5-bulk-v1'
SERVICE = Path(__file__).resolve().parent
STOP = threading.Event()


def safe_child(root, name):
    if not isinstance(name, str) or not name or Path(name).name != name or name in ('.', '..'):
        raise ValueError('Invalid artifact name')
    return root / name


def file_hash(path):
    with path.open('rb') as fh:
        return hashlib.file_digest(fh, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else hashlib.sha256(fh.read()).hexdigest()


def prepare_bulk(inventory, out, workers=3, repair_budget=10):
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (out / 'prepare.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return _prepare_bulk(inventory, out, workers, repair_budget)


def _prepare_bulk(inventory, out, workers, repair_budget):
    index = read(inventory / 'inventory.json')
    if index.get('read_only') is not True or not 1 <= workers <= 4 or not 0 <= repair_budget <= 10:
        raise ValueError('Invalid bulk preparation')
    if (out / 'bulk-manifest.json').exists():
        raise FileExistsError('Already prepared; use run/status')
    binding = {'inventory_sha256': digest(index), 'core_version': VERSION, 'workers': workers,
               'repair_budget': repair_budget}
    marker = out / 'preparation.json'
    if marker.exists() and read(marker) != binding:
        raise ValueError('Partial preparation config drift')
    write(marker, binding)
    (out / 'shards').mkdir(mode=0o700, exist_ok=True)
    manifest = {'version': BULK_VERSION, 'core_version': VERSION, 'inventory_sha256': digest(index),
                'policy': 'muse_direct_no_semantic_recheck',
                'config': {'workers': workers, 'repair_budget_per_shard': repair_budget,
                           'max_rounds': 3, 'timeout': 180, 'reconcile_timeout': 30},
                'words': 0, 'senses': 0, 'planned_base_dispatches': 0, 'max_dispatches': 0, 'shards': []}
    seen_words, seen_ids = set(), set()
    for item in index['shards']:
        source = safe_child(inventory, item['file'])
        if file_hash(source) != item['file_sha256']:
            raise ValueError('Inventory hash drift')
        snapshot = read(source)
        if snapshot.get('read_only') is not True or len(snapshot['records']) != item['words'] or not 1 <= item['words'] <= 100:
            raise ValueError('Invalid source shard')
        good, blocked, excluded_empty = [], [], []
        for record in snapshot['records']:
            if record['lemma'] in seen_words:
                raise ValueError('Cross-shard duplicate word')
            seen_words.add(record['lemma'])
            for sense in record['senses']:
                if sense['senseId'] in seen_ids:
                    raise ValueError('Cross-shard duplicate ID')
                seen_ids.add(sense['senseId'])
            # A source ID with no definition/path supplies no ranking evidence.
            # Keep it in source.json, but do not reject an otherwise usable word.
            empty_ids = [s['senseId'] for s in record['senses']
                         if s.get('definition') in (None, '') and s.get('rawDefinition') in (None, '')
                         and s.get('glossEnContext') in (None, [])]
            empty_set = set(empty_ids)
            candidate = {**record, 'senses': [s for s in record['senses'] if s['senseId'] not in empty_set]}
            if empty_ids:
                excluded_empty.append({'lemma': record['lemma'], 'ids': empty_ids, 'reason': 'no_definition_context'})
            try:
                prepare({**snapshot, 'records': [candidate]})
                good.append(candidate)
            except (ValueError, KeyError, TypeError):
                # Preserve the complete source. Never trim a word to make it fit.
                blocked.append({'lemma': record['lemma'], 'state': 'source_not_preparable'})
        name = 'shard-' + str(len(manifest['shards']) + 1).zfill(4)
        folder = out / 'shards' / name
        folder.mkdir(mode=0o700, exist_ok=True)
        if (folder / 'source.json').exists() and read(folder / 'source.json') != snapshot:
            raise ValueError('Partial source drift')
        write(folder / 'source.json', snapshot)
        if good:
            runnable = {**snapshot, 'records': good}
            batches = prepare(runnable)
            (folder / 'jobs').mkdir(mode=0o700, exist_ok=True)
            for filename, value in (('input.json', runnable), ('manifest.json', batches)):
                if (folder / filename).exists() and read(folder / filename) != value:
                    raise ValueError('Partial prepared shard drift')
            write(folder / 'input.json', runnable)
            write(folder / 'manifest.json', batches)
            base = batches['planned_max_dispatches']
        else:
            base = 0
        manifest['shards'].append({'name': name, 'words': len(snapshot['records']), 'runnable_words': len(good),
                                   'source_sha256': digest(snapshot), 'input_sha256': digest(runnable) if good else None,
                                   'blocked_source': blocked, 'excluded_empty_senses': excluded_empty,
                                   'base_dispatches': base,
                                   'max_dispatches': base + (repair_budget if good else 0)})
        manifest['words'] += len(snapshot['records'])
        manifest['senses'] += sum(len(r['senses']) for r in snapshot['records'])
        manifest['planned_base_dispatches'] += base
        manifest['max_dispatches'] += base + (repair_budget if good else 0)
    if not manifest['shards'] or manifest['words'] != index['words'] or manifest['senses'] != index['senses']:
        raise ValueError('Inventory count mismatch')
    write(out / 'inventory.json', index)
    write(out / 'bulk-state.json', {'manifest_sha256': digest(manifest), 'shards': {}, 'created_at': time.time()})
    publish(out, manifest, read(out / 'bulk-state.json'), 'prepared')
    write(out / 'bulk-manifest.json', manifest)  # Preparation commit marker, written last.
    return manifest


def load_bulk(out):
    manifest, state = read(out / 'bulk-manifest.json'), read(out / 'bulk-state.json')
    if manifest['version'] != BULK_VERSION or manifest['core_version'] != VERSION or state['manifest_sha256'] != digest(manifest):
        raise ValueError('Bulk manifest drift')
    if digest(read(out / 'inventory.json')) != manifest['inventory_sha256']:
        raise ValueError('Bulk inventory drift')
    return manifest, state


def summarize_shard(folder, spec, refresh=False):
    if digest(read(folder / 'source.json')) != spec['source_sha256']:
        raise ValueError('Source shard drift')
    blocked = list(spec['blocked_source'])
    if not spec['runnable_words']:
        return [], blocked, False, 0
    manifest, snapshot = load(folder)
    if manifest['snapshot_sha256'] != spec['input_sha256']:
        raise ValueError('Runnable shard drift')
    batches = inspect(folder, manifest, snapshot) if refresh else manifest['batches']
    result = read(folder / 'results.json') if (folder / 'results.json').exists() else {'items': []}
    if result.get('snapshot_sha256', manifest['snapshot_sha256']) != manifest['snapshot_sha256']:
        raise ValueError('Result hash drift')
    accepted = {r['lemma'] for r in result['items']}
    # Refresh validates actual replies/IDs; this view contains no transport secrets.
    for record in snapshot['records']:
        if record['lemma'] not in accepted:
            blocked.append({'lemma': record['lemma'], 'state': 'unresolved'})
    counter = folder / 'dispatch-count.json'
    dispatches = read(counter)['count'] if counter.exists() else 0
    retryable = False
    for batch in batches:
        path = folder / 'jobs' / (batch['batch_id'] + '.json')
        job = read(path) if path.exists() else {'state': 'pending'}
        if not job.get('dispatch_started') and job['state'] != 'complete':
            retryable = True
    retryable = retryable and dispatches < spec['max_dispatches']
    return result['items'], blocked, retryable, dispatches


def atomic_lines(path, rows):
    temp = path.with_name(path.name + '.tmp')
    with temp.open('w', encoding='utf-8') as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
        fh.flush()
        os.fsync(fh.fileno())
    temp.replace(path)
    parent = os.open(path.parent, os.O_DIRECTORY | os.O_RDONLY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def save_results(out, manifest, spec):
    folder = out / 'shards' / spec['name']
    rows, problems, retryable, dispatches = summarize_shard(folder, spec, refresh=True)
    atomic_lines(folder / 'accepted.jsonl', [{'task': 'M10.5', 'provider': 'muse_native',
        'policy': manifest['policy'], 'source_sha256': spec['source_sha256'],
        'snapshot_sha256': spec['input_sha256'], **row} for row in rows])
    write(folder / 'unresolved.json', problems)
    return {'words_complete': len(rows), 'unresolved': len(problems), 'retryable_preflight': retryable,
            'dispatches': dispatches, 'needs_review_words': sum(row['needs_review'] for row in rows)}


def aggregate(out, manifest):
    def rows(filename):
        for spec in manifest['shards']:
            path = out / 'shards' / spec['name'] / filename
            if path.exists():
                with path.open(encoding='utf-8') as fh:
                    for line in fh:
                        yield json.loads(line)
    atomic_lines(out / 'results.jsonl', rows('accepted.jsonl'))
    problems = []
    for spec in manifest['shards']:
        path = out / 'shards' / spec['name'] / 'unresolved.json'
        if path.exists():
            problems.extend({'shard': spec['name'], **r} for r in read(path))
    write(out / 'unresolved.json', problems)


def can_repair(folder, spec, budget):
    if not spec['runnable_words']:
        return False
    manifest, snapshot = load(folder)
    batches = inspect(folder, manifest, snapshot)
    states = [read(p) for p in (folder / 'jobs').glob('*.json')]
    if sum(s.get('repair_attempt', 0) for s in states) >= budget:
        return False
    for batch in batches:
        path = folder / 'jobs' / (batch['batch_id'] + '.json')
        if path.exists():
            job = read(path)
            if job.get('repair_attempt', 0) < 2 and repairable(job, batch):
                return True
    return False


def publish(out, manifest, state, phase, current=None):
    completed = state['shards'].values()
    progress = {'task': 'M10.5', 'state': phase, 'updated_at': time.time(), 'current_shard': current,
                'policy': manifest['policy'], 'workers': manifest['config']['workers'],
                'words_total': manifest['words'], 'shards_total': len(manifest['shards']),
                'shards_settled': sum(row.get('settled', False) for row in completed),
                'words_complete': sum(row.get('words_complete', 0) for row in completed),
                'unresolved_settled': sum(row.get('unresolved', 0) for row in completed if row.get('settled')),
                'dispatches': sum(row.get('dispatches', 0) for row in completed),
                'max_dispatches': manifest['max_dispatches'],
                'needs_review_words': sum(row.get('needs_review_words', 0) for row in completed),
                'semantic_rechecked': False}
    if 'started_at' in state:
        progress['started_at'] = state['started_at']
        progress['elapsed_s_including_pauses'] = round(time.time() - state['started_at'])
    write(out / 'progress.json', progress)
    return progress


def invoke(out, manifest, spec, command, state):
    folder = out / 'shards' / spec['name']
    config = manifest['config']
    timeout = config['reconcile_timeout'] if command == 'reconcile' else config['timeout']
    args = [sys.executable, '-B', str(SERVICE / 'batch_runner.py'), command, '--out', str(folder),
            '--workers', str(config['workers']), '--timeout', str(timeout),
            '--repair-budget', str(config['repair_budget_per_shard'])]
    with (folder / 'runner.log').open('a', encoding='utf-8') as log:
        child = subprocess.Popen(args, stdout=log, stderr=log, cwd=SERVICE)
        while child.poll() is None:
            if STOP.wait(10):
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
                return 130
            # Per-batch runner checkpoints expose current results every completion.
            result_file = folder / 'results.json'
            count_file = folder / 'dispatch-count.json'
            row = state['shards'].setdefault(spec['name'], {})
            if result_file.exists():
                current = read(result_file)['items']
                row.update(words_complete=len(current), needs_review_words=sum(r['needs_review'] for r in current))
            if count_file.exists():
                row['dispatches'] = read(count_file)['count']
            publish(out, manifest, state, command, spec['name'])
        return child.returncode


def run_bulk(out):
    with (out / 'bulk.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest, state = load_bulk(out)
        state.setdefault('started_at', time.time())
        config = manifest['config']
        for spec in manifest['shards']:
            name = spec['name']
            row = state['shards'].setdefault(name, {})
            if row.get('settled'):
                # Revalidate persisted completed results once on resume, no send.
                row.update(save_results(out, manifest, spec))
                continue
            folder = out / 'shards' / name
            # Validate frozen sources and existing replies BEFORE any network call.
            summarize_shard(folder, spec, refresh=True)
            if spec['runnable_words']:
                # A restarted process first reads ONLY saved uncertain side-chats.
                if any(read(p).get('dispatch_started') and read(p)['state'] not in ('complete', 'invalid_output')
                       for p in (folder / 'jobs').glob('*.json')):
                    invoke(out, manifest, spec, 'reconcile', state)
                for attempt in range(config['max_rounds']):
                    if STOP.is_set():
                        break
                    row['rounds_total'] = row.get('rounds_total', 0) + 1
                    write(out / 'bulk-state.json', state)
                    publish(out, manifest, state, 'running', name)
                    rc = invoke(out, manifest, spec, 'run', state)
                    if rc not in (0, 1, 130):
                        raise RuntimeError('Runner failed')
                    if STOP.is_set():
                        break
                    row.update(save_results(out, manifest, spec))
                    write(out / 'bulk-state.json', state)
                    aggregate(out, manifest)
                    if row['words_complete'] == spec['runnable_words']:
                        break
                    if any(read(p).get('dispatch_started') and read(p)['state'] not in ('complete', 'invalid_output')
                           for p in (folder / 'jobs').glob('*.json')):
                        invoke(out, manifest, spec, 'reconcile', state)
                        row.update(save_results(out, manifest, spec))
                    if not row['retryable_preflight'] and not can_repair(folder, spec, config['repair_budget_per_shard']):
                        break
                    if attempt < config['max_rounds'] - 1:
                        publish(out, manifest, state, 'backoff', name)
                        if STOP.wait(30 * (attempt + 1)):
                            break
            if STOP.is_set():
                row.update(save_results(out, manifest, spec))
                write(out / 'bulk-state.json', state)
                aggregate(out, manifest)
                publish(out, manifest, state, 'stopped', name)
                return 130
            row.update(save_results(out, manifest, spec))
            if row['retryable_preflight']:
                # Provider unavailable before send: pause the cohort rather than
                # create thousands of failed chats. systemd retries after 15m.
                write(out / 'bulk-state.json', state)
                aggregate(out, manifest)
                publish(out, manifest, state, 'waiting_provider', name)
                return 75
            row.update(settled=True, finished_at=time.time())
            write(out / 'bulk-state.json', state)
            aggregate(out, manifest)
            publish(out, manifest, state, 'running', name)
        aggregate(out, manifest)
        phase = 'complete' if sum(r.get('words_complete', 0) for r in state['shards'].values()) == manifest['words'] else 'complete_with_unresolved'
        publish(out, manifest, state, phase)
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('prepare')
    p.add_argument('--inventory', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--workers', type=int, default=3)
    p.add_argument('--repair-budget', type=int, default=10)
    for name in ('run', 'status', 'collect'):
        p = commands.add_parser(name)
        p.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'prepare':
        manifest = prepare_bulk(args.inventory, args.out, args.workers, args.repair_budget)
        print(json.dumps({k: manifest[k] for k in ('words', 'senses', 'planned_base_dispatches', 'max_dispatches')}))
        return 0
    if args.command == 'status':
        print(json.dumps(read(args.out / 'progress.json')))
        return 0
    if args.command == 'collect':
        with (args.out / 'bulk.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            manifest, state = load_bulk(args.out)
            for spec in manifest['shards']:
                row = state['shards'].setdefault(spec['name'], {})
                row.update(save_results(args.out, manifest, spec))
            write(args.out / 'bulk-state.json', state)
            aggregate(args.out, manifest)
        return 0
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: STOP.set())
    return run_bulk(args.out)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({'task': 'M10.5', 'error_type': type(exc).__name__}), file=sys.stderr)
        sys.exit(1)
