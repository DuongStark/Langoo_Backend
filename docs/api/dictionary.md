# API: Dictionary (đọc)

Tra từ điển **công khai** (không bắt buộc đăng nhập). Riêng lịch sử tra từ và báo lỗi gloss
cần Bearer token. Tầng đọc dùng `serve.*`/`core.*` (chỉ đọc); ghi duy nhất `app.search_history`
và `app.gloss_report`.

> DB2 đã có trigram/bigram indexes; repository dùng 3 nhánh matching mặt chữ/reading/romaji
> với ILIKE kiểm chứng. Ký tự wildcard `% _ \` được escape.
> **M4.2 / DB4-D0.2 (06/10): code xong local, chưa deploy VPS.** Contract dưới đây
> cần migration **038_dictionary_source_projection.sql** trước khi deploy code mới.

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
- Xếp hạng: khớp chính xác → khớp đầu chuỗi → tần suất (`NULLS LAST`) → độ dài → các khóa ổn định của face.
- `limit` mặc định 20, tối đa 100. `q` 1–100 ký tự sau khi trim (`400 VALIDATION_FAILED` nếu rỗng).
- `cursor` là chuỗi opaque trả từ response trước; cursor chỉ dùng lại với cùng `q` và `lang`, sai thì `400 VALIDATION_FAILED`.
- M4.2 ưu tiên mặt chữ khớp truy vấn trực tiếp, sau đó lemma chính; romaji
  `hashiru` trả `走る`, còn tìm trực tiếp `奔る` vẫn trả biến thể đó.
- M4.2 giữ **một matching face mỗi lexeme_id trước cursor/LIMIT+1**. Khác ID/nguồn/POS/reading vẫn giữ riêng cho tới khi equivalence/membership được xác nhận; không ẩn nguồn phụ chỉ vì trùng spelling.
- Cursor M4.2 dùng **v3**; cursor v1/v2 cũ trả `400 VALIDATION_FAILED`, client bắt đầu lại trang đầu. Không giải mã/sửa cursor ở FE.
- Khi tìm tiếng Nhật, romaji được chuyển sang kana để tìm thêm. Ví dụ `q=hashiru&lang=ja` tìm được `走る` cả khi `core.lexeme.romanization` chưa có dữ liệu.

## GET /v1/lexemes/:id/senses

Sau khi search trả `lexeme_id`, gọi endpoint này để lấy các nghĩa thuộc đúng lexeme đó. Không dùng
`lexeme_id` trực tiếp làm `sense_id`, vì một lexeme có thể có nhiều nghĩa.

```bash
curl -s http://localhost:3000/v1/lexemes/5/senses
```

Response `{ data, next_cursor }` chứa các `SenseCard` theo `sense_no`. Ví dụ lexeme `eat` trả
`sense_id: "6"`; sau đó dùng ID này với `/v1/senses/6`.

Sau migration 038, list và detail dùng cùng projection từ `serve.sense_card`:

- `gloss_en_context: string[]` là field **additive**, đầy đủ EN gloss theo rank nguồn;
  Wiktextract giữ cả gloss cha/con, JMdict giữ các cách diễn đạt cùng nghĩa.
- Wiktextract English source-owned, cùng batch, rank liên tục, không machine/reviewed:
  `gloss_en` chọn gloss cuối của chuỗi nguồn; `definition` chỉ đổi projection khi
  đang rỗng hoặc bằng gloss đầu/cuối và language NULL/EN. Custom definition giữ nguyên.
- Reviewed EN gloss vẫn giữ precedence khi chuỗi không đủ điều kiện projection;
  JMdict không áp quy tắc leaf. Gloss VI và badge review không thay đổi.
- FE hiển thị nghĩa ngắn từ card, có thể mở context; translator/mapping cần dùng
  toàn bộ context + tags/restrictions, không chỉ một leaf. `/senses/:id` vẫn trả
  toàn bộ raw `glosses[]`, không xóa/rank lại gloss gốc.
- Không dùng gloss đầu của `glosses[]` làm nhãn chọn sense và không trình bày
  từng gloss cha/con thành các sense độc lập. Với `dog`, các sense chó nhà,
  thành viên họ Canidae và con đực có cùng gloss cha nhưng nghĩa cụ thể khác nhau.
  Deploy BE cần kèm đối chiếu FE dùng card cho nghĩa chính và context riêng;
  raw `glosses[]` vẫn chứa gloss cha sau migration/backfill.

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
    {
      "sense_id": "2",
      "language_id": 1,
      "lemma": "run",
      "reading": null,
      "romanization": null,
      "confidence": 1,
      "concept_id": "1"
    }
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
`target_id` được trim trước khi lưu; giá trị rỗng hoặc chỉ có khoảng trắng trả `400 VALIDATION_FAILED`.
Response `201`:

```json
{
  "id": "12",
  "target_kind": "sense_gloss",
  "target_id": "2",
  "language_id": 3,
  "issue": "wrong",
  "comment": "Nghĩa chưa đúng ngữ cảnh",
  "status": "open",
  "created_at": "2026-09-27T00:00:00.000Z"
}
```

Swagger UI: `http://localhost:3000/docs` (nhóm **dictionary**, **senses**, **kanji**).


## M4.3 — Nhóm nghĩa Wiktextract và bảo toàn sense (2026-10-06)

`GET /v1/lexemes/:id/senses?view=grouped|flat`, mặc định `grouped`.
`view` khác hai giá trị trên trả 400. Response envelope/`next_cursor: null` giữ nguyên.

- `grouped`: gom các sense liên tiếp có cùng ancestor EN **và được DB xác nhận
  hierarchy Wiktextract hợp lệ** (nguồn/batch/rank/review/machine/definition theo 038/039).
  JMdict, WordNet, context không xác nhận, definition custom/khác ngôn ngữ đứng riêng.
- `data[i]` vẫn là sense thật đầu nhóm. `definition`, `gloss_en`, badge, ID không đổi
  so với detail. `group_heading` là ancestor riêng cho trình bày (có thể null).
  `sub_senses` chứa các sense thật còn lại, mỗi card giữ nguyên nghĩa lá, ID, context;
  con có `group_heading: null`, `sub_senses: []`.
- `flat`: mọi sense trả ở `data`, theo sense_no/ID như trước; metadata nhóm null/rỗng.
- Detail `/v1/senses/:id` trả card thật, metadata nhóm null/rỗng; không nhận query view.
- **Đây là thay đổi cấu trúc danh sách**, dù field mới additive: client chỉ duyệt `data`
  ở default sẽ không thấy con. FE cũ cần `view=flat` hoặc cập nhật render con.

FE: dùng `group_heading` làm heading không chọn được; hiện sense đầu + nút mở
`sub_senses.length` nghĩa khác. Chọn sense đầu/con đều phải dùng chính ID/card đó;
không gán nghĩa heading vào ID đầu nhóm, không lấy gloss VI của cha cho con.
Khi đếm toàn bộ: tổng `1 + sub_senses.length` mỗi nhóm. Khi mở nhóm, giữ thứ tự
sense_no/ID; không dùng nhóm để tuyên bố equivalent hoặc gộp dữ liệu nguồn.
Giữ nội dung nguồn/badge gloss máy. Chưa có triển khai FE trong release backend này.
