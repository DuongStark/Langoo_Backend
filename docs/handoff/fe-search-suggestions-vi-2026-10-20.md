# Handoff FE — Gợi ý tiếng Việt trong thanh search (VI → EN/JA) · 2026-10-20

## 1. Vì sao trước đây gõ tiếng Việt không có gợi ý

- `GET /v1/dictionary/suggestions` chỉ tìm theo **mặt chữ headword** (`surface / reading / romanization`) trong `serve.dictionary_search`, **không tìm theo nghĩa**.
- Kết quả bị lọc theo **scope hồ sơ** = `primary + secondary`. Với hồ sơ JA+EN, `language_id IN (1,2)` → mọi mục tiếng Việt (`language_id=3`) bị loại. VI là **support language** nên không nằm trong scope.
- Hệ quả: khách (không đăng nhập) gõ `trường` ra 5 mục **từ điển tiếng Việt**; user đã đăng nhập → **rỗng**.

## 2. Endpoint mới

```
GET /v1/dictionary/suggestions/reverse?q=truong&to=en,ja&limit=8
```

- **Auth:** optional. Có Bearer → scope theo hồ sơ; không token → trả cả EN+JA.
- **Không ghi lịch sử tra từ** (gọi mỗi keystroke).

### Query params

| Param | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `q` | string 1–64 | — | Tiếng Việt, **có dấu hoặc không dấu** đều được |
| `to` | `en` \| `ja` \| `en,ja` | `en,ja` | Lọc đích trả về (vẫn tôn trọng scope) |
| `limit` | int 1–20 | `8` | Giới hạn **mỗi nhóm** (en và ja riêng) |

### Response (thực tế dùng camelCase)

```json
{
  "query": "truong",
  "matched": true,
  "en": [
    { "lexemeId": "1786884", "lemma": "school", "pos": "noun", "frequencyRank": 191, "senseHint": null, "vi": "trường" },
    { "lexemeId": "1086700", "lemma": "field", "pos": "noun", "frequencyRank": 580, "senseHint": "physics: region affected by a particular force", "vi": "trường" }
  ],
  "ja": [
    { "text": "大学", "senseHint": "college or university", "viaLexemeId": "1786884", "viaLemma": "school", "exactSense": false, "vi": "trường" },
    { "text": "学校", "senseHint": "school", "viaLexemeId": "1786884", "viaLemma": "school", "exactSense": false, "vi": "trường" },
    { "text": "場", "senseHint": "physics: region affected by a particular force", "viaLexemeId": "1086700", "viaLemma": "field", "exactSense": true, "vi": "trường" }
  ]
}
```

| Field | Ý nghĩa |
|---|---|
| `matched` | Có ít nhất 1 kết quả trong nhóm được phép trả |
| `en[].lexemeId` | Id lexeme EN — dùng mở `/v1/lexemes/:id/senses` |
| `en[].vi` | Từ tiếng Việt khớp (để hiển thị "vì sao khớp") |
| `ja[].text` | Mặt chữ tiếng Nhật (kanji/kana) |
| `ja[].viaLemma` | Từ EN trung gian (`viaLemma`) |
| `ja[].exactSense` | Sense hint JA khớp sense hint EN (ưu tiên hiển thị) |
| `ja[].vi` | Từ tiếng Việt khớp |

> ⚠️ Swagger DTO đang mô tả snake_case (`lexeme_id`, `via_lexeme_id`…) — **JSON thực tế là camelCase** (giống endpoint `/reverse` hiện có). FE đọc theo JSON thực tế.

### Matching & xếp hạng

- **Prefix, không phân biệt dấu:** `unaccent(lower(target_text)) LIKE unaccent(lower(q)) || '%'` → `truong` khớp `trường`, `trượt`, `trước`...
- **Ưu tiên khớp đúng dấu trước:** gõ `trườ` → `trường…` đứng trước `trước…`.
- EN xếp theo **tần suất** (corpus rank), sau đó độ dài từ VI.
- JA xếp theo **thứ tự EN nguồn** (EN phổ biến hơn trước), rồi `exactSense`, dedupe theo `text`.
- Query cụm vẫn hoạt động: `q=trường học` → `school` → `学校, 学び舎, 大学, 学派`.

### Scope

| Client | Kết quả |
|---|---|
| Không token | cả `en` + `ja` |
| Hồ sơ **JA+EN** | cả `en` + `ja` (JA lên trước nếu primary=ja — FE tự sắp) |
| Hồ sơ **JA-only** | chỉ `ja`; `en: []`, `viaLemma: ""` |
| Hồ sơ không có JA/EN (hiếm) | `matched:false`, rỗng |

### Hiệu năng / lỗi

- Index `translation_assertion_vi_prefix` (migration `043`) → query **~1–5ms** (29k assertion VI). Request đầu ~60–80ms.
- Lỗi: `400 VALIDATION_FAILED` khi `q` rỗng/>64 hoặc `to` sai (details mảng).
- Không match: `200 { "matched": false, "en": [], "ja": [] }`.

## 3. FE tích hợp (khuyến nghị)

```
onInput(q):
  if (q.trim().length < 2) → clear suggestions (tránh nhiễu prefix 1 ký tự)
  debounce 250ms
  abort request cũ (AbortController)
  nếu q chứa ký tự tiếng Việt (regex dấu) hoặc luôn thử:
      GET /v1/dictionary/suggestions/reverse?q=...&limit=5
  ngược lại:
      GET /v1/dictionary/suggestions?q=...   (JA/EN headword như cũ)
```

- **Render nhóm:** `Tiếng Nhật` (ja) trước nếu profile JA-first, `Tiếng Anh` (en) sau (hoặc ngược lại).
  - Item JA: chính `text`, phụ `vi` (nghĩa) + `viaLemma`.
  - Item EN: chính `lemma`, phụ `vi`.
- **Bấm item JA:** endpoint không trả lexeme id JA (chỉ text) → gọi `GET /v1/dictionary/search?q=<text>&lang=ja` rồi mở hit đầu tiên; hoặc mở màn search với query đó.
- **Bấm item EN:** dùng `lexemeId` → `GET /v1/lexemes/:id/senses`.
- Hiển thị `vi` để người dùng hiểu vì sao khớp (đặc biệt khi gõ không dấu).
- Gợi ý `limit=5` cho dropdown; `8–10` nếu panel rộng.

## 4. Phương án FE-only (nếu không muốn dùng endpoint mới)

`GET /v1/dictionary/reverse?q=...&to=ja` đã có, nhưng **match chính xác toàn từ** (`target_text = q`), **không prefix, không bỏ dấu** → chỉ dùng được khi gõ đủ từ, không phù hợp autocomplete. Khuyến nghị dùng endpoint mới.

## 5. Test nhanh (live)

```bash
# không dấu
curl -s 'http://127.0.0.1:3000/v1/dictionary/suggestions/reverse?q=truong&limit=5' | jq '{matched, ja: [.ja[].text]}'
# có dấu + chỉ JA
curl -s 'http://127.0.0.1:3000/v1/dictionary/suggestions/reverse?q=tr%C6%B0%E1%BB%9Dng&to=ja' | jq '.ja'
# cụm
curl -s 'http://127.0.0.1:3000/v1/dictionary/suggestions/reverse?q=tr%C6%B0%E1%BB%9Dng%20h%E1%BB%8Dc' | jq '{en: [.en[].lemma], ja: [.ja[].text]}'
# không match
curl -s 'http://127.0.0.1:3000/v1/dictionary/suggestions/reverse?q=xyz' | jq
```

## 6. Triển khai

- BE: `GET /v1/dictionary/suggestions/reverse` (commit `3d9fdd7`, cải thiện sort/vi `a5f7bf5`)
- Migration `db/migrations/043_vi_suggest_index.sql` (f_unaccent + index prefix, đã apply prod)
- FE chưa cần migration gì; chỉ gọi endpoint mới.

## 7. Giới hạn đã biết

- Prefix ngắn (1–2 ký tự) vẫn có thể nhiễu do bỏ dấu (tone marks) — FE nên yêu cầu ≥2 ký tự.
- Chỉ hỗ trợ đích `en`/`ja` (VI→VI headword vẫn dùng endpoint `suggestions` cũ nếu sau này mở scope support language).
- Không trả reading/furigana cho `ja[].text`; nếu cần hiển thị cách đọc, FE tra thêm qua search/lexeme.
