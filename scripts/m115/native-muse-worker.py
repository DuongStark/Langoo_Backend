"""Serve Quiz verdict requests over JSON lines using the installed Muse gateway."""

import concurrent.futures
import fcntl
import json
import re
import sys
import threading
import time
import uuid

import muse
from batch_runner import ACCOUNT_LOCK, COOKIE_FILE, new_session, observe_frame, safe_error


class QuizGateway(muse.Gateway):
    def __init__(self, cookies):
        super().__init__(cookies)
        self.fragments = {}

    def _read_frame(self):
        with self._recv_lock:
            while True:
                data, _ = self.ws.recv()
                frame = muse.NoiseTransportFrame.FromString(self.noise.decrypt(bytes(data)))
                total = frame.total_chunks or 1
                if total == 1 and frame.chunk_index == 0:
                    payload = frame.payload
                    break
                if not 0 <= frame.chunk_index < total <= 128:
                    raise ValueError('Invalid Muse frame fragment')
                if frame.chunk_id not in self.fragments and len(self.fragments) >= 32:
                    raise ValueError('Too many incomplete Muse frames')
                parts = self.fragments.setdefault(frame.chunk_id, [None] * total)
                if len(parts) != total or parts[frame.chunk_index] is not None:
                    raise ValueError('Inconsistent Muse frame fragments')
                parts[frame.chunk_index] = frame.payload
                if all(part is not None for part in parts):
                    payload = b''.join(parts)
                    del self.fragments[frame.chunk_id]
                    break
            envelope = muse.ServiceResponse.FromString(payload)
            message = muse.ServiceFrame.FromString(envelope.payload)
            observe_frame(self, message)
            return message


def parse_reply(text, marker, expected):
    clean = re.sub(r'^\s*```(?:json)?\s*|\s*```\s*$', '', text.strip()).strip()
    try:
        value = json.loads(clean)
    except ValueError:
        return None
    if not isinstance(value, dict) or value.get('marker') != marker:
        return None
    rows = value.get('results')
    if not isinstance(rows, list) or len(rows) != len(expected):
        return None
    if any(not isinstance(row, dict) or not isinstance(row.get('id'), str)
           or not isinstance(row.get('ok'), bool) for row in rows):
        return None
    return rows if {row['id'] for row in rows} == expected else None


def grade(client, request):
    expected = set(request['candidateIds'])
    marker = uuid.uuid4().hex[:12]
    prompt = request['prompt'].replace('{"results":[...]}', '{"marker":"' + marker + '","results":[...]}', 1)
    prompt += '\nInclude the marker exactly and one verdict for every input ID, including rejected items.'
    opened = client.call_json('session.start', body={
        'method': '/api/session/start',
        'params': {'origin': 'fresh', 'lifecycle': 'persistent', 'title': 'Langoo M11.5 Quiz QA'},
    }, timeout=20)
    scope = {'session_id': new_session(opened)}
    client.generation_status = None
    client.generation_stream = client._open('chat.stream', body={
        **scope, 'items': [{'type': 'text', 'text': prompt}],
        'node_id': str(uuid.uuid4()), 'capabilities': {},
    })
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        history = client.call_json('chat.history', body={**scope, 'limit': 10}, timeout=20)
        for event in history.get('chat_events', []):
            info = event.get('payload') or {}
            if event.get('event_name') != 'message.assistant' or not isinstance(info, dict):
                continue
            if info.get('reply_to_message_id') or event.get('reply_to_message_id'):
                continue
            text = info.get('display_text') or info.get('content') or event.get('text')
            if isinstance(text, str) and client.generation_status is not None:
                result = parse_reply(text, marker, expected)
                if result is not None:
                    return result
        time.sleep(2)
    raise TimeoutError('No complete Muse verdict')


def serve(workers):
    cookies = muse.load_cookies(str(COOKIE_FILE))
    worker = threading.local()
    output_lock = threading.Lock()
    connections = set()
    connections_lock = threading.Lock()

    def emit(result):
        with output_lock:
            print(json.dumps(result, ensure_ascii=False), flush=True)

    def handle(request):
        try:
            if getattr(worker, 'client', None) is None:
                worker.client = QuizGateway(cookies)
                with connections_lock:
                    connections.add(worker.client)
            verdicts = grade(worker.client, request)
            emit({'id': request['id'], 'ok': True, 'verdicts': verdicts})
        except Exception as exc:
            client = getattr(worker, 'client', None)
            if client:
                client.close()
                with connections_lock:
                    connections.discard(client)
                worker.client = None
            emit({'id': request['id'], 'ok': False, **safe_error(exc, 'native-grade')})

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            for line in sys.stdin:
                if line.strip():
                    pool.submit(handle, json.loads(line))
    finally:
        for client in connections:
            client.close()


if __name__ == '__main__':
    with ACCOUNT_LOCK.open() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        serve(int(sys.argv[1]))
