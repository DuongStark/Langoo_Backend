# scripts/db3 — Seed dữ liệu nền DB3-A (phiên song song DeepSeek)

> Kế hoạch: [`docs/plans/db3-a-foundation.md`](../../docs/plans/db3-a-foundation.md) · Kiểm kê: [`docs/reviews/db3-inventory-2026-10-05.md`](../../docs/reviews/db3-inventory-2026-10-05.md).

## Nguyên tắc an toàn

- **Dry-run mặc định** — không ghi DB khi thiếu `--apply`.
- `--apply` bắt buộc `--allow-db <tên-db>` khớp đúng tên DB đích; DB kết thúc `_test` cần thêm `--allow-test`.
- Mọi run ghi **manifest JSON** vào `uploads/db3/` (đã gitignore) để rollback.
- Rollback theo manifest: `--rollback <file.json>` (xoá đúng khoá đã ghi).
- Apply lên DB thật là **bước vận hành riêng của người tích hợp** (không tự chạy trong CI/phiên này).

## Chuẩn bị nguồn raw (ops — một lần)

Đặt vào `data-Langoo/downloads/extras/` (hoặc trỏ `--sources <dir>`):

| File | Nguồn | Ghi chú |
| --- | --- | --- |
| `CJKRadicals.txt` | unicode.org `Public/UCD/latest/ucd/CJKRadicals.txt` | Unicode License v3 |
| `vi-kangxi-radicals.wikitext` | vi.wikipedia "Bộ thủ Khang Hi" (API `action=parse`) | CC BY-SA — attribution |
| `unihan-kTotalStrokes.tsv` | `Unihan.zip → Unihan_IRGSources.txt`, lọc dòng `kTotalStrokes` | Unicode License v3 |
| `en-radicals-extracts.json` | en.wikipedia API `prop=extracts` cho 214 bài "Radical N" (batch 20, `exlimit=max`) | CC BY-SA — attribution |
| `kanjivg/` | KanjiVG (github.com/KanjiVG/kanjivg), `kanji/<codepoint>.svg` | CC BY-SA 3.0 |

Lệnh trích Unihan:
```bash
unzip -p Unihan.zip Unihan_IRGSources.txt | grep -P "^U\+[0-9A-F]+\tkTotalStrokes\t" > unihan-kTotalStrokes.tsv
```

## Chạy

```bash
# Node 22
nvm use

# Self-test parser (không cần DB)
npx tsx scripts/db3/selftest.ts

# Dry-run
npx tsx scripts/db3/radicals.ts --sources ../data-Langoo/downloads/extras
npx tsx scripts/db3/kanjivg.ts --sources ../data-Langoo/downloads/extras --version kanjivg-2025xxxx
npx tsx scripts/db3/decks.ts
npx tsx scripts/db3/verify-jlpt.ts
npx tsx scripts/db3/credits-audit.ts

# Thử ghi trên DB fixture của phiên (duy nhất được phép)
npx tsx scripts/db3/radicals.ts --sources /tmp/opencode/db3raw --apply --allow-db langoo_parallel_deepseek_test --allow-test
npx tsx scripts/db3/kanjivg.ts --sources /tmp/opencode/db3raw --apply --allow-db langoo_parallel_deepseek_test --allow-test --version test
npx tsx scripts/db3/decks.ts --apply --allow-db langoo_parallel_deepseek_test --allow-test --limit 5

# Rollback theo manifest
npx tsx scripts/db3/radicals.ts --rollback uploads/db3/<file>.json
npx tsx scripts/db3/kanjivg.ts --rollback uploads/db3/<file>.json
npx tsx scripts/db3/decks.ts --rollback uploads/db3/<file>.json
```

## Ghi chú thiết kế

- `public.radical` **không có cột provenance** → rollback dựa manifest theo `number`; attribution ghi ở `public.source` (`kangxi-radicals`).
- `kanji_media` khoá `(kanji_literal, kind)`; `media_asset` khoá `object_key` (`kanjivg/<hex>.svg`). Chỉ seed kanji có trong `core.kanji`; file thiếu kanji → báo cáo, không tự chế.
- **API phục vụ ảnh (serving media) không thuộc DB3-A** — gộp vào M14 (cùng API danh sách user).
- Decks: 1 lexeme chỉ vào cấp JLPT thấp nhất; anchor = sense `is_primary`; `is_published=false`; `concept_id` NULL (DB4 nối).
- `decks.ts` trên DB fixture demo (không có `jlpt_link`) sẽ báo "không có dữ liệu" — dùng `--limit` khi test sau khi đã có dữ liệu JLPT.
