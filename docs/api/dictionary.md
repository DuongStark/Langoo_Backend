# API: Dictionary (đọc)

Tra từ điển **công khai** (không bắt buộc đăng nhập). Riêng lịch sử tra từ và báo lỗi gloss
cần Bearer token. Tầng đọc dùng `serve.*`/`core.*` (chỉ đọc); ghi duy nhất `app.search_history`
và `app.gloss_report`.

> Lưu ý tìm kiếm: hiện dùng `ILIKE` (khớp chuỗi con) trên `surface`/`reading` — **chưa** có
> `pg_trgm`/`unaccent` (production sẽ bổ sung, xem CONTEXT §13). Ký tự wildcard `% _ \` được escape.

## GET /v1/dictionary/search?q=&lang=&limit=

```bash
curl -s "http://localhost:3000/v1/dictionary/search?q=走る"
curl -s "http://localhost:3000/v1/dictionary/search?q=run&lang=en&limit=10"
# có token → tự ghi search_history
curl -s "http://localhost:3000/v1/dictionary/search?q=run" -H "Authorization: Bearer <token>"
```

```json
{
  "data": [
    {
      "lexeme_id": "2",
      "language_id": 1,
      "lang_code": "en",
      "surface": "run",
      "reading": null,
      "pos": "verb",
      "frequency_rank": 110,
      "homograph_no": 1,
      "surface_kind": "lemma",
      "is_exact": true
    }
  ],
  "next_cursor": null
}
```

- `lang` ∈ `en|ja|vi|zh-Hans` (kiểm tra tồn tại trong `public.language` → sai thì `400 LANGUAGE_NOT_FOUND`).
- Xếp hạng: khớp chính xác → khớp đầu chuỗi → tần suất (`NULLS LAST`) → độ dài.
- `limit` mặc định 20, tối đa 50. `q` 1–100 ký tự (`400 VALIDATION_FAILED` nếu sai).

## GET /v1/senses/:id

```bash
curl -s http://localhost:3000/v1/senses/1
```

Trả `{ card, glosses[], examples[], pronunciations[], forms[] }`:

- `card` — từ `serve.sense_card`; `gloss_vi_machine`/`gloss_vi_reviewed` là cờ **badge chưa kiểm duyệt**.
- `glosses` — mọi gloss của sense (đa ngôn ngữ, có `is_machine/reviewed/quality/rank`).
- `examples` — ví dụ gắn `core.example.sense_id` + `translation` (jsonb `{en, vi, ...}`), tối đa 5.
- `pronunciations`/`forms` — theo **lexeme** của sense (IPA/audio, kanji/kana forms).

Lỗi: `404 SENSE_NOT_FOUND`.

## GET /v1/senses/:id/links

Cặp sense ngôn ngữ khác cùng concept — nguồn cho gợi ý "thêm cả りんご?".

```bash
curl -s http://localhost:3000/v1/senses/1/links
```

```json
{
  "data": [
    { "sense_id": "2", "language_id": 1, "lemma": "run", "reading": null,
      "romanization": null, "confidence": 1, "concept_id": "1" }
  ],
  "next_cursor": null
}
```

Chỉ trả cặp đã qua **cổng curated** (`serve.sense_pair`: concept `curated`, confidence ≥ 0.7).
Khi chưa curate, `data` rỗng — đúng thiết kế.

## GET /v1/kanji/:literal

```bash
curl -s http://localhost:3000/v1/kanji/走
```

Trả số nét, cấp (grade/JLPT cũ-mới), bộ thủ (`radical` — `name_vi/meaning_vi` sẽ có sau khi seed
`public.radical`), `readings/meanings/nanori/query_codes` (jsonb), `used_in_forms`, `media_kinds`.
Lỗi: `404 KANJI_NOT_FOUND`.

## GET /v1/me/search-history (Bearer)

```bash
curl -s http://localhost:3000/v1/me/search-history -H "Authorization: Bearer <token>"
```

50 lần tra gần nhất: `{ id, raw_query, normalized, language_id, matched_sense_id, result_count, created_at }`.
Chỉ ghi khi search có Bearer hợp lệ; token bẩn → `401 AUTH_TOKEN_INVALID` (không âm thầm coi là khách).

## POST /v1/gloss-reports (Bearer)

```bash
curl -s -X POST http://localhost:3000/v1/gloss-reports \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"target_kind":"sense_gloss","target_id":"2","language_id":3,"issue":"wrong","comment":"Nghĩa chưa đúng ngữ cảnh"}'
```

`target_kind` ∈ `sense_gloss|concept_gloss|example|translation`; `issue` ∈ `wrong|missing|offensive|other`.
Response `201`:

```json
{ "id": "12", "target_kind": "sense_gloss", "target_id": "2", "language_id": 3,
  "issue": "wrong", "comment": "Nghĩa chưa đúng ngữ cảnh", "status": "open",
  "created_at": "2026-09-27T00:00:00.000Z" }
```

Swagger UI: `http://localhost:3000/docs` (nhóm **dictionary**, **senses**, **kanji**).
