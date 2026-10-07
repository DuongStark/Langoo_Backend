# Search JA — ẩn bản sao không-JMdict cùng mặt chữ · 2026-10-07

> Code: [`dictionary-search.repository.ts`](../../src/dictionary/repositories/dictionary-search.repository.ts) · Đã deploy VPS (build + `pm2 restart langoo-api`).

## Vấn đề

Người dùng tra từ cơ bản (vd `学生`) thấy nhiều thẻ cùng mặt chữ, phần lớn **không có gloss Việt** → cảm giác "nhiều từ chưa có tiếng Việt". Thực tế:

| Entry `学生` | Nguồn | Reading | gloss VI |
| --- | --- | --- | --- |
| 105274 | jmdict | がくせい | ✅ "học sinh, sinh viên…" |
| 105275 | jmdict | がくしょう | ❌ (từ khác nghĩa) |
| 582922 | wn:omw-ja | (trống) | ❌ |
| 2248136 | wiktextract | (trống) | ❌ |

Nền dữ liệu: **293.485 lexeme JA không reading** (chủ yếu omw-ja + wiktextract), **89.429 lemma bị trùng nhiều lexeme**; DB3-B chỉ dịch gloss cho JLPT từ nguồn JMdict.

## Fix (system-wide, không config từng từ)

Thêm CTE `visible` trong query search:
- Ẩn hit **không phải JMdict** (`cl.source_id <> 1`) **và không có reading** khi tồn tại hit JMdict cùng `(lang_code, lower(surface))`.
- Không đổi `ORDER BY`/cursor → không ảnh hưởng phân trang.
- Áp dụng cho **mọi query** (search + suggestions); EN/VI không có JMdict nên không đổi hành vi.

## Kết quả smoke (sau deploy)

| Query | Trước | Sau |
| --- | --- | --- |
| `学生&lang=ja` | 4 entry (2 bản sao không VI) | **2 entry JMdict** (がくせい + がくしょう) |
| `走る`, `猫`, `水`, `銀行`, `かける` | 20 hit | 20 hit, không hồi quy |
| `book` (EN) | 20 hit | 20 hit (không đổi) |
| `/suggestions?q=book` | 5 | 5 |
| `/lexemes/105274/senses` | — | `gloss_vi: "học sinh, sinh viên (nhất là sinh viên đại học)"` |

Test: `dictionary-search.repository.spec.ts` 3/3 (thêm test rule `visible`).

## Còn lại

- Dọn data-level 293k bản sao omw-ja/wiktextract (DB5) — fix này chỉ ẩn khỏi search, không xoá dữ liệu.
- Các entry non-JMdict có reading (hiếm) vẫn hiển thị — chấp nhận.
