# Kanji components chuẩn KanjiVG — import + API · 2026-10-08

> Nguồn: **KanjiVG** (CC BY-SA 3.0, Ulrich Apel, https://kanjivg.tagaini.net/).
> Script: [`scripts/db3/kanjivg-components.ts`](../../scripts/db3/kanjivg-components.ts) · Migration: [`db/migrations/040_kanji_component.sql`](../../db/migrations/040_kanji_component.sql) · DB + API đã deploy VPS.

## 1. Import

| Chỉ số | Giá trị |
| --- | --- |
| File SVG đọc | 6.417 (lọc file gốc 5–6 hex, bỏ `-Kaisho` variants) |
| Kanji import | **6.416** (1 file trùng literal bị bỏ) |
| Dòng `core.kanji_component` | **43.634** |
| Bảng | `core.kanji_component` (ord, parent_ord, depth, component, original, is_variant, is_radical, is_phonetic, position, part, strokes[], stroke_count) |

- Parse cây `<g kvg:element>` lồng nhau: `kvg:original` (⺨→犬), `kvg:variant`, `kvg:position`, `kvg:radical`, `kvg:phon` (biểu âm), `kvg:part`, số nét từ path id `-sN`.
- Idempotent: xoá + chèn theo batch 200 kanji; chạy lại được.
- Lỗi đã fix trong quá trình: wrapper không element bị mồ côi; file variant trùng literal; GRANT cho app user; boolean flag parser nuốt token.

## 2. API `GET /v1/kanji/:literal`

Thêm field `components` — cây đệ quy:
```json
"components": {
  "char": "猫", "position": null, "is_radical": false, "is_phonetic": false,
  "strokes": [], "children": [
    {"char": "⺨", "original": "犬", "position": "left", "is_radical": true, "is_variant": true,
     "strokes": [1,2,3], "name_vi": "Khuyển", "meaning_vi": "Con chó", "children": []},
    {"char": "苗", "position": "right", "is_phonetic": true, "children": [
       {"char": "艹", "original": "艸", "position": "top", "strokes": [4,5,6], "children": []},
       {"char": "田", "position": "bottom", "strokes": [7,8,9,10,11], "children": []}
    ]}
  ]
}
```
- `parts` (KRADFILE) **vẫn giữ** làm fallback cho kanji chưa có KanjiVG.
- `stroke_count` + `strokes` cho phép FE highlight nét của từng thành phần trên ảnh KanjiVG.

## 3. Kiểm chứng (live)

| Chữ | components (KanjiVG) | parts (kradfile cũ) |
| --- | --- | --- |
| 猫 | ⺨(犬)[left]★ 1-3 + 苗[right]♪ → 艹(艸) 4-6 + 田 7-11 | 田 + 犯 + 艾 ❌ |
| 学 | ⺍ 1-3 + 冖 4-5 + 子[bottom]★ 6-8 | 子 + 尚 + 冖 |
| 休 | 亻(人)[left]★ 1-2 + 木[right] 3-6 | 化 + 木 ❌ |

- **Phủ**: kyōiku 1.026/1.026, jōyō 2.136/2.136, tổng 6.416/13.108 kanji; phần còn lại dùng `parts`.

## 4. Test & vận hành

- Test: `dictionary.service.spec.ts` (dựng cây), `kanji.repository.spec.ts` (SQL) — tổng **46/46**.
- VPS: script lưu tại `/opt/langoo/app/scripts/db3/kanjivg-components.ts`; manifest `/tmp/kanjivg-components-manifest.json`.
- Backups code cũ: `*.bak-20261008-components`.
