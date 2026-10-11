"""M10.5-v2 alignment (B2-style): ghép gloss VI theo sense cho từ curation mới.

- Input: curated-v3.jsonl (selections), new-senses-v3.csv.gz (defs), viwikt.jsonl.gz (candidates).
- Match (batch 10) -> verify (batch 20) -> lọc rác/form/crossref.
- Checkpoint: align-v3-*.jsonl, chạy lại tự bỏ qua sense đã xử lý.
"""
import csv
import gzip
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

KEY = [
    l.split('=', 1)[1].strip()
    for l in open('/home/duongstark/.config/langoo/zen.env').read().splitlines()
    if l.startswith('DB4_PROVIDER_API_KEY=')
][0]
GO_RESP = 'https://opencode.ai/zen/go/v1/responses'
GO = 'https://opencode.ai/zen/go/v1/chat/completions'
SESSION = 'm105-v2-align'

SYS_MATCH = (
    'Bạn ghép định nghĩa tiếng Anh của một sense với định nghĩa tiếng Việt tương ứng của cùng từ. '
    'Với mỗi sense: đọc EN và danh sách VI candidates, chọn CHÍNH XÁC MỘT index (1-based) khớp nghĩa '
    'nhất, hoặc null nếu không có nghĩa nào khớp. Chỉ trả về JSON: '
    '{"results":[{"id":"<id>","choice":<index|null>}]}'
)
SYS_VERIFY = (
    'Bạn kiểm tra cặp (định nghĩa EN, định nghĩa VI) của cùng một từ tiếng Anh. '
    'Với mỗi cặp: trả lời true nếu định nghĩa VI mô tả ĐÚNG nghĩa của định nghĩa EN, '
    'false nếu sai/khác nghĩa. Chỉ trả về JSON: {"results":[{"id":"<id>","ok":<true|false>}]}'
)


def extract_json(content):
    t = (content or '').strip().strip('`')
    t = re.sub(r'^json\n', '', t)
    a, b = t.find('{'), t.rfind('}')
    if a < 0 or b <= a:
        raise ValueError('no json')
    return json.loads(t[a : b + 1])


def call_muse(sysmsg, payload, maxtok=4000):
    r = requests.post(
        GO_RESP,
        headers={
            'Authorization': f'Bearer {KEY}',
            'Content-Type': 'application/json',
            'x-opencode-session': SESSION,
        },
        json={
            'model': 'muse-spark-1.3-contributor',
            'instructions': sysmsg,
            'input': json.dumps(payload, ensure_ascii=False),
            'reasoning': {'effort': 'minimal'},
            'max_output_tokens': maxtok,
        },
        timeout=240,
    )
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}: {r.text[:120]}')
    d = r.json()
    if d.get('status') != 'completed':
        raise RuntimeError(f"status {d.get('status')}")
    text = ''.join(
        c.get('text', '')
        for o in (d.get('output') or [])
        if o.get('type') == 'message'
        for c in (o.get('content') or [])
        if c.get('type') == 'output_text'
    )
    return extract_json(text)


def call_longcat(sysmsg, payload, maxtok=4000):
    r = requests.post(
        GO,
        headers={
            'Authorization': f'Bearer {KEY}',
            'Content-Type': 'application/json',
            'x-opencode-session': SESSION,
        },
        json={
            'model': 'longcat-2.5-preview-free',
            'max_tokens': maxtok,
            'temperature': 0,
            'response_format': {'type': 'json_object'},
            'messages': [
                {'role': 'system', 'content': sysmsg},
                {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)},
            ],
        },
        timeout=240,
    )
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}: {r.text[:120]}')
    return extract_json(r.json()['choices'][0]['message'].get('content'))


def robust(sysmsg, payload, desc):
    last = ''
    for attempt in range(3):
        try:
            return call_muse(sysmsg, payload)
        except Exception as e:
            last = f'muse: {e}'
            time.sleep(1.5 * (attempt + 1))
    for attempt in range(2):
        try:
            return call_longcat(sysmsg, payload)
        except Exception as e:
            last = f'longcat: {e}'
            time.sleep(2)
    raise RuntimeError(f'{desc} | {last}')


def bases(w):
    yield w
    if w.endswith('ies') and len(w) > 4:
        yield w[:-3] + 'y'
    if w.endswith('es') and len(w) > 3:
        yield w[:-2]
    if w.endswith('s') and len(w) > 3:
        yield w[:-1]
    if w.endswith('ing') and len(w) > 5:
        yield w[:-3]
        yield w[:-3] + 'e'
    if w.endswith('ed') and len(w) > 4:
        yield w[:-2]
        yield w[:-1]
    if w.endswith('er') and len(w) > 4:
        yield w[:-2]
    if w.endswith('est') and len(w) > 5:
        yield w[:-3]


EN_WORDS = {
    'the', 'of', 'and', 'or', 'to', 'in', 'a', 'an', 'is', 'are', 'was', 'were', 'be',
    'been', 'noun', 'verb', 'adjective', 'adverb', 'plural', 'singular', 'form',
}
VN_CHARS = set('ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ')
FORM_PATTERNS = {
    'plural': 'số nhiều',
    'simple past': 'quá khứ',
    'past participle': 'quá khứ',
    'present participle': 'phân từ hiện tại',
    'third-person': 'ngôi thứ ba',
    'comparative': 'so sánh hơn',
    'superlative': 'so sánh nhất',
}


def englishish(text):
    toks = re.findall(r"[A-Za-z']+", text or '')
    if not toks:
        return False
    low = [t.lower() for t in toks]
    has_vn = any(ch in VN_CHARS for ch in (text or '').lower())
    if not has_vn and sum(1 for t in low if t in EN_WORDS) >= 1:
        return True
    if not has_vn and len(low) >= 2 and sum(1 for t in low if re.search(r'(ed|ing|tion|ness)$', t)) >= 2:
        return True
    return False


def form_mismatch(def_en, text):
    de = (def_en or '').lower()
    wanted = None
    for k, v in FORM_PATTERNS.items():
        if de.startswith(k):
            wanted = v
            break
    if not wanted:
        return False
    t = (text or '').lower()
    present = [v for v in set(FORM_PATTERNS.values()) if v in t]
    return bool(present) and wanted not in present


def crossref(text):
    t = (text or '').strip()
    return bool(re.match(r'^[;,\s]*\(như\)', t)) or t.lower().startswith('xem ')


def main():
    os.makedirs('/tmp/opencode', exist_ok=True)
    # 1) curated
    curated = {}
    for line in open('/tmp/opencode/curated-v3.jsonl'):
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get('ok') and d.get('selections'):
            curated[d['lemma']] = d['selections']
    print('curated words có selections:', len(curated), flush=True)

    # 2) sense defs
    with gzip.open('/tmp/opencode/new-senses-v3.csv.gz', 'rt', encoding='utf8', newline='') as f:
        rows = list(csv.reader(f))
    cols = [
        'sense_id', 'lexeme_id', 'lemma', 'pos', 'source', 'source_version', 'sense_no',
        'definition', 'raw_definition', 'gloss_context', 'register', 'domain', 'tags',
        'topics', 'frequency_rank',
    ]
    sense_def = {}
    for r in rows:
        d = dict(zip(cols, r))
        sense_def[d['sense_id']] = {
            'sense_id': d['sense_id'],
            'lemma': d['lemma'],
            'pos': d['pos'],
            'def_en': d['definition'] or d['raw_definition'],
        }

    targets = []
    for lemma, sels in curated.items():
        for sid in sels:
            s = sense_def.get(sid)
            if s and s['def_en']:
                targets.append(s)
    seen_ids = set()
    uniq = []
    for t in targets:
        if t['sense_id'] in seen_ids:
            continue
        seen_ids.add(t['sense_id'])
        uniq.append(t)
    targets = uniq
    print('target senses:', len(targets), flush=True)

    needed = {t['lemma'] for t in targets}
    base_needed = set()
    for w in needed:
        for b in bases(w):
            base_needed.add(b)
    # 3) candidates từ viwikt
    cand = {}
    with gzip.open('/tmp/opencode/viwikt.jsonl.gz', 'rt', encoding='utf8') as f:
        for line in f:
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get('lang_code') != 'en':
                continue
            w = o.get('word', '').lower()
            if w not in base_needed:
                continue
            pos = o.get('pos')
            for s in o.get('senses', []):
                for g in (s.get('glosses') or []):
                    cand.setdefault(w, [])
                    item = {'pos': pos, 'text': g}
                    if item not in cand[w]:
                        cand[w].append(item)
    print('words có candidate:', sum(1 for w in needed if w in cand), '/', len(needed), flush=True)

    def cands_for(lemma):
        cs = cand.get(lemma) or []
        if not cs:
            for b in bases(lemma):
                if b in cand:
                    cs = cand[b]
                    break
        return cs[:12]

    jobs = []
    for t in targets:
        cs = cands_for(t['lemma'])
        if cs:
            jobs.append((t, cs))
    print('targets có candidates:', len(jobs), flush=True)

    # checkpoint
    match_path = '/tmp/opencode/align-v3-match.jsonl'
    done_match = {}
    if os.path.exists(match_path):
        for line in open(match_path):
            try:
                d = json.loads(line)
            except Exception:
                continue
            done_match[d['sense_id']] = d
    todo = [j for j in jobs if j[0]['sense_id'] not in done_match]
    print('cần match:', len(todo), '(đã có', len(done_match), ')', flush=True)

    lock = threading.Lock()

    def save_match(row):
        with lock:
            f = open(match_path, 'a')
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
            f.close()

    B = 10
    batches = [todo[i : i + B] for i in range(0, len(todo), B)]

    def match_batch(batch):
        payload = [
            {
                'id': t['sense_id'],
                'lemma': t['lemma'],
                'en': t['def_en'],
                'candidates': [{'index': i + 1, 'vi': c['text']} for i, c in enumerate(cs)],
            }
            for t, cs in batch
        ]
        try:
            out = robust(SYS_MATCH, payload, f'match {payload[0]["id"]}')
            got = {}
            for r in out.get('results') or []:
                c = r.get('choice')
                got[str(r.get('id'))] = c if isinstance(c, int) else None
        except Exception:
            got = {}
        for t, cs in batch:
            sid = t['sense_id']
            choice = got.get(sid)
            chosen = None
            if isinstance(choice, int) and 1 <= choice <= len(cs):
                chosen = cs[choice - 1]['text']
            save_match(
                {
                    'sense_id': sid,
                    'lemma': t['lemma'],
                    'pos': t['pos'],
                    'def_en': t['def_en'],
                    'choice': choice,
                    'chosen_vi': chosen,
                }
            )

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(match_batch, batches))
    print(f'match done in {time.time()-t0:.0f}s', flush=True)

    # 4) verify
    matched = {}
    for line in open(match_path):
        try:
            d = json.loads(line)
        except Exception:
            continue
        matched[d['sense_id']] = d
    verify_list = [d for d in matched.values() if d.get('chosen_vi')]
    verify_path = '/tmp/opencode/align-v3-verify.jsonl'
    done_v = {}
    if os.path.exists(verify_path):
        for line in open(verify_path):
            try:
                d = json.loads(line)
            except Exception:
                continue
            done_v[d['sense_id']] = d
    vtodo = [d for d in verify_list if d['sense_id'] not in done_v]
    print('cần verify:', len(vtodo), '(đã có', len(done_v), ')', flush=True)

    def save_verify(row):
        with lock:
            f = open(verify_path, 'a')
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
            f.close()

    VB = 20
    vbatches = [vtodo[i : i + VB] for i in range(0, len(vtodo), VB)]

    def verify_batch(batch):
        payload = [
            {'id': d['sense_id'], 'lem': d['lemma'], 'en': d['def_en'], 'vi': d['chosen_vi']}
            for d in batch
        ]
        try:
            out = robust(SYS_VERIFY, payload, f'verify {payload[0]["id"]}')
            got = {str(r.get('id')): bool(r.get('ok')) for r in out.get('results') or []}
        except Exception:
            got = {}
        for d in batch:
            v = got.get(d['sense_id'])
            save_verify({'sense_id': d['sense_id'], 'ok': v})

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(verify_batch, vbatches))
    print(f'verify done in {time.time()-t0:.0f}s', flush=True)

    # 5) filters + output
    verdict = {}
    for line in open(verify_path):
        try:
            d = json.loads(line)
        except Exception:
            continue
        verdict[d['sense_id']] = d['ok']
    stats = {'accepted': 0, 'reject_verify': 0, 'reject_englishish': 0, 'reject_form': 0,
             'reject_crossref': 0, 'reject_no_verify': 0, 'null': 0, 'no_candidate': len(targets) - len(jobs)}
    out_path = '/tmp/opencode/align-v3-results.jsonl'
    with open(out_path, 'w') as f:
        for t in targets:
            row = {**t, 'choice': None, 'chosen_vi': None, 'status': None}
            d = matched.get(t['sense_id'])
            if not d or not d.get('chosen_vi'):
                row['status'] = 'no_match'
                stats['null'] += 1
            else:
                row.update({k: d[k] for k in ('choice', 'chosen_vi')})
                v = verdict.get(t['sense_id'])
                text = d['chosen_vi']
                if v is False:
                    row['status'] = 'reject_verify'
                    stats['reject_verify'] += 1
                elif v is None:
                    row['status'] = 'reject_no_verify'
                    stats['reject_no_verify'] += 1
                elif englishish(text):
                    row['status'] = 'reject_englishish'
                    stats['reject_englishish'] += 1
                elif form_mismatch(t['def_en'], text):
                    row['status'] = 'reject_form'
                    stats['reject_form'] += 1
                elif crossref(text):
                    row['status'] = 'reject_crossref'
                    stats['reject_crossref'] += 1
                else:
                    row['status'] = 'accepted'
                    stats['accepted'] += 1
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    print('stats:', json.dumps(stats, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
