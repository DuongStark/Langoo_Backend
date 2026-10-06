# Handoff — Gộp subsense wiktextract trong `/v1/lexemes/:id/senses` · 2026-10-06

> **Đã được thay thế bởi [M4.3](../reviews/m4-3-subsense-integration-2026-10-06.md).**
> Bản ban đầu dùng context chưa guard nguồn, đổi definition cùng ID, và đổi cấu trúc data
> nên không phải thay đổi chỉ additive. Dùng contract M4.3 dưới đây cho FE mới.
>
> Branch: `parallel/deepseek-search-sources` (merge main M4.2: `3cbf913`) · Đã deploy VPS (build lại + restart `langoo-api`).
> Nền tảng: M4.2 `serve.sense_card.gloss_en_context` (migration 038 `wiktextract-en-leaf-v1`).

## 1. API thay đổi (bản triển khai ban đầu, được sửa bởi M4.3)

`GET /v1/lexemes/:id/senses` giờ trả **chỉ nghĩa cha** trong `data`; mỗi cha có thêm:

```jsonc
{
  "sense_id": "1809675",
  "definition": "A common, firm, round fruit produced by a tree of the genus Malus.", // supergloss
  "sub_senses": [
    { "sense_id": "1809676", "definition": "Often with a qualifying word: any fruit or vegetable, …", "sub_senses": [] },
    { "sense_id": "1809677", "definition": "Something which resembles the fruit of Malus domestica …", "sub_senses": [] }
  ]
  // …các field SenseCardDto khác giữ nguyên
}
```

- Gom theo `gloss_en_context[0]` (supergloss) của các sense **liên tiếp** trong cùng lexeme.
- `data[i].definition` của cha = supergloss; con = gloss lá (phần tử context đầu tiên khác supergloss).
- Sense không có context (JA jmdict, wordnet, sense không eligible) → đứng riêng, `sub_senses: []` — **không đổi** so với trước.
- Không đổi cursor/pagination (endpoint này vốn `next_cursor: null`).

## 2. FE nên render

- Render `data` như hiện tại.
- Nếu `sub_senses.length > 0`: hiện dòng cha + nút thu gọn `"N nghĩa con ▸"`; mở ra thì render từng con (cùng shape, mỗi con có link sense riêng).
- Badge/gloss VI của con lấy từ chính con (`gloss_vi*`).

## 3. Số liệu (local + VPS khớp)

| Lexeme | Trước | Sau |
| --- | --- | --- |
| draw (verb, 1009311) | 138 dòng | **6 cha + 132 con** |
| run (verb, 1764987) | 64 dòng | **38 cha + 26 con** |
| apple (694408) | 20 dòng | **8 cha + 12 con** |

Toàn DB: 12.703 lexeme (0,85%) bị ảnh hưởng; JA/jmdict không đổi.

## 4. Kiểm thử & rollback

- `jest` full: 47 suite / 353 test pass; eslint 0; build OK.
- Migration 038 đã áp trên local full DB (55433) để test; VPS đã có sẵn từ M4.2.
- Rollback code: khôi phục 3 file từ `main` rồi build lại:
  `src/dictionary/dictionary.service.ts`, `src/dictionary/dto/dictionary-response.dto.ts`, `src/dictionary/types/dictionary.types.ts`.

## 5. Ghi chú phối hợp

- Trùng **đa nguồn theo surface** (`cat ×4`, `CAT ×2`…) vẫn còn sau M4.2 — nằm trong lộ trình `docs/plans/db4-dictionary-deduplication.md` **D0.3 (group đa nguồn) / D0.5 (dọn bản ghi trùng thật)**, không thuộc handoff này.
- Hotfix runtime trước đó (ưu tiên nguồn + lọc nhiễu prefix EN) không còn trong runtime sau khi main M4.2 deploy; policy cho phần này do plan D0.3/D0.5 quyết định (prefix-noise filter có fixture riêng).
