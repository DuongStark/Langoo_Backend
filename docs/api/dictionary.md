# API: Dictionary (đọc)

## M4.9 — Japanese Deinflection ở Search & Suggestions (19/11/2026; cập nhật 20/11/2026)

- Khi gọi `GET /v1/dictionary/search` (trang đầu `cursor = null`) hoặc `GET /v1/dictionary/suggestions` với ngôn ngữ cho phép tiếng Nhật và **chưa có hit `is_exact = true` đáng tin cậy** (JMdict hoặc đã có nghĩa tiếng Việt), BE tự sinh tối đa 8 dạng gốc ứng viên (bỏ `する`/`な`, `く→い`, thể `て`/`た`/`ます`/`ない`/`ている`/bị động/điều kiện/ý chí/`です`, bất quy tắc `する`/`来る`, cụm `してくれ`), tra **1 câu SQL duy nhất**, chấm điểm theo từng `tier` ứng viên và đẩy kết quả dạng gốc lên đầu `data[]` kèm trường **`deinflected_from: string | null`**.
- Các hit khớp trực tiếp luôn có `deinflected_from: null`; khớp chính xác từ JMdict hoặc đã có nghĩa VI luôn thắng (`優れる`, `見せる`, `みんな`, `板`, `きれい`, `する` không bị cắt đuôi). Riêng trường hợp hit `is_exact` duy nhất chỉ là mục phụ non-JMdict chưa có nghĩa VI (vd mục Wiktionary `読みます`), BE tự deinflect sang dạng gốc JMdict (`読む`) ở đầu danh sách để FE không cần fallback phía client.
- 21/11/2026: mục JA nguồn `wiktextract` có gloss VI nhưng definition tự ghi là dạng chia của một ứng viên deinflect (vd `"polite form of 読む"`, `"past tense … of 行く"`) không còn chặn deinflect: dạng gốc JMdict đứng #1 kèm `deinflected_from`, mục Wiktionary vẫn có trong `data[]`. Input chỉ gồm katakana chỉ được bóc `スル` (`オウボスル` → `おうぼ`), không áp các quy tắc chia khác. Import M5.3 áp dụng cùng quy tắc. Không đổi schema response. [Plan](../plans/m4.9-wiktionary-form-of-2026-11-21.md).
- Chi tiết cho FE: [Handoff FE M4.9](../handoff/m4.9-jp-deinflection-fe-2026-11-19.md) và [Handoff sửa lỗi M4.9 (20/11)](../handoff/m4.9-jp-deinflection-fix-fe-2026-11-20.md).

## M12-A06.1/A12 — Bổ sung A3F0C7 ngày17/11/2026

**Đã deploy production `ac5dccf` ngày17/11/2026.** Reverse và suggestions/reverse cùng
thêm preview:SenseCardDto|null ở từng en[]/ja[]; schema/cờ machine/reviewed như
search.preview. JA thêm lexeme_id:string|null và sense_id:string|null của mục
Nhật, không phải via_lexeme_id EN. Không đủ bằng chứng nghĩa trảnull; chỉ có
lexeme_id thì mở danh sách nghĩa, không tự chọn nghĩa đầu. Mọi alias/trường cũ,
order và scope giữ nguyên. [Handoff A3F0C7](../handoff/m12-a3f0c7-reverse-preview-fe-2026-11-17.md).


## M12-A06.1/A12/A17 — Đã deploy production ngày 13/11/2026 (`4df8655`)

- Reverse và suggestions/reverse có canonical snake_case đúng Swagger, giữ
  aliases camelCase deprecated: lexeme_id/lexemeId, frequency_rank/frequencyRank,
  sense_hint/senseHint, via_lexeme_id/viaLexemeId, via_lemma/viaLemma,
  exact_sense/exactSense. Cả hai bộ giá trị bằng nhau, không mất null/false.
- JA chọn representative exactSense tốt nhất trước dedup text, rồi xếp nhóm;
  suggestions giữ ưu tiên nguồn. Chưa sửa assertion dữ liệu nước→of, không
  bảo đảm ví dụ nước/水 đã được giải quyết toàn bộ chỉ bằng thay comparator.
- Reverse exact ưu tiên kết quả case-insensitive có dấu. Chỉ khi không có exact
  trên tập source EN mới fallback f_unaccent, vẫn exact sau bỏ dấu, không prefix.
  Suggestions reverse escape %, _, backslash như literal.
- Search/suggestions sinh thêm romaji n-separated trong cùng query pipeline:
  honyaku có hon'yaku/ほんやく và cách đọc gốc; genin giữげにん, thêmげんいん.
  Giữ Bearer/profile, ghi một history query gốc ở trang đầu, không gọi AI.
- Entry JA có metadata wikt_pos=romanization không xuất hiện độc lập trong
  search/suggestions. Không lọc mọi chữ Latin hoặc pos unknown, không xóa core;
  alias/reading của entry chuẩn vẫn tìm được theo pipeline hiện có.
- Cursor search mới **v6** do semantics tập variants thay đổi. Cursor v5 trở
  xuống trả400 VALIDATION_FAILED; FE bỏ cursor/cache trang cũ, tải lại trang đầu
  một lần. Cursor vẫn opaque; không ghép trang của hai profile/phiên bản.
- JSON API mặc định private,no-store, kể cả dictionary; riêng public sources
  có max-age300. Policy SVG vẫn theo controller (guest public/auth private +
  Vary Authorization). Header không thay việc FE dọn SW/cache account.

FE giữ snakeKeys adapter cho đến rollout được xác nhận; bỏ romaji query phụ
chỉ sau deploy A17. [Ledger release](../handoff/m12-fe-feedback-sync-2026-11-13.md).

Tra từ điển **công khai** (không bắt buộc đăng nhập). Riêng lịch sử tra từ và báo lỗi gloss
cần Bearer token. Tầng đọc dùng `serve.*`/`core.*` (chỉ đọc); ghi duy nhất `app.search_history`
và `app.gloss_report`.

> DB2 đã có trigram/bigram indexes; repository dùng 3 nhánh matching mặt chữ/reading/romaji
> với ILIKE kiểm chứng. Ký tự wildcard `% _ \` được escape.
> **M4.2 / DB4-D0.2 đã deploy VPS; M4.5 mở rộng JA bên dưới.** Contract dưới đây
> cần migration **038_dictionary_source_projection.sql** trước khi deploy code mới.

## M4.2 — Search một ký tự (đã deploy VPS 2026-10-20)

- Đã áp migration **044_dictionary_short_search_indexes.sql** trước code (bản local trước đây tên042). Giữ các
  index cũ; thêm character GIN và B-tree trên `lower(...) text_pattern_ops`.
- Query đúng một chữ Latin ASCII (`a`–`z`, không phân biệt hoa/thường) dùng
  **prefix**: `a` tìm `a`, `apple`…; không tìm `cat` chỉ vì chứa chữ `a`.
  Quy tắc áp dụng cả kana được sinh từ input đó khi tra JA/không truyền `lang`.
- Một ký tự khác (Kanji/kana/ký tự đặc biệt) vẫn substring; `猫` tìm cả
  `猫`, `山猫`, `猫舌`. Đếm ký tự Unicode, hỗ trợ Kanji ngoài BMP.
- Từ >=2 ký tự giữ substring. Ranking/source visibility, scope và
  shape success response giữ nguyên. Search và suggestions dùng cùng quy tắc.
- Query dùng custom plan theo parameters; JIT tắt trong transaction search.
  Statement timeout 20 giây; không chuyển timeout thành `data: []`.
- Khi DB hủy query vì timeout: **HTTP 504**, code `DICTIONARY_SEARCH_TIMEOUT`,
  response lỗi theo `{code,message}`. FE hiển thị yêu cầu nhập thêm ký tự/thử lại,
  không hiển thị "không tìm thấy từ" cho trường hợp này.
- Không đổi provider AI, không gọi AI trong search; không cần đổi payload FE.

## M6.2 — Phạm vi hồ sơ (code local, chưa deploy)

Các endpoint search/suggestions/reverse, lexeme senses, sense detail/links và
kanji nhận **Bearer tùy chọn**. Khi có token và hồ sơ active (fallback mặc định),
chỉ trả entry thuộc primary/secondary language của hồ sơ; support language
không được tính là ngôn ngữ từ vựng cần học. Không có token/chưa có hồ sơ:
giữ catalog công khai để tra cứu/onboarding.

- Search/suggestions áp scope vào cả ba nhánh SQL **trước** ranking/LIMIT.
  `lang` chỉ thu hẹp; yêu cầu language khác hồ sơ không trả entry bị ẩn.
- Cursor search có scope key opaque (v6 trong bản M12 local, v5 trước rollout); đổi ngôn ngữ/profile dùng lại cursor
  cũ trả `400 VALIDATION_FAILED`, tải lại trang đầu.
- Truy cập trực tiếp sense/lexeme của ngôn ngữ bị ẩn trả `404 SENSE_NOT_FOUND` /
  `LEXEME_NOT_FOUND`. Sense links chỉ chứa ngôn ngữ đang học.
- Reverse lookup giao `to` với ngôn ngữ hồ sơ; JA-only không trả EN hits và
  `viaLemma` rỗng. EN vẫn có thể dùng nội bộ làm cầu nối assertion.
  `matched` phản ánh kết quả hiển thị, không chỉ việc tìm được cầu nối EN.
- EN-only truy cập Kanji có token trả `404 KANJI_NOT_FOUND`.
- Scope lọc **entry/từ cần học**, không xóa EN gloss đang dùng giải nghĩa sense JA,
  nguồn/attribution hay nội dung ghi chú tự nhập. FE dùng gloss VI nếu có.
- FE gửi token cả ở autocomplete/reverse/detail, key cache gồm hồ sơ + tập
  language; reset kết quả và cursor sau khi đổi scope. Assets SVG dùng fetch
  có Bearer nếu muốn áp scope, rồi tạo blob URL; URL công khai vẫn phục vụ khách.

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
- Xếp hạng: khớp chính xác → khớp đầu chuỗi → tiếng Nhật ưu tiên nguồn JMdict và mục có gloss Việt → tần suất (`NULLS LAST`) → độ dài → các khóa ổn định của face. Với ngôn ngữ khác, hai tín hiệu tiếng Nhật luôn bằng nhau và không đổi thứ tự.
- `limit` mặc định 20, tối đa 100. `q` 1–100 ký tự sau khi trim (`400 VALIDATION_FAILED` nếu rỗng).
- `cursor` là chuỗi opaque trả từ response trước; cursor chỉ dùng lại với cùng `q` và `lang`, sai thì `400 VALIDATION_FAILED`.
- M4.2 ưu tiên mặt chữ khớp truy vấn trực tiếp, sau đó lemma chính; romaji
  `hashiru` trả `走る`, còn tìm trực tiếp `奔る` vẫn trả biến thể đó.
- Giữ **một matching face mỗi lexeme_id trước cursor/LIMIT+1**. EN khác ID/nguồn/POS/reading vẫn giữ riêng. Policy JA đang live ẩn hit nguồn phụ không có reading khi đã có JMdict cùng mặt chữ/ngôn ngữ; giữ các entry có reading, không gộp hay xóa ID.
- Cursor hiện dùng **v5**; cursor v1–v4 cũ trả `400 VALIDATION_FAILED`, client bắt đầu lại trang đầu. Không giải mã/sửa cursor ở FE.
- Khi tìm tiếng Nhật, romaji được chuyển sang kana để tìm thêm. Ví dụ `q=hashiru&lang=ja` tìm được `走る` cả khi `core.lexeme.romanization` chưa có dữ liệu.

## GET /v1/dictionary/suggestions?q=&lang=

Autocomplete đang live: response `{ data, next_cursor: null }`, tối đa 5 hit,
không ghi search history. Gộp face hiển thị trùng theo language/surface/reading để
nguồn trùng không chiếm các ô gợi ý. Ranking dùng cùng policy search, gồm BCCWJ cho
JA. Không gọi AI; có thể ít hơn 5 nếu không đủ kết quả. Các ID khác vẫn được giữ
trong DB và endpoint detail.

M4.5 (03/11/2026, code local): suggestions bổ sung preview **EN**, dùng cùng policy
chọn sense như search; JA giữ preview hiện có. FE đọc `data[].preview.gloss_vi` để
hiển thị nghĩa ngay trong danh sách, không cần gọi detail cho từng hit. Giữ
`preview.gloss_vi_machine` / `preview.gloss_vi_reviewed` để hiện badge nghĩa máy
chưa duyệt; khi thiếu VI dùng `preview.gloss_en` rồi `preview.definition` nếu có.
`preview.sense_id` là ID nghĩa, khác `lexeme_id`. Không có sense được chọn/card
hợp lệ thì `preview` có thể vắng; FE ẩn dòng nghĩa, không hiển thị `undefined`.
Nghĩa của một sense được chọn, không phải toàn bộ nghĩa của từ đa nghĩa. Chưa deploy.

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
- JA: list vẫn giữ mọi sense nhưng đưa sense có gloss Việt không rỗng lên trước,
  rồi xét curated order và metadata JMdict. Gloss máy cũng được tính nếu card đang
  trả nó; `gloss_vi_machine`/`gloss_vi_reviewed` vẫn cho FE biết trạng thái. Tín
  hiệu này chỉ thể hiện có bản dịch, không phải độ phổ biến của sense.
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

**M4.3, cập nhật 2026-10-20: đã push/deploy VPS release `48b8507`, smoke HTTPS pass.**

- Trả **0–3 từ khác nhau** cho sense đang xem, cả EN → JA và JA → EN;
  không bù cho đủ 3. `next_cursor` luôn `null`, schema item không đổi.
- Cặp phải đã công bố trong `serve.sense_pair`; kiểm lại concept `curated`,
  cả hai mapping còn `exact` và confidence ≥ 0.7. Áp scope hồ sơ cho cả hai đầu.
- Chính target sense có gloss Việt không rỗng. JA chọn JMdict có reading.
  Target lexeme phải xuất hiện đúng ID trong trang đầu search mặc định (20 mục),
  cùng ngôn ngữ/scope; dùng chung query policy search, không remap theo mặt chữ.
- Ưu tiên BCCWJ/frequency/common hiện có, rồi confidence và ID ổn định.
  Mỗi lexeme/nhãn sau chuẩn hóa chỉ lấy một đại diện, kể cả khác source/POS/reading/case.
- Không có target đạt gate thì `data: []`; FE ẩn section và chỉ gọi links của
  sense đang chọn. Click giữ `sense_id` thật, không search lại rồi chọn mục đầu.
- Khi bước kiểm search timeout, trả `504 DICTIONARY_SEARCH_TIMEOUT`, không
  trả danh sách links chưa kiểm chứng. Có thể thử lại sau; nhập thêm chữ không
  thay đổi nhãn kiểm tra của endpoint links.

Xem [report và gate production](../reviews/m4.3-searchable-links-implementation-2026-10-20.md)
và [handoff FE](../handoff/fe-handoff-2026-10-20.md).

## GET /v1/kanji/:literal

```bash
curl -s http://localhost:3000/v1/kanji/走
```

Trả số nét, cấp (grade/JLPT cũ-mới), bộ thủ (`radical` — tên/nghĩa VI từ `public.radical`),
`readings/meanings/nanori/query_codes` (jsonb), `used_in_forms`, `media_kinds`, và **`parts`** —
thành phần cấu tạo (nguồn `core.kanji_radical`, kradfile-style) kèm tên/nghĩa VI nếu thành phần
là bộ thủ (khớp cả biến thể, vd `亻→人`, `犭→犬`):

```json
"parts": [
  {"char": "子", "position": 1, "is_radical": true,  "radical_number": 39, "name_vi": "Tử",  "meaning_vi": "Con, đứa trẻ"},
  {"char": "尚", "position": 2, "is_radical": false, "radical_number": null, "name_vi": null, "meaning_vi": null},
  {"char": "冖", "position": 3, "is_radical": true,  "radical_number": 14, "name_vi": "Mịch", "meaning_vi": "Trùm khăn lên"}
]
```

- Phủ: kanji lớp 1–6 **100%**, jōyō ~99,8%, tổng 12.156 chữ.
- `components` — **cây thành phần chuẩn KanjiVG** (CC BY-SA 3.0, Ulrich Apel), đệ quy, có
  `original` (dạng gốc biến thể), `position`, `is_radical`, `is_phonetic` (biểu âm), `part`,
  `strokes` (số nét thuộc thành phần — dùng để highlight trên ảnh KanjiVG):

```json
"components": {
  "char": "猫", "children": [
    {"char": "⺨", "original": "犬", "position": "left", "is_radical": true, "strokes": [1,2,3]},
    {"char": "苗", "position": "right", "is_phonetic": true, "children": [
      {"char": "艹", "original": "艸", "position": "top", "strokes": [4,5,6]},
      {"char": "田", "position": "bottom", "strokes": [7,8,9,10,11]}
    ]}
  ]
}
```

- Ưu tiên hiển thị `components` khi có (kyōiku/jōyō 100%, tổng 6.416 chữ); nếu `null` thì
  dùng `parts` (KRADFILE) — một số chữ phức tạp ở nguồn KRADFILE có thành phần "residual"
  (vd `猫 → 田+犯+艾`) nên chỉ là fallback.
- Lỗi: `404 KANJI_NOT_FOUND`.

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

## M10.5 — Thứ tự mục từ EN cùng mặt chữ

Trong bản BE M10.5 mới, thứ tự tìm kiếm giữ các nhóm khớp chính xác/prefix,
tần suất và độ dài hiện có. Khi các mục EN cùng lemma, mặt chữ và hạng tần suất,
hạng `display_order` tốt nhất còn hiệu lực trong M10.5 phân thứ tự giữa chúng.
Mục thiếu hạng dùng thứ tự ID sau các mục đã xếp hạng trong nhóm. Suggestions
dùng tiêu chí này khi chọn mục đại diện. `frequency_rank` vẫn phản ánh tần suất
từ; thứ hạng M10.5 chưa có trường public riêng.

Search cursor chuyển sang **v7**. Khi dùng token cũ và nhận
`400 VALIDATION_FAILED`, FE tải lại trang đầu với cùng truy vấn và bộ lọc.
Các trường `preview`, `recommended_sense_ids`, `is_primary` và thứ tự
`view=flat` giữ contract hiện tại. Xem [handoff FE M10.5](../handoff/docs5-fe-quiz-search-srs-2026-11-18.md#m105--handoff-fe-cho-mục-từ-và-nghĩa-mặc-định).

## M4.5 — JA learner priority / BCCWJ (deploy 08/10/2026)

Migration `040_japanese_learner_priority.sql` và run `ja-bccwj-v1` bổ sung:

- Search/suggestions: JA JMdict ghép được BCCWJ dùng `frequency_rank` của corpus,
  `frequency_source: "bccwj-suw"`. Rank này là tần suất **mục từ**, không phải
  tần suất nghĩa. EN giữ rank cũ, `frequency_source: "lexeme"`; chưa có rank trả null.
- Ghép offline bằng spelling + reading + POS; mapping mơ hồ không được gán rank.
  Khi không ghép được, ưu tiên metadata `common` của JMdict và thứ tự ổn định;
  fallback này không tạo ra số tần suất giả trong response.
- Có thể thêm `preview: SenseCard` cho hit JA: nghĩa đầu trong tập dành cho người học,
  giữ đúng sense ID, gloss máy/review và tất cả EN context.
- `/lexemes/:id/senses` mặc định vẫn trả **đủ** sense, nhưng JA có thứ tự hiển thị riêng.
  `recommended_sense_ids: string[]` chọn tối đa 3 nghĩa; `priority_basis` là
  `curated_learner` (lựa chọn đã audit bởi GPT) hoặc `source_metadata` (thứ tự JMdict,
  giảm ưu tiên tag cổ/hiếm và lĩnh vực chuyên môn). Không gọi đây là tần suất nghĩa đo được.
- `view=flat` giữ `sense_no`/thứ tự nguồn, không áp lựa chọn người học; detail/links,
  `is_primary`, collection/SRS, ID và mapping DB4 không đổi.
- Cursor hiện dùng **v5** vì ranking JA thay đổi. Cursor v1–v4 trả 400; FE bỏ cursor
  cũ và gọi lại trang đầu. Cursor vẫn opaque, không tự sửa token.

Consumer FE: dùng `preview` làm nhãn search nếu có; trong modal lấy các card theo
`recommended_sense_ids` làm phần “Nghĩa thường gặp”, các card còn lại trong “Xem tất
cả nghĩa”. Nếu recommended rỗng, dùng data với nhãn “Nghĩa”. Dùng `sense_id` khi thêm vào collection; không dùng vị trí hiển thị hoặc
`sense_no` làm ID. Badge gloss máy chưa review vẫn bắt buộc. Backend không cắt bỏ
nghĩa chuyên môn/hiếm và không quyết định nghĩa trong một câu cụ thể.

Credits dùng nguồn `bccwj-suw` từ `/v1/sources`: NINJAL, BCCWJ short-unit frequency
list v1.0 ([dataset](https://doi.org/10.15084/00003218),
[thông tin nguồn](https://clrd.ninjal.ac.jp/bccwj/en/freq-list.html)). Raw ZIP/TSV và
artifact corpus ở storage riêng, không đưa vào Git hoặc response API.

Chi tiết vận hành: [M4.5 handoff](../handoff/m4.5-ja-bccwj-priority.md).

## 2026-10-20 — M4.3 phát hành trên VPS

Migration index search khi tích hợp đổi tên thành **044_dictionary_short_search_indexes.sql**, vì042 đã thuộc M14 trên production. Xem [report deploy](../reviews/m4.3-searchable-links-deploy-2026-10-20.md) để biết trạng thái và kết quả live; số liệu/tên042 trong bản kiểm tra local ngày13/10 là lịch sử.

## M14.3 — Ảnh chi tiết nghĩa (code local, chưa deploy)

`GET /v1/senses/:id` thêm field `image` ở cấp response: `{url, mime, width, height} | null`.
Dimensions nullable, URL dựng từ `MEDIA_BASE_URL` (mặc định `https://media.langoo.org`).
Ảnh phải qua gate `serve.concept_image`; hỗ trợ anchor, provenance source còn khớp định nghĩa
và exact concept mapping. Fallback thể chia chỉ khi phân giải root chắc chắn; không có ảnh
hoặc root nhiều nghĩa trả null. [Handoff FE M14.3](../handoff/m14.3-image-delivery-api-2026-11-01.md).
Không thay search hoặc lexeme-senses bằng field image trong hạng mục này.

## M4.7 — Tiêu đề dạng chính trong search và suggestions (code local, chưa deploy)

Mỗi hit của `GET /v1/dictionary/search` và `/v1/dictionary/suggestions` thêm `lemma: string`
từ chính `core.lexeme` của lexeme_id. `surface` vẫn là dạng khớp được search chọn.
Ví dụ query `折紙`: `lemma="折り紙"`, `surface="折紙"`, cùng lexeme_id `124626`.
Không đổi exact/ranking, cursor v5 hoặc giới hạn/gộp suggestions. FE dùng lemma làm tiêu đề,
hiện surface khác biệt ở dòng “Dạng khớp”; không đổi query/ID theo tiêu đề.
[Handoff FE M4.7](../handoff/m4.7-canonical-search-title-fe-2026-11-01.md).
