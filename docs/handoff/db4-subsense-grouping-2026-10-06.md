# M4.3 — Handoff nhóm nghĩa Wiktextract và bảo toàn sense

Ngày 2026-10-06. Nhánh DeepSeek `46ec612` đã tích hợp main; sửa M4.3 trong
`9a52b68`, runtime VPS `f700658` (cùng DB3-B2.1). CI/deploy/live checks đã pass.

## Contract hiện tại

`GET /v1/lexemes/:id/senses?view=grouped|flat`, mặc định `grouped`. Đây là thay đổi
cấu trúc danh sách; client chỉ duyệt `data` sẽ bỏ qua con. `view=flat` trả mọi sense.

- Gom sense liên tiếp theo ancestor EN chỉ khi view 039 xác nhận hierarchy
  Wiktextract hợp lệ theo 038 và definition thuộc nguồn/EN. JMdict, WordNet,
  custom/reviewed, machine/gapped, mixed-source/batch-mismatch đứng riêng.
- Card đầu nhóm vẫn là sense thật: ID/definition/gloss/badge/context giữ nguyên
  như detail. `group_heading` là câu ancestor riêng, không phải nghĩa của ID đầu.
- `sub_senses` là các card thật còn lại, giữ definition lá, kể cả chuỗi trên hai tầng.
  Con có `group_heading: null`, `sub_senses: []`. Flatten giữ đủ mọi ID và thứ tự.
- Detail `/v1/senses/:id` và `view=flat` có metadata nhóm null/rỗng.
- `next_cursor: null`; invalid view trả 400. Search giữ cursor v3/canonical face M4.2.

## FE cần làm

1. Dùng `group_heading` làm tiêu đề không chọn được, nếu khác nghĩa đầu.
2. Render sense đầu thật và nút “N nghĩa khác ▸”, N = `sub_senses.length`.
3. Mở nhóm để render từng con; chọn/thêm collection dùng đúng `sense_id` của card.
4. Badge/VI/gloss lấy từ từng card, không gán heading hoặc gloss VI đầu nhóm cho con.
5. Tổng sense = sum(1 + số con). Nếu chưa hỗ trợ UI con, gọi `view=flat`.

FE chưa sửa/deploy trong release backend này. Nhóm không có nghĩa các sense tương
đương hoặc phổ biến; chọn vài nghĩa thông dụng cần FE/ranking riêng.

## Số liệu đã kiểm chứng live

| Từ/ID | Tổng sense | Nhóm | Con |
| --- | ---: | ---: | ---: |
| dog/998637 | 23 | 14 | 9 |
| run/1764987 | 64 | 38 | 26 |
| draw/1009311 | 138 | 6 | 132 |
| apple/694408 | 20 | 8 | 12 |

12.703 lexeme/0,85% là số lịch sử DeepSeek, chưa audit lại dưới guard M4.3.
Trùng lexeme đa nguồn (`cat`/`CAT`) vẫn thuộc D0.3/D0.5.

## Kiểm tra và vận hành

354 unit / 207 E2E / 31 DB3 tests và lint/build CI pass; 46 live checks pass.
Migration 038/039 đã áp VPS. Backup code/dist/patch tại
`/opt/langoo/storage/db4/releases/m43-20261006`.
[Report](../reviews/m4-3-subsense-integration-2026-10-06.md),
[API đầy đủ](../api/dictionary.md). Rollback code giữ cột 039 tương thích 038.
