#!/usr/bin/env python3
"""M4.5: prepare a private, target-bound BCCWJ artifact; never writes the DB."""
import argparse
import csv
import hashlib
import io
import json
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path


def normalize(text):
    value = unicodedata.normalize('NFKC', text or '')
    return ''.join(chr(ord(c) - 0x60) if '\u30a1' <= c <= '\u30f6' else c for c in value)


def pos_family(pos):
    head = pos.split('-')[0]
    return {'動詞': 'verb', '名詞': 'noun', '形容詞': 'adjective',
            '形状詞': 'adjective', '連体詞': 'adjective', '副詞': 'adverb',
            '助詞': 'particle', '助動詞': 'auxiliary', '接続詞': 'conjunction',
            '感動詞': 'interjection', '接頭辞': 'prefix', '接尾辞': 'suffix'}.get(head)


def prepare(snapshot, rows, source_sha256):
    index = defaultdict(set)
    by_id = {item['id']: item for item in snapshot['lexemes']}
    for item in snapshot['lexemes']:
        attrs = item['attributes'] or {}
        # Only readings valid for this exported lexical face: avoids granting the
        # frequency of an alternative reading to another JMdict homograph.
        forms = {item['lemma'], item['reading'], *(v['text'] for v in attrs.get('kanji', []))}
        forms.discard(None)
        readings = [v for v in attrs.get('kana', []) if normalize(v['text']) == normalize(item['reading'])]
        if readings:
            allowed = {k for v in readings for k in v.get('appliesToKanji', ['*'])}
            if '*' not in allowed:
                forms = {f for f in forms if f in allowed or normalize(f) == normalize(item['reading'])}
        elif attrs.get('kana'):
            forms = {item['lemma']}
        for form in forms:
            index[(normalize(form), normalize(item['reading']), item['pos'])].add(item['id'])
    mapped = defaultdict(list)
    unmatched, ambiguous = [], []
    total = 0
    frequencies = dict(total=0,matched=0,ambiguous=0,unmatched=0)
    top1000 = dict(total=0,matched=0,ambiguous=0,unmatched=0)
    for row in rows:
        total += 1
        family = pos_family(row['pos'])
        key = (normalize(row['lemma']), normalize(row['lForm']), family)
        candidates = index.get(key, set()) if family else set()
        evidence = {'rank': int(row['rank']), 'frequency': int(row['frequency']),
                    'lemma': row['lemma'], 'reading': row['lForm'], 'pos': row['pos'],
                    'subLemma': row.get('subLemma', ''), 'wType': row.get('wType', '')}
        status = 'matched' if len(candidates)==1 else 'ambiguous' if candidates else 'unmatched'
        frequencies['total'] += evidence['frequency']
        frequencies[status] += evidence['frequency']
        if evidence['rank'] <= 1000:
            top1000['total'] += 1
            top1000[status] += 1
        if len(candidates) == 1:
            mapped[next(iter(candidates))].append(evidence)
        elif candidates:
            ambiguous.append({**evidence, 'candidate_keys': sorted(by_id[i]['external_id'] for i in candidates)})
        else:
            unmatched.append(evidence)
    lexemes = []
    for key, evidence in mapped.items():
        item = by_id[key]
        # Do not sum possibly overlapping UniDic sublemma identities. The most
        # frequent matched corpus entry supplies rank/count; all evidence remains.
        best = min(evidence, key=lambda row: row['rank'])
        lexemes.append({'lexeme_id': key, 'semantic_key': item['external_id'],
                        'input_hash': item['input_hash'], 'corpus_rank': best['rank'],
                        'corpus_count': best['frequency'], 'evidence': evidence})
    summary = {'corpus_rows': total, 'matched_lexemes': len(lexemes),
               'matched_corpus_rows': sum(map(len, mapped.values())),
               'ambiguous_corpus_rows': len(ambiguous), 'unmatched_corpus_rows': len(unmatched),
               'jmdict_lexemes': len(by_id), 'corpus_frequency_coverage': frequencies, 'top1000_corpus_rows':top1000}
    return {'schema_version': 1, 'policy': 'ja-bccwj-v1', 'target_identity': snapshot['target_identity'],
            'source_code': 'bccwj-suw', 'source_version': '1.0', 'source_sha256': source_sha256,
            'summary': summary, 'lexemes': sorted(lexemes, key=lambda row: int(row['lexeme_id'])),
            'senses': snapshot.get('sense_preferences', [])}, {'summary': summary, 'ambiguous': ambiguous, 'unmatched': unmatched}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--zip', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    raw = Path(args.zip).read_bytes()
    snapshot = json.loads(Path(args.snapshot).read_text())
    with zipfile.ZipFile(io.BytesIO(raw)) as zipped:
        names = [n for n in zipped.namelist() if n.endswith('.tsv')]
        if len(names) != 1:
            raise ValueError('Expected exactly one official TSV')
        with zipped.open(names[0]) as stream:
            rows = csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8-sig'), delimiter='\t')
            artifact, audit = prepare(snapshot, rows, hashlib.sha256(raw).hexdigest())
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, ensure_ascii=False, separators=(',', ':')))
    output.with_suffix('.audit.json').write_text(json.dumps(audit, ensure_ascii=False, separators=(',', ':')))
    print(json.dumps({'summary': artifact['summary'], 'artifact_sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
