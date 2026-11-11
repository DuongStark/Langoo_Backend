# Pilot 1.000 JLPT — danh sách final (2026-11-11)

## Chốt scope

- **1.000 tổng** = **94 smoke + 906 main**
- **200 sense / level**: N1, N2, N3, N4, N5.
- 1 sense mới / lexeme; **1.000 sense unique**, **1.000 lexeme unique**.
- Không trùng 9.015 sense đã có ảnh.
- 94 smoke là **toàn bộ lexeme JLPT chưa từng có bất kỳ ảnh nào**.
- 906 main là sense JLPT mới, có thể cùng lexeme với ảnh cũ ở sense khác (đúng sense-level).

## Thứ tự chạy

1. `phase=smoke`: 94 ảnh.
2. `phase=main`: 906 ảnh.
3. Driver/checkpoint skip sense đã `db_bound`, nên chạy lại không sinh trùng.

## File

- `scripts/muse-native/prompts/pilot-1000-jlpt-final.json`
- `scripts/muse-native/prompts/pilot-1000-jlpt-final.csv`
- `scripts/muse-native/prompts/pilot-94-jlpt-no-image.json`
- `scripts/muse-native/prompts/pilot-94-jlpt-no-image.csv`

## Selection

- Production DB `core.sense` / `core.lexeme_level` / `core.deck_item`.
- Loại 9.015 sense đã có ảnh.
- POS: noun, verb, adjective, adverb.
- Có English gloss.
- Một sense mới / lexeme; sort `frequency_rank` nulls last, `sense_no`, `sense_id`.
- 94 smoke lấy từ deck JLPT, loại lexeme nếu **bất kỳ sense nào** đã có ảnh.
- 906 main lấy thêm để đủ 200/level, loại 94 lexeme smoke.

## Lưu ý

- Gloss là gloss DB/máy, chưa curated; smoke cần spot-check trước khi scale.
- 1.000 không phải “1.000 từ chưa từng có ảnh”; chỉ 94 smoke thỏa điều kiện đó. Main là 906 sense mới.
