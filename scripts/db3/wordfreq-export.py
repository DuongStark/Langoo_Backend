#!/usr/bin/env python3
"""DB3 — xuất bảng xếp hạng tần suất `wordfreq` cho lemma của một ngôn ngữ.

Chạy trong venv có cài `wordfreq` (không cần LLM/API):

    python scripts/db3/wordfreq-export.py \
      --lang en --lemmas /tmp/en-lemmas.txt --out uploads/db3/wordfreq-en.tsv

Đầu vào `--lemmas`: mỗi dòng một lemma đã lowercase (xuất từ core.lexeme, ví dụ:
    psql "$DIRECT_URL" -tAc "SELECT DISTINCT lower(lemma) FROM core.lexeme WHERE language_id=1"
).
Đầu ra: TSV `rank\tlemma` (rank 1 = phổ biến nhất, sort theo lemma) + meta JSON
(version/license/sha256) để `scripts/db3/wordfreq.ts` dùng khi apply/rollback.
"""

import argparse
import hashlib
import json
import sys
from importlib.metadata import version as package_version


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--lang', required=True, help="mã wordfreq, ví dụ 'en'")
    parser.add_argument('--lemmas', required=True, help='file lemma mỗi dòng')
    parser.add_argument('--out', required=True, help='file TSV đầu ra')
    parser.add_argument('--meta', default=None, help='file meta JSON (mặc định <out>.meta.json)')
    args = parser.parse_args()

    from wordfreq import iter_wordlist

    with open(args.lemmas, encoding='utf8') as handle:
        lemmas = {line.strip().lower() for line in handle if line.strip()}

    ranks: dict[str, int] = {}
    for rank, word in enumerate(iter_wordlist(args.lang), start=1):
        if word in lemmas and word not in ranks:
            ranks[word] = rank

    rows = sorted(ranks.items(), key=lambda item: item[0])
    with open(args.out, 'w', encoding='utf8', newline='\n') as handle:
        for lemma, rank in rows:
            handle.write(f'{rank}\t{lemma}\n')

    digest = hashlib.sha256(open(args.out, 'rb').read()).hexdigest()
    meta = {
        'lang': args.lang,
        'wordfreqVersion': package_version('wordfreq'),
        'license': 'CC BY-SA 4.0',
        'sourceUrl': 'https://github.com/rspeer/wordfreq',
        'lemmasInput': len(lemmas),
        'matched': len(rows),
        'outputSha256': digest,
    }
    meta_path = args.meta or f'{args.out}.meta.json'
    with open(meta_path, 'w', encoding='utf8') as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write('\n')
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
