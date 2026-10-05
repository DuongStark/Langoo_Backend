# Kế hoạch DB3-A — Deterministic seed (chờ duyệt)

> Phiên song song B (DeepSeek V4 Flash) · branch `parallel/deepseek-db3` · **chưa code seed, chưa migration**.
> Căn cứ kiểm kê: [`docs/reviews/db3-inventory-2026-10-05.md`](../reviews/db3-inventory-2026-10-05.md).
> Nguyên tắc dự án: kế hoạch phải được duyệt trước khi code milestone mới (`PROMPT-BACKEND.md`).

## 1. Mục tiêu & ranh giới

- **DB3-A = seed tất định (không LLM)**: dữ liệu tham chiếu/nền để UI hiển thị đủ —
  bộ thủ 214, KanjiVG (media), deck hệ thống, audit JLPT, audit credits.
- **DB3-B (không thuộc plan này)**: gloss tiếng Việt (harvest Wiktionary/OMW/Wikidata) + dịch máy
  phần thiếu bằng **OpenCode Go** (lô nhỏ + checkpoint).
- **Không** gộp DB4 (mapping sense↔concept) hoặc M14 (curation ghi `core`) vào DB3-A.
- **Không** sửa `src/**`, Prisma, migrations cũ, dependencies, env chung, `PROGRESS.md`.
  Nếu buộc phải migration/dependency → đề xuất người tích hợp chốt một lần (không tự cấp số migration).

### Quyết định đã có (không bàn lại)

1. JLPT canonical = `core.jlpt_link` (giữ provenance); `lexeme_level` chỉ tham chiếu, không ghi đè.
2. Chat runtime giữ **Groq** `openai/gpt-oss-120b` (M10.1 vừa xong) — không sửa cấu hình chat.
3. LLM cho dữ liệu (DB3-B): **OpenCode Go** *(bổ sung 05/10 của chủ dự án — không phải Zen)*.
   Lưu ý kỹ thuật: endpoint Go `/zen/go/v1` yêu cầu header `x-opencode-session` (+ User-Agent riêng);
   job DB3-B phải gửi các header này. Không đổi provider chat vì việc này.
4. Bộ thủ Kangxi 214 **khác** 253 cấu kiện KRADFILE; không suy mapping chỉ từ chuỗi bộ phận.
5. `core/serve/public/staging` read-only với API; seed là công cụ vận hành riêng, phải nêu rõ bảng ghi.
6. Không tự curated gloss/concept máy, không mất provenance, không tự đổi nguồn/license.

## 2. Phân chia & mức độ sẵn sàng

| Việc | Trạng thái | Chặn bởi |
| --- | --- | --- |
| **A1. KanjiVG media** (media_asset + kanji_media) | Làm được sau khi **tải nguồn** | Chốt: nơi lưu file + version; route phục vụ SVG là việc riêng |
| **A2. Radical 214** (public.radical) | Làm được sau khi **chốt nguồn 214 + tên VI** | Quyết định (a) bên dưới |
| **A3. Deck hệ thống** (core.deck/deck_item) | Làm được sau khi **chốt tiêu chí** | Quyết định (b) bên dưới |
| **A4. JLPT audit** | Đọc-only, làm ngay sau duyệt | Không |
| **A5. Credits audit** | Đọc-only + đề xuất, làm ngay | Quyết định (c) license 2 nguồn |
| **B. Gloss VI + ví dụ** | **Không thuộc DB3-A** | — |

### Quyết định thật sự còn thiếu

- **(a) Nguồn 214 bộ + tên/nghĩa VI — ĐÃ TÌM ĐƯỢC ONLINE (05/10), không cần LLM**: dùng 3 nguồn
  (chi tiết §4.2): Unicode `CJKRadicals.txt` (number↔radical↔unified — đã tải & validate **214/214**),
  vi.wikipedia **"Bộ thủ Khang Hi"** (bảng 214 dòng: ký tự + biến thể trong ngoặc + tên Hán-Việt +
  **nghĩa tiếng Việt**), Unicode Unihan `kTotalStrokes` (số nét). Còn 2 tiểu-quyết định:
  (a-i) chuẩn hoá văn phong `name_vi` ("Thủy" → "bộ Thủy"?; dấu kiểu mới "Thủy" hay cũ "Thuỷ" như demo 13 bộ);
  (a-ii) `name_en` để trống giai đoạn đầu hay bổ sung sau (cột nullable).
- **(b) Tiêu chí deck — ĐÃ CHỐT TẠM theo đề xuất mặc định (05/10)**: 5 deck N1–N5, anchor = sense
  `is_primary`, `is_published=false`, lexeme nhiều cấp chỉ vào cấp thấp nhất; chỉnh sau không cần migration.
- **(c) License/nguồn gốc**: `kanji-data` (id 11) và `jlpt-list` (id 12) đang "CẦN XÁC MINH";
  `omw-ja`/`omw-en` chưa rõ điều khoản; `omw-wikt-vi` thiếu version. Cần người xác minh — không tự đổi.
  Kèm: chốt **nơi lưu file KanjiVG** + **route phục vụ media** (việc backend riêng, xem §4.1).

## 3. Nguyên tắc chung của mọi seed trong DB3-A

- **Dry-run mặc định** (`--dry-run`); `--apply` chỉ khi truyền `--allow-db <tên>` khớp allowlist.
- **Idempotent**: chạy 2 lần không tạo bản sao; mọi upsert dùng khóa tự nhiên của bảng.
- **Transaction theo lô** (mặc định 500 dòng/lô) — lỗi lô nào rollback lô đó, thoát mã lỗi rõ ràng.
- **Manifest rollback**: mỗi run ghi `artifacts/db3/<UTC>-<task>.json` liệt kê khóa đã ghi + tham số;
  rollback đọc manifest, xóa đúng khóa (theo thứ tự FK ngược). *(Nếu `artifacts/` chưa được gitignore,
  đề xuất người tích hợp thêm 1 dòng — không tự sửa.)*
- **Bảo vệ đích**: từ chối chạy `--apply` nếu tên DB không nằm trong `--allow-db`, và từ chối mọi DB
  có hậu tố `_test` khi không bật `--allow-test`. Mặc định test = `langoo_parallel_deepseek_test`.
- **Không tạo bảng/schema tạm**. Ghi chỉ vào bảng nghiệp vụ đã nêu + `public.source` (khi thêm nguồn mới).
- **Kiểm chứng sau chạy**: bộ query đếm + join view (liệt kê §5), lưu kết quả cạnh manifest.

## 4. Thiết kế từng bảng

### 4.1 A1 — KanjiVG media (`core.media_asset`, `core.kanji_media`)

- **Nguồn**: KanjiVG (github.com/KanjiVG/kanjivg), license **CC BY-SA 3.0**, ~11k SVG
  (`kanji/<codepoint 5 hex>.svg`). **Cần tải** (chưa có trong `downloads/`), chốt version/zip + sha256.
- **Thêm nguồn**: `public.source` id mới `kanjivg` — license/attribution/url/version/sha256 đầy đủ.
- **File lưu**: ngoài DB (`object_key`), **không blob**. Đề xuất `object_key = kanjivg/<cp>.svg`;
  nơi lưu chốt theo môi trường (local: thư mục artifacts do ops quản; production: storage hiện có).
- **Upsert**:
  - `media_asset`: `ON CONFLICT (object_key) DO UPDATE` (sha256/bytes/mime/source_id).
  - `kanji_media`: `ON CONFLICT (kanji_literal, kind) DO UPDATE` (asset_id, frame_count).
  - `frame_count`: đề xuất `1` (SVG tĩnh) — cần chốt vì CHECK `>0` và view chỉ dùng `kind`.
- **Phạm vi**: chỉ kanji có trong `core.kanji` và có file; **báo cáo** kanji thiếu file (không tự chế).
- **Kiểm chứng**: `media_asset` tăng đúng số file; `kanji_media` join `kanji_card.media_kinds` trả
  `{stroke_svg}` cho vài chữ mẫu (日, 一, 十); chạy lại lần 2 → count không đổi.
- **Rollback**: theo manifest — `DELETE kanji_media` theo danh sách `(literal,kind)`,
  `DELETE media_asset WHERE source_id = <kanjivg>` (chỉ sau khi hết tham chiếu).
- **`media_kinds` là gì & vì sao seed chỉ ra metadata**: `core.kanji_media` trả lời "chữ này CÓ asset
  loại gì" (PK `(kanji_literal, kind)`; kind ∈ `stroke_svg|stroke_gif`); view `serve.kanji_card` gom thành
  mảng `media_kinds` (sau seed sẽ là `["stroke_svg"]`); API `GET /v1/kanji/:literal` trả mảng đó.
  Nó **không chứa file** — file nằm ngoài DB theo `media_asset.object_key`. Muốn FE **xem được ảnh nét**
  phải có thêm **route đọc media** (backend): đọc `object_key` qua storage rồi trả file (hoặc signed URL).
  → Đề xuất tách việc companion **"serving media"** (sửa `src/**` — người tích hợp duyệt riêng), không gộp
  vào DB3-A; nếu seed trước mà chưa có route thì UI chỉ biết "có nét" chứ không hiển thị được.
- **Rủi ro**: 11k dòng + file (thời gian chạy, dung lượng); FK `kanji_media → kanji` (RESTRICT với asset);
  chưa có route phục vụ file (xem mục trên).

### 4.2 A2 — Radical 214 (`public.radical`)

- **Schema**: không có cột provenance → rollback theo `number` 1..214 (ghi manifest đủ 214 khóa) và
  **không thể phân biệt nguồn trong bảng**; attribution ghi ở `public.source` + docs.
- **Nguồn đã xác định online (05/10, không cần LLM):**
  1. **Unicode `CJKRadicals.txt`** (Unicode License v3; bản tải: v18.0.0, 2026-02-03) —
     mapping `number ↔ radical char (U+2F00…) ↔ unified ideograph`. **Đã validate: đủ 214 dòng**
     (ví dụ `85; 2F54; 6C34` = bộ 85, ký tự bộ 氵/U+2F54, chữ hợp nhất 水).
  2. **vi.wikipedia "Bộ thủ Khang Hi"** (CC BY-SA — ghi attribution) — bảng **214/214 dòng**, mỗi dòng có:
     số bộ · ký tự + **biến thể trong ngoặc** (ví dụ `水 (氺,氵)`) · tên Hán-Việt (`Thủy`) ·
     pinyin · âm Nhật/Hàn · **nghĩa tiếng Việt** (`Nước`). Đây là nguồn cho `character`, `variants`,
     `name_vi` *(chuẩn hoá tiền tố "bộ " theo văn phong demo)* và `meaning_vi`.
  3. **Unicode Unihan** (`Unihan_IRGSources.txt`, `kTotalStrokes` của chữ hợp nhất) — nguồn `stroke_count`.
     Cần tải (Unihan.zip, Unicode License v3).
  4. `name_en`: **để trống giai đoạn đầu** (nullable) hoặc bổ sung sau từ nguồn EN — không chặn seed.
- **Việc chuẩn bị nguồn (do người tích hợp/ops, không phải phiên này):** tải 2–3 file raw trên vào
  `data-Langoo/downloads/extras/` (kèm ghi chú URL + license + sha256 như manifest hiện hành);
  script DB3-A chỉ **đọc raw → hợp nhất** (không tự tải mạng khi chạy seed).
- **Quy tắc hợp nhất & kiểm tra (dry-run trước):**
  - `character`/`number` lấy từ CJKRadicals (chuẩn máy); đối chiếu với vi.wiki (lệch → cảnh báo, không tự chọn).
  - `variants` parse từ ngoặc vi.wiki; **đối chiếu** `core.kanji_radical.part` (253 parts) → báo cáo
    part không map được cho người review; **không tự suy mapping** từ chuỗi bộ phận.
  - `stroke_count`: join theo chữ hợp nhất; thiếu → để NULL + đếm vào báo cáo (không bịa).
  - `name_vi`: chuẩn hoá "bộ X" (chốt style a-i); `meaning_vi`: giữ nguyên nghĩa ngắn từ vi.wiki.
  - Kết quả trung gian xuất ra JSON có `source`/`version`/`sha256` từng nguồn — đây là input cố định
    cho seed (chạy lại cho cùng kết quả nếu raw không đổi).
- **File nguồn**: đề xuất thêm 1 file hợp nhất vào `downloads/extras/` của data-Langoo
  (`kangxi-radicals.json`) — **việc của người tích hợp** (phiên này không sửa thư mục dữ liệu);
  plan ghi rõ cấu trúc file + trường bắt buộc (kèm `source.url`/`license`/`version`).
- **Upsert**: `ON CONFLICT (number) DO UPDATE` các cột nội dung — **trừ** khi tương lai có cờ curated
  (chưa có; nếu cần → migration do người tích hợp chốt).
- **Kiểm chứng**: `count(*) = 214`; `character` UNIQUE; join `kanji_card` hiển thị đủ 4 field cho ≥ 100 chữ mẫu;
  rà `kanji_radical.part` không map được → báo cáo (không tự sửa dữ liệu nguồn).
- **Rollback**: `DELETE FROM public.radical WHERE number BETWEEN 1 AND 214` theo manifest (chỉ khi bảng
  đúng 214 dòng do run này tạo; nếu đã có dữ liệu khác → dừng, không xóa).
- **Rủi ro**: license/tên VI; variants sai làm join KRADFILE lệch; không có provenance (audit khó về sau).

### 4.3 A3 — Deck hệ thống (`core.deck`, `core.deck_item`)

- **Nguồn**: `jlpt_link` (accepted; 7.285 lexeme, 100% có sense `is_primary`, avg 2,09 sense/lexeme)
  + `lexeme.frequency_rank` để sắp thứ tự; `concept_id` để NULL (DB4 nối sau).
- **Đề xuất mặc định (chờ chốt b)**:
  - 5 deck `jlpt-n1…jlpt-n5`, `language_id = 2` (ja), `level_label = 'N1'…'N5'`,
    `is_published = false` (review rồi mới bật).
  - Mỗi lexeme accepted → **1 item**, `anchor_sense_id` = sense `is_primary` của lexeme;
    thứ tự `position` theo `frequency_rank` (NULL cuối) rồi `lexeme_id`.
  - Lexeme nằm nhiều cấp JLPT: đề xuất **chỉ vào cấp thấp nhất** (N5 < N4 < … < N1) — cần chốt.
  - `item_count` cập nhật trong cùng transaction sau khi chèn.
- **Upsert**: deck theo `slug`; deck_item theo PK `(deck_id, anchor_sense_id)` (`DO UPDATE position`).
- **Kiểm chứng**: số item = số lexeme quyết định; không trùng anchor trong deck; `item_count` khớp
  `count(*)`; chạy lần 2 → không đổi.
- **Rollback**: `DELETE deck_item` theo deck_id (manifest), `DELETE deck` theo slug; FK từ `app.collection`
  (`cloned_from_deck_id`, ON DELETE SET NULL) nên an toàn cho user đã clone.
- **Rủi ro**: tiêu chí sản phẩm (số lượng/lọc) chưa chốt; anchor sai nghĩa (primary có thể không phải
  nghĩa thông dụng — đánh dấu để M14/DB4 cải thiện); kích thước deck lớn (7k item) — chèn theo lô.

### 4.4 A4 — JLPT audit (read-only)

- Không ghi gì. Script `verify-jlpt` (đọc-only) tái lập các số trong báo cáo kiểm kê:
  rows/lexeme/accepted theo cấp, lexeme nhiều cấp, `lexeme_level` ↔ `jlpt_link` khác biệt,
  accepted nhưng thiếu sense (kỳ vọng 0).
- Đầu ra: in bảng + ghi `artifacts/db3/...json` để so sánh giữa các lần chạy.

### 4.5 A5 — Credits audit (`public.source`)

- Không ghi mặc định. `credits-audit` in diff các field thiếu + danh sách đề xuất bổ sung.
- Nếu chủ dự án chốt license thật cho `kanji-data`/`jlpt-list` (+ version cho `omw-wikt-vi`),
  làm **một seed nhỏ có duyệt riêng** dạng `--apply --allow-db …` với manifest giá trị cũ để rollback
  (không gộp vào run radical/kanji để tách rollback).

## 5. Tooling & bàn giao (sau khi DB3-A được duyệt)

- Thư mục: `scripts/db3/` (Node/TypeScript, dependency sẵn có — `tsx`, `pg`/`@prisma/client`;
  **không thêm dependency**, không sửa `package.json`; chạy `npx tsx scripts/db3/<file>.ts --dry-run`).
- Cấu trúc đề xuất:
  ```
  scripts/db3/
    _shared.ts          # guard DB đích, dry-run, batch, manifest, đọc env
    radicals.ts         # A2
    kanjivg.ts          # A1
    decks.ts            # A3
    verify-jlpt.ts      # A4 (read-only)
    credits-audit.ts    # A5 (read-only)
    fixtures/*.json     # mẫu nhỏ (3 kanji, 5 radical, 1 deck) để test local
    README.md           # cách chạy + ví dụ dry-run/apply
  ```
- Test local (fixture `langoo_parallel_deepseek_test`):
  1. `--dry-run` in kế hoạch, không ghi;  2. `--apply --allow-test` trên fixture;  3. chạy lần 2 → count không đổi;
  4. query kiểm chứng §4.x;  5. rollback theo manifest → về trạng thái trước.
- Apply lên DB thật (local full / production) là **bước vận hành riêng** do người tích hợp chạy
  (`--apply --allow-db langoo`), có review manifest trước/sau; không nằm trong CI.
- Không deploy, không push, không migration production trong phạm vi phiên này.

## 6. Tiêu chí nghiệm thu DB3-A

- [ ] 4 script chạy dry-run được, không ghi DB khi thiếu `--apply`.
- [ ] Trên fixture: chạy 2 lần không tạo bản sao (radical = 214, kanji_media ổn định, deck item ổn định).
- [ ] Manifest + rollback hoạt động (rollback xong count về 0).
- [ ] Query kiểm chứng trong §4 chạy được và có kết quả lưu lại.
- [ ] README `scripts/db3` hướng dẫn chạy; không sửa `src/**`, migrations, `PROGRESS.md`.

## 7. Rủi ro chung

- License/nguồn gốc (radical, KanjiVG, 2 nguồn "CẦN XÁC MINH") — cần người chốt trước khi seed.
- `public.radical` và `core.deck/deck_item` không có cột provenance/batch → rollback dựa manifest file;
  nếu manifest mất, rollback phải thủ công (đã ghi rõ trong README).
- Media chưa có route phục vụ file → seed xong UI mới thấy metadata; đừng kỳ vọng ảnh nét ngay.
- Dữ liệu JLPT/deck chỉ đúng trong phạm vi nguồn `jlpt_link accepted`; nghĩa anchor là "tạm" cho tới DB4/M14.
