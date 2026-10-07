# API tra ngược Việt→Anh/Nhật (`/v1/dictionary/reverse`) · 2026-10-07

> Code: [`src/dictionary/repositories/reverse-lookup.repository.ts`](../../src/dictionary/repositories/reverse-lookup.repository.ts) · Controller: [`dictionary.controller.ts`](../../src/dictionary/dictionary.controller.ts) · Đã deploy VPS (build lại + `pm2 restart langoo-api`).

## 1. Endpoint

```
GET /v1/dictionary/reverse?q=cát&to=en,ja
```

| Param | Bắt buộc | Mô tả |
| --- | --- | --- |
| `q` | ✓ | Từ tiếng Việt (1–64 ký tự, so khớp không phân biệt hoa/thường) |
| `to` | – | `en`, `ja` hoặc `en,ja` (mặc định `en,ja`) |

Kết quả: `{query, matched, en:[{lexeme_id, lemma, pos, frequency_rank, sense_hint}], ja:[{text, sense_hint, via_lexeme_id, via_lemma, exact_sense}]}`
- `exact_sense=true` khi `sense_hint` tiếng Nhật khớp `sense_hint` của nghĩa tiếng Việt (xếp đầu, rồi mới tới các sense khác).
- Không match → `matched=false`, mảng rỗng (HTTP 200).

## 2. Nguồn dữ liệu (DB production)

- `core.translation_assertion`: đích VI `target_language_id=3` (29.626 dòng) → `source_lexeme_id` (lexeme tiếng Anh `language_id=1`), lấy `en_lemma/pos/frequency_rank` từ `core.lexeme`.
- Đích JA `target_language_id=2` (69.786 dòng) của cùng source lexeme → `target_text` (kana/kanji) + `sense_hint`.
- Chuỗi: **VI → EN → JA** (né omw-ja bị chặn license ở DB4 mapping; ở đây chỉ đọc bảng assertion đã import).
- Index sẵn: `(target_language_id, target_text)`, `(source_lexeme_id, source_sense_id)`.

## 3. Kết quả thật (VPS)

| Query | EN | JA |
| --- | --- | --- |
| `cát` | sand | **砂** (exact), 砂浜, 砂色, ビーチ |
| `mèo` | cat | **家猫, 猫** (exact), 猫ま |
| `nước` | of, water, liquid, juice, -land | **水, 液体, 流体, ジュース, 国…** (exact) |
| `chạy` | go, run | — (to=en) |
| `CÁT` | sand | — |
| `xqzpt` | matched=false | — |

## 4. Hạn chế đã biết

- Từ ngắn/thông dụng nhiều nghĩa (vd `nước`) có thể trả lẫn từ chức năng (`of`, `-land`) do assertion cấp cụm từ; v1 xếp theo `frequency_rank` — có thể siết bằng lọc `pos`/`sense_hint` sau.
- JA đi qua chuỗi EN nên phụ thuộc chất lượng assertion EN; `exact_sense` chỉ so khớp chuỗi `sense_hint`, không phải ngữ nghĩa đầy đủ.
- Chưa log lịch sử tra (khác `search`); chưa hỗ trợ romaji/phiên âm VI.

## 5. Test

- `src/dictionary/dictionary.service.spec.ts`: 4 test mới (exact_sense ưu tiên/dedupe, `to=en` không gọi JA, không match, validate rỗng) — tổng 25/25 pass.
