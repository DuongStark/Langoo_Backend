# Ẩn ví dụ EN "rác" theo danh sách md5 đã chấm (13/10/2026)

> Trạng thái: **CODE XONG — CHỜ APPLY OPS TRÊN VPS** (phiên cha chạy
> `db/ops/apply-en-junk-filter.sql`). Code an toàn khi bảng chưa tồn tại.
> Code: [`sense-content.repository.ts`](../../src/dictionary/repositories/sense-content.repository.ts)
> · SQL: [`db/ops/apply-en-junk-filter.sql`](../../db/ops/apply-en-junk-filter.sql)

## 1. Bối cảnh

- 106.611 câu ví dụ EN đã được model chấm keep/junk.
- 44.359 câu junk (quote văn học cổ, mảnh câu, không tự nhiên) xuất thành
  danh sách md5 hex của text UTF-8 (`/tmp/opencode/en-junk-hashes.txt`,
  44.359 dòng, không trùng, đã kiểm định dạng).
- Mục tiêu: endpoint sense detail (`getExamples`) không trả các ví dụ có
  `md5(text)` nằm trong danh sách. **Không xoá dữ liệu, không migration.**

## 2. Thiết kế

| Phần | Nội dung |
|---|---|
| Bảng lọc | `staging.junk_en_example_text(hash text PRIMARY KEY)` — ops tạo + COPY |
| Code | `getExamples` ghép `AND NOT EXISTS (SELECT 1 FROM staging.junk_en_example_text j WHERE j.hash = md5(e.text))` vào **cả 2 nhánh** candidates (direct + `example_sense`) trước `LIMIT` |
| Bảng vắng | Code kiểm tra `has_table_privilege(to_regclass('staging.junk_en_example_text'), 'SELECT')`; không đọc được/không tồn tại → bỏ điều kiện lọc, API chạy bình thường |
| Rollback | `DROP TABLE staging.junk_en_example_text;` — code tự ngừng lọc, không cần deploy lại |

Lưu ý kỹ thuật: **không thể** viết
`to_regclass(...) IS NULL OR NOT EXISTS (... FROM staging....)` trong cùng một
câu SQL — PostgreSQL phân tích cú pháp/quan hệ trước khi thực thi nên vẫn báo
lỗi `42P01` khi bảng vắng. Vì vậy code kiểm tra bằng một truy vấn riêng rồi
ghép SQL có điều kiện (`Prisma.sql` + `Prisma.empty`).

## 3. Kiểm chứng trên DB đủ dữ liệu (local `langoo`, 3.512.695 example)

| Chỉ số | Kết quả |
|---|---|
| Hash nạp | 44.359 |
| Ví dụ EN khớp danh sách junk | **68.623 row** (44.359 text, trùng lặp row) |
| Ví dụ ngôn ngữ khác khớp text | 2 row VI (`.` và `The` — cũng là rác) |

→ Sau apply, ~68,6k row ví dụ EN không còn hiển thị; filter theo `md5(e.text)`
nên áp cho mọi row trùng text (kể cả row không gắn sense trực tiếp nhưng được
link qua `core.example_sense`).

## 4. Test

- Unit `sense-content.repository.spec.ts` (4 test): bảng có → ghép `NOT EXISTS`
  vào 2 nhánh; bảng vắng → query chính không tham chiếu bảng (không 42P01);
  thiếu quyền SELECT → bỏ lọc; kiểm tra `to_regclass` + `has_table_privilege`.
- E2E `dictionary.e2e-spec.ts` — describe mới tự tạo/dọn bảng: chèn md5(text)
  của sense 4 → ví dụ biến mất; sense 6 (câu thường) không đổi; DROP bảng →
  API vẫn chạy và ví dụ trở lại.
- Heuristic cũ (`[`, `...`, `…` EN) giữ nguyên.

## 5. Apply trên VPS (phiên cha)

```bash
scp /tmp/opencode/en-junk-hashes.txt \
  langoo@<vps>:/opt/langoo/storage/dictionary/en-junk-hashes-2026-10-13.txt
sudo -u postgres psql -d langoo -v ON_ERROR_STOP=1 \
  -f /opt/langoo/app/db/ops/apply-en-junk-filter.sql
# Nếu postgres không đọc được file dưới /opt (bài học 2026-10-08):
#   cp .../en-junk-hashes-2026-10-13.txt /tmp/
#   thêm -v hash_file=/tmp/en-junk-hashes-2026-10-13.txt
```

File ops: kiểm `server_encoding=UTF8`, `TRUNCATE` + `COPY` (idempotent), validate
định dạng md5, `ANALYZE`, `GRANT USAGE schema staging + SELECT` cho role `langoo`,
in số hash và số example EN khớp. Rollback: `DROP TABLE staging.junk_en_example_text;`.

## 6. Hạn chế / rủi ro

- Điều kiện thêm 1 lượt `md5(text)` mỗi row candidate + lookup PK bảng 44k —
  không đáng kể (mỗi sense vài ví dụ, index hash equality).
- Thêm 1 round-trip nhỏ (`has_table_privilege`+`to_regclass`) mỗi lần gọi
  `getExamples`; có thể cache sau nếu cần.
- Danh sách là ảnh chụp tại 13/10/2026; câu junk mới cần nạp lại (TRUNCATE+COPY).
- Endpoint khác dùng `core.example`: `quiz-source.repository.ts` chỉ lấy ví dụ
  JA (`lg.code='ja'`); `sources.repository.ts` chỉ count → không cần áp filter.
  Reverse lookup và sense card không trả example.
