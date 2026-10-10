# Kế hoạch DB2 — Hạ tầng tìm kiếm (pg_trgm + GIN trigram)

> Trạng thái: **đã triển khai 2026-10-03 (chờ review)** — chủ dự án chốt 2026-10-02. Thuộc lộ trình DB (DB1–DB5).
> Tăng tốc tìm kiếm lemma/forms/reading/romanization theo API hiện tại. Chức năng tra gloss VI có/không dấu đã được chủ dự án bỏ khỏi phạm vi DB3 ngày 06/10/2026.

## 1. Phạm vi

| Nhóm | Nội dung |
| --- | --- |
| A. Extension | `pg_trgm` (bắt buộc cho index), `unaccent` (đã cài sẵn; chức năng tra gloss VI đã bỏ khỏi phạm vi DB3) — VPS PG16 có sẵn; CI `postgres:17` có đủ; **local embedded thiếu contrib → tự bỏ qua kèm NOTICE** |
| B. Index | GIN trigram: `core.lexeme(lemma)`, `core.lexeme(reading)`, `core.lexeme(romanization)`, `core.lexeme_form(form_text)` |
| C. Backend | Bỏ `coalesce(...)` thừa trong `dictionary-search.repository.ts` (3 điều kiện match/prefix/exact) để planner dùng được index — hành vi không đổi |
| D. Benchmark | `EXPLAIN ANALYZE` trước/sau trên **VPS** (dữ liệu thật 2,38M lexeme) với mẫu tiêu biểu |
| E. Docs | Regenerate `CSDL-THAM-CHIEU.md`; cập nhật CONTEXT §13 + PROGRESS + lộ trình DB |

## 2. Quyết định

- **D1** — Chưa dùng `unaccent()` trong index/query: giữ đúng semantics hiện tại (phân biệt dấu). Ngày 06/10/2026, chủ dự án bỏ chức năng tra gloss VI có/không dấu khỏi phạm vi DB3.
- **D2** — Migration có **guard**: local embedded thiếu file contrib → bỏ qua extension/index, ghi `NOTICE`; VPS + CI tạo đủ. Ghi rõ khác biệt này trong CONTEXT.
- **D3** — Không dùng `CREATE INDEX CONCURRENTLY` (runner chạy trong 1 transaction; DB VPS không có writer lúc migrate).
- **D4** — Bỏ `coalesce` là refactor tương đương hành vi (NULL vẫn không khớp; pattern luôn khác rỗng) — e2e dictionary phủ.
- **D5** — Không áp cloud Prisma demo (không chắc hỗ trợ extension; DB thật là VPS).

## 3. Các bước

1. Migration `033_search_extensions_indexes.sql` + sửa repository + plan này.
2. `db:test:reset` + unit/e2e local (guard skip có NOTICE — vẫn phải xanh).
3. VPS: benchmark trước → `db:migrate` → benchmark sau.
4. Local full: áp 033 (skip có NOTICE) + regenerate `CSDL-THAM-CHIEU.md`.
5. Cập nhật PROGRESS/CONTEXT + commit.

## 4. Tiêu chí nghiệm thu

- [ ] VPS có `pg_trgm` + `unaccent` và 4 index trigram; `schema_migration` có `033_search_extensions_indexes.sql`
- [ ] Benchmark trên VPS: pattern ≥2 ký tự nhanh hơn rõ rệt so với trước (số cụ thể ghi vào PROGRESS/plan)
- [ ] Unit + e2e local xanh; CI xanh; kết quả search **không đổi**
- [ ] Local/test vẫn chạy bình thường (thiếu contrib → skip có NOTICE, không lỗi)

## 5. Rủi ro & xử lý

- GIN trigram làm ghi chậm đi — `lexeme`/`lexeme_form` gần như chỉ-đọc (import lô), chấp nhận.
- Dung lượng index thêm ~300–700MB trên VPS (còn ~13GB) — theo dõi sau khi tạo.
- Pattern quá ngắn (<3 ký tự) có thể vẫn quét rộng — đo thực tế, nếu cần sẽ bổ sung index phụ hoặc xử lý ở tầng service sau.

## 6. Kết quả triển khai & benchmark (2026-10-02/03)

**Đã áp:**
- **VPS**: 033 (`pg_trgm` + `unaccent` + 4 GIN trigram) và 035 (`core.bigrams` + 4 GIN bigram). 035 gặp lỗi quyền `must be owner of function bigrams` (hàm/index tạo bằng `postgres` lúc thử nghiệm) → chuyển quyền function + index probe sang `langoo` rồi migrate lại.
- **Cloud Prisma**: chỉ áp **035** (hàm + 4 index bigram — code mới cần hàm); 031–033 để nguyên vì là DB demo.
- **Local full + test**: áp 035 (bigram chạy cả trên PG nhúng không cần contrib); 033 tự guard-skip → CSDL doc local **không** có 4 index trigram (VPS/CI có đủ).
- CI xanh `b6e2d50`, `35b183b`; e2e dictionary/sense-card/health local 25/25 pass; auto-deploy VPS + smoke API live OK (`走る` trả kết quả đúng).

**Benchmark trên VPS** (dữ liệu thật 2,38M lexeme; query đúng như repository):

| Pattern | Trước (OR 3 cột) | Sau (UNION + index) | Ghi chú |
| --- | --- | --- | --- |
| `走る` (2 ký tự) | 7.717 ms | **111 ms** | bigram GIN |
| `はし` (2 ký tự) | 7.433 ms | **110 ms** | bigram GIN |
| `たべる` (3 ký tự) | 7.728 ms | **97 ms** | trigram + bigram |
| `run` (3 ký tự Latin) | 8.125 ms | **200 ms** | trigram + bigram |
| `る` (1 ký tự) | 9.414 ms | 7.319 ms | ⚠️ không index nào dùng được cho 1 ký tự — chấp nhận (khớp quá nhiều) |

Dung lượng thêm trên VPS: trigram ~137MB + bigram ~66MB; DB 6,13GB → 6,31GB.

**Việc phát sinh:**
- Migration **034** đã bị workstream M7/M8 (session answer receipt) dùng → DB2 đánh số **035** để không đụng nhau.
- `CSDL-THAM-CHIEU.md` **hoãn commit** lần này: bản regen local chứa cả bảng của 034 (chưa vào repo); sẽ regenerate khi M7/M8 land (lúc đó doc gồm cả 034 + 035 + bigram/trigram theo môi trường).
- Bài học vận hành: chạy `db:migrate` **không pipe qua `tail`** — pipeline che mất exit code/lỗi (suýt bỏ sót lỗi quyền owner của 035).
