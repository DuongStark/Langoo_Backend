"""M10.5: bounded native gateway smoke/paired concurrency benchmark on VPS."""
import concurrent.futures
import hashlib
import fcntl
import json
import os
import re
import resource
import sys
import time
import uuid
from pathlib import Path

ROOT = Path('/opt/langoo/services/muse-native')
OUT = Path('/opt/langoo/storage/muse-native')
sys.path.insert(0, str(ROOT))
from muse import Gateway, load_cookies

COOKIES = OUT / 'cookies.json'
FIXTURE = [
    {'lemma': 'cat', 'senses': [{'id': '1001', 'definition': 'A domestic feline animal commonly kept as a pet.'}, {'id': '1002', 'definition': 'A Unix program that concatenates files.'}]},
    {'lemma': 'bank', 'senses': [{'id': '2001', 'definition': 'A financial institution that accepts deposits.'}, {'id': '2002', 'definition': 'Sloping land beside a river.'}]},
    {'lemma': 'draw', 'senses': [{'id': '3001', 'definition': 'To make a picture with a pencil, pen, or similar instrument.'}, {'id': '3002', 'definition': 'To pull something in a particular direction.', 'tags': ['formal']}]},
]
EXPECTED = {'cat': '1001', 'bank': '2001', 'draw': '3001'}


def atomic(name, value):
    path = OUT / name
    temp = path.with_suffix(path.suffix + '.tmp')
    with temp.open('w') as fh:
        json.dump(value, fh, ensure_ascii=False, indent=2)
    os.chmod(temp, 0o600)
    temp.replace(path)


def validate(text, marker, fixture=FIXTURE):
    value = json.loads(re.sub(r'^```(?:json)?\s*([\s\S]*?)\s*```$', r'\1', text.strip(), flags=re.I))
    if not isinstance(value, dict) or set(value) != {'job_id', 'items'} or value['job_id'] != marker:
        raise ValueError('Correlation mismatch')
    rows = value['items']
    if not isinstance(rows, list) or len(rows) != len(fixture):
        raise ValueError('Missing word')
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError('Invalid item')
    if len({row.get('lemma') for row in rows}) != len(fixture):
        raise ValueError('Duplicate word')
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'lemma', 'sense_id'}:
            raise ValueError('Schema mismatch')
        source = next((word for word in fixture if word['lemma'] == row['lemma']), None)
        if not source or row['sense_id'] not in {sense['id'] for sense in source['senses']}:
            raise ValueError('Foreign sense ID')
    return value


def session_id(value):
    if not isinstance(value, dict):
        raise ValueError('Unexpected session response')
    for candidate in (value, value.get('session'), value.get('result')):
        if isinstance(candidate, dict):
            for key in ('session_id', 'id'):
                sid = candidate.get(key)
                if isinstance(sid, str):
                    try:
                        uuid.UUID(sid)
                        return sid
                    except ValueError:
                        pass
    raise ValueError('No valid new side-chat ID')


def probe():
    started = time.monotonic()
    gateway = None
    result = {'task': 'M10.5', 'mode': 'probe', 'ok': False}
    try:
        gateway = Gateway(load_cookies(str(COOKIES)))
        gateway.call_json('vm.health', timeout=20)
        result['ok'] = True
    except Exception as exc:
        result['error_type'] = type(exc).__name__
        result['status'] = getattr(exc, 'status', None)
    finally:
        if gateway:
            gateway.close()
    result['elapsed_ms'] = round((time.monotonic() - started) * 1000)
    atomic('probe.json', result)
    print(json.dumps(result), flush=True)
    return result['ok']


def reserve_generation():
    with (OUT / 'generation.lock').open('a') as lock:
        os.chmod(OUT / 'generation.lock', 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = OUT / 'generation-count.json'
        count = json.loads(path.read_text())['count'] if path.exists() else 0
        if count >= 20:
            raise ValueError('Generation cap exhausted')
        atomic('generation-count.json', {'count': count + 1, 'cap': 20})


def run_job(label, fixture=FIXTURE, expected=EXPECTED):
    previous = OUT / (label + '.json')
    if previous.exists() and json.loads(previous.read_text()).get('dispatch_started'):
        raise ValueError('Prior dispatch exists; inspect before retry')
    marker = str(uuid.uuid4())
    result = {'label': label, 'job_id': marker, 'ok': False, 'sent': False, 'started_at': time.time()}
    gateway = None
    started = time.monotonic()
    try:
        gateway = Gateway(load_cookies(str(COOKIES)))
        created = gateway.call_json('session.start', body={'method': '/api/session/start', 'params': {'origin': 'fresh', 'lifecycle': 'persistent', 'title': 'Langoo M10.5 test ' + label}}, timeout=20)
        sid = session_id(created)
        result['session_hash'] = hashlib.sha256(sid.encode()).hexdigest()
        scope = {'session_id': sid}
        history = gateway.call_json('chat.history', body={'limit': 1, **scope}, timeout=20)
        baseline = max([event.get('seq', 0) or 0 for event in history.get('chat_events', [])] + [0])
        if baseline:
            raise ValueError('New chat not empty')
        prompt = 'Choose the most useful primary meaning for a general beginner learning modern English. Only choose supplied IDs. Do not use tools or browse. Return ONLY JSON with exact keys job_id and items. Each item has only lemma and sense_id. Preserve job_id exactly: ' + marker + '\nDATA: ' + json.dumps(fixture)
        reserve_generation()
        result['dispatch_started'] = True
        atomic(label + '.json', result)
        gateway._open('chat.stream', body={'items': [{'type': 'text', 'text': prompt}], 'node_id': str(uuid.uuid4()), 'capabilities': {}, **scope})
        result['sent'] = True
        result['send_at'] = time.time()
        result['input_chars'] = len(prompt)
        deadline = time.monotonic() + 120
        last_text = None
        while time.monotonic() < deadline:
            history = gateway.call_json('chat.history', body={'limit': 10, **scope}, timeout=15)
            for event in history.get('chat_events', []):
                payload = event.get('payload', {})
                if not isinstance(payload, dict):
                    continue
                if event.get('event_name') != 'message.assistant' or (event.get('seq', 0) or 0) <= baseline or payload.get('reply_to_message_id') or event.get('reply_to_message_id'):
                    continue
                text = payload.get('display_text') or payload.get('content') or event.get('text')
                if not isinstance(text, str) or len(text) > 8000:
                    continue
                last_text = text
                try:
                    value = validate(text, marker, fixture)
                except (ValueError, TypeError, KeyError):
                    continue
                result['reply'] = text
                result['output'] = value
                result['semantic_ok'] = ({row['lemma']: row['sense_id'] for row in value['items']} == expected) if expected is not None else None
                result['ok'] = True
                return result
            time.sleep(2)
        result['error_type'] = 'TimeoutPendingRemote'
        result['reply'] = last_text
    except Exception as exc:
        result['error_type'] = type(exc).__name__
        result['status'] = getattr(exc, 'status', None)
    finally:
        if gateway:
            gateway.close()
        result['finished_at'] = time.time()
        result['elapsed_ms'] = round((time.monotonic() - started) * 1000)
        result['peak_process_rss_kib'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        atomic(label + '.json', result)
        print(json.dumps({key: result[key] for key in ('label', 'ok', 'sent', 'elapsed_ms', 'error_type', 'status', 'semantic_ok') if key in result}), flush=True)
    return result


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'probe'
    if mode == 'probe':
        return 0 if probe() else 1
    if mode == 'single':
        return 0 if run_job('single-smoke')['ok'] else 1
    if mode == 'long':
        cases = json.loads((OUT / 'long-context-fixtures.json').read_text())
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            rows = list(pool.map(lambda case: run_job('long-' + case['lemma'], [case], None), cases))
        atomic('long-context.json', {'task': 'M10.5', 'jobs': rows, 'transport_ok': all(row['ok'] for row in rows), 'semantic_review_pending': True})
        return 0 if all(row['ok'] for row in rows) else 1
    if mode not in ('benchmark', 'benchmark-reverse'):
        raise ValueError('Unknown mode')
    suffix = '-reverse' if mode == 'benchmark-reverse' else ''
    if (OUT / ('benchmark' + suffix + '.json')).exists():
        raise ValueError('Benchmark already exists; no automatic resends')
    phases = []
    for workers in ((2, 1) if suffix else (1, 2)):
        started = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            rows = list(pool.map(run_job, [f'c{workers}{suffix}-{i}' for i in range(4)]))
        phase = {'concurrency': workers, 'jobs': rows, 'wall_ms': round((time.monotonic() - started) * 1000)}
        phases.append(phase)
        atomic('benchmark' + suffix + '-partial.json', {'task': 'M10.5', 'phases': phases})
        if not all(row['ok'] and row.get('semantic_ok') for row in rows):
            break
    result = {'task': 'M10.5', 'phases': phases, 'peak_process_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
    if len(phases) == 2:
        timings = {phase['concurrency']: phase['wall_ms'] for phase in phases}
        result['speedup'] = timings[1] / timings[2]
        result['gate'] = result['speedup'] >= 1.5 and all(row['ok'] and row.get('semantic_ok') for phase in phases for row in phase['jobs'])
    else:
        result['gate'] = False
    atomic('benchmark' + suffix + '.json', result)
    print(json.dumps({key: value for key, value in result.items() if key != 'phases'}), flush=True)
    return 0 if result['gate'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({'ok': False, 'error_type': type(exc).__name__}), flush=True)
        sys.exit(1)
