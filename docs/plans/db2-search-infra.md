# Kế hoạch DB2 — Hạ tầng tìm kiếm (pg_trgm + GIN trigram)

> Trạng thái: **đang triển khai** (chủ dự án chốt 2026-10-02). Thuộc lộ trình DB (DB1–DB5).
> Không đổi API/hành vi tìm kiếm — chỉ tăng tốc và chuẩn bị cho DB3 (gloss tiếng Việt tra không dấu).

## 1. Phạm vi

| Nhóm | Nội dung |
| --- | --- |
| A. Extension | `pg_trgm` (bắt buộc cho index), `unaccent` (cài sẵn, dùng ở DB3) — VPS PG16 có sẵn; CI `postgres:17` có đủ; **local embedded thiếu contrib → tự bỏ qua kèm NOTICE** |
| B. Index | GIN trigram: `core.lexeme(lemma)`, `core.lexeme(reading)`, `core.lexeme(romanization)`, `core.lexeme_form(form_text)` |
| C. Backend | Bỏ `coalesce(...)` thừa trong `dictionary-search.repository.ts` (3 điều kiện match/prefix/exact) để planner dùng được index — hành vi không đổi |
| D. Benchmark | `EXPLAIN ANALYZE` trước/sau trên **VPS** (dữ liệu thật 2,38M lexeme) với mẫu tiêu biểu |
| E. Docs | Regenerate `CSDL-THAM-CHIEU.md`; cập nhật CONTEXT §13 + PROGRESS + lộ trình DB |

## 2. Quyết định

- **D1** — Chưa dùng `unaccent()` trong index/query: giữ đúng semantics hiện tại (phân biệt dấu); DB3 mới xử lý tra không dấu khi có gloss VI.
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
