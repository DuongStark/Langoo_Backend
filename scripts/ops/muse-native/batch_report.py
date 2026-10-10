#!/usr/bin/env python3
"""M10.5: bind GPT semantic annotations to frozen native output and render report."""
import argparse
import collections
import html
import json
import math
import statistics
from pathlib import Path
from batch_core import digest


def build(source, output, annotations, stats):
    if annotations['snapshot_sha256'] != digest(source) or annotations['output_sha256'] != digest(output) or output['snapshot_sha256'] != digest(source):
        raise ValueError('Review/source/output drift')
    records = {r['lemma']: r for r in source['records']}
    decisions = {r['lemma']: r for r in output['items']}
    notes = annotations['items']
    if set(decisions) != set(records) or len(output['items']) != len(records) or len(notes) != len(records) or len({r['lemma'] for r in notes}) != len(records):
        raise ValueError('Incomplete review/output')
    for note in notes:
        if note['lemma'] not in records or note['verdict'] not in ('pass', 'minor', 'severe') or type(note['primary_ok']) is not bool:
            raise ValueError('Invalid review')
        if not isinstance(note['primary_vi'], str) or not note['primary_vi'].strip() or not isinstance(note['note'], str):
            raise ValueError('Missing annotation text')
        allowed = {s['senseId'] for s in records[note['lemma']]['senses']}
        ids = note.get('suggested_ids', [])
        if not isinstance(ids, list) or len(ids) > 3 or len(set(ids)) != len(ids) or any(i not in allowed for i in ids):
            raise ValueError('Foreign suggested ID')
    counts = collections.Counter(n['verdict'] for n in notes)
    latency = sorted(stats['latencies_ms'])
    wall_ms = stats.get('cumulative_active_ms', stats['wall_ms'])
    summary = {'task': 'M10.5', 'reviewer': 'GPT agent; not independent human/corpus gold',
               'words': len(records), 'pass': counts['pass'], 'minor': counts['minor'], 'severe': counts['severe'],
               'primary_ok': sum(n['primary_ok'] for n in notes),
               'gate_pass': counts['pass'] >= .9 * len(records) and not counts['severe'] and bool(output['complete']),
               'wall_ms': wall_ms, 'workers': stats['workers'], 'dispatches': stats['dispatches'],
               'words_per_minute': round(60000 * len(records) / wall_ms, 2),
               'median_latency_ms': statistics.median(latency),
               'p95_latency_ms': latency[max(0, math.ceil(.95 * len(latency)) - 1)],
               'peak_rss_mib': round(stats.get('cumulative_peak_rss_kib', stats['peak_rss_kib']) / 1024, 2),
               'snapshot_sha256': digest(source), 'output_sha256': digest(output)}
    rows = []
    e = lambda value: html.escape(str(value))
    for note in notes:
        lemma = note['lemma']
        index = {s['senseId']: s for s in records[lemma]['senses']}
        picks = decisions[lemma]['selections']
        selected = ''.join('<li><code>' + e(p['id']) + '</code> ' + e(index[p['id']]['pos']) + ': ' +
                           e(index[p['id']]['definition']) + '</li>' for p in picks)
        fixes = '<p>Đề xuất ID: ' + e(', '.join(note.get('suggested_ids', []))) + '</p>' if note.get('suggested_ids') else ''
        rows.append('<tr><td><b>' + e(lemma) + '</b><br>' + e(note['primary_vi']) + '</td><td class="' + note['verdict'] + '">' +
                    e(note['verdict']) + '</td><td><ol>' + selected + '</ol><p>Lý do Muse: ' + e(decisions[lemma]['reason']) +
                    '</p></td><td>' + e(note['note']) + fixes + '</td></tr>')
    rendered = '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + \
        '<title>M10.5 — Chấm 50 từ / 3 worker native</title><style>body{font:16px system-ui;margin:24px;color:#172033;background:#f5f7fa}table{border-collapse:collapse;width:100%;background:white}th,td{padding:12px;border:1px solid #dce2ea;text-align:left;vertical-align:top}th{background:#e9eef5}ol{padding-left:20px;margin:0}li{margin-bottom:10px}code{font-size:12px}.pass{color:#176c3b}.minor{color:#865200}.severe{color:#b21e28}.wrap{overflow:auto}td:first-child{min-width:120px}td:nth-child(3){min-width:300px}td:last-child{min-width:220px}p{font-size:14px}</style><h1>M10.5 — 50 từ, 3 worker native</h1>' + \
        '<p>' + e(f"{summary['pass']} pass / {summary['minor']} minor / {summary['severe']} severe; nghĩa đầu phù hợp {summary['primary_ok']}/{summary['words']}; {summary['wall_ms']/1000:.1f}s active execution") + \
        '</p><p>GPT chấm độ phù hợp cho người học; không phải số đo tần suất corpus. Output Muse giữ nguyên, đề xuất sửa riêng; chưa apply DB.</p><div class="wrap"><table><thead><tr><th>Từ / nghĩa đầu (GPT diễn giải)</th><th>Chấm</th><th>ID và định nghĩa nguồn do Muse chọn</th><th>Nhận xét GPT</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table></div></html>'
    return summary, rendered


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('directory', type=Path)
    directory = p.parse_args().directory
    load = lambda name: json.loads((directory / name).read_text())
    summary, rendered = build(load('input.json'), load('results.json'), load('semantic-review.json'), load('execution-stats.json'))
    (directory / 'review-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    (directory / 'review.html').write_text(rendered)
    print(json.dumps(summary, ensure_ascii=False))
