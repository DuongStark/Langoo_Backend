# Langoo — Ngữ cảnh toàn dự án

> **Mục đích:** một LLM hoặc dev mới, đặt trong thư mục trắng, đọc file này là hiểu sâu toàn bộ dự án:
> sản phẩm, kiến trúc, dữ liệu, CSDL, quy ước thiết kế và lộ trình — **không cần đọc tài liệu nào khác**.
> **Cập nhật:** 2026-09-24 · **Trạng thái:** CSDL đã đủ để code backend; tầng từ điển đang hoàn thiện chất lượng.
> **Bộ tài liệu tự chứa (chỉ cần mang 3 file này sang folder mới):** `README.md` (điểm vào + lệnh),
> `CONTEXT-DU-AN.md` (file này — toàn bộ ngữ cảnh), `CSDL-THAM-CHIEU.md` (đặc tả cột/FK/index đầy đủ, sinh tự động).

---

## 0. Bộ tài liệu tự chứa

**Quy tắc agent hiện hành (06/10/2026):** đọc [AGENTS.md](AGENTS.md) và
[PROGRESS.md](PROGRESS.md) khi làm trong repo này. Mỗi việc có mã + tên rõ ràng
(`M10.1`, `DB4-D1`…); mọi thay đổi code phải lưu cùng ghi nhận thay đổi, kết quả
kiểm tra và trạng thái Git/triển khai trong tài liệu repo. Đây là bổ sung quy trình
cho bộ tài liệu thiết kế dưới đây.

Khi bắt đầu ở folder/context mới (trắng), chỉ cần mang **3 file**:

| File | Nội dung | Vai trò |
|------|----------|---------|
| `README.md` | Trạng thái, bắt đầu nhanh, quy tắc vàng | Điểm vào |
| `CONTEXT-DU-AN.md` (file này) | Toàn bộ ngữ cảnh: sản phẩm, kiến trúc, dữ liệu, CSDL theo tầng, quy ước, luồng nghiệp vụ, API, lộ trình, thuật ngữ | **Đọc đầu tiên** |
| `CSDL-THAM-CHIEU.md` | Đặc tả từng bảng/cột/kiểu/FK/index/ràng buộc/số dòng — sinh tự động từ DB | Tra cứu chi tiết |

Mọi thứ cần để hiểu và code backend đều đã nằm trong file này: đặc tả 8 chức năng (§1.2), mô hình
từ điển 3 tầng (§4), quy ước thiết kế (§5), mô tả toàn bộ 92 bảng + 4 view theo tầng (§6),
luồng nghiệp vụ (§7), ánh xạ API gợi ý (§8), nguồn dữ liệu & giấy phép (§9), script (§10),
vận hành dev (§11), lịch sử migration (§12), lộ trình (§13), quyết định mở (§14), thuật ngữ (§15).

Các file HTML/MD gốc trong repo (`chucnang.html`, `thiet-ke-csdl-tu-vung-v2.html`,
`KE-HOACH-MAP-DU-LIEU.md`…) chỉ là tài liệu lịch sử/chi tiết hơn — **không bắt buộc** và
không cần mang theo khi chuyển folder.

**Quy ước số migration:** file `db/migrations/NNN_tên.sql` chạy tuần tự theo tên;
`scripts/apply_migrations.py` ghi tên đã chạy vào `public.schema_migration`.
Hiện đã chạy **001–027 và 029–032** (số **028** để trống, dành cho đợt B xác thực email M2.3); số tiếp theo là **033**. Không sửa file đã chạy.

---

## 1. Dự án là gì

### 1.1 Tóm tắt

**Langoo** là ứng dụng học ngoại ngữ (Anh – Nhật) cho người Việt, lấy từ điển đa ngữ làm lõi:
tra từ, phân tích Hán tự, lưu sổ tay, ôn flashcard/SRS, AI chatbot, AI quiz, gamification.
Điểm khác biệt kỹ thuật: **liên kết Anh–Nhật nằm ở cấp nghĩa (sense) thông qua concept phi ngôn ngữ
neo vào CILI/WordNet**, không phải cấp từ — nên một từ tiếng Anh nhiều nghĩa sẽ ghép đúng từng
nghĩa tiếng Nhật tương ứng.

- **CSDL:** PostgreSQL 16+, 5 schema, **92 bảng + 4 view** (chưa kể 36 partition), ~8 GB dev.
- **Backend dự kiến:** NestJS 9 module (đặc tả ở §1.2); CSDL hiện đã sẵn cho toàn bộ.
- **Người dùng mục tiêu:** người Việt học tiếng Anh hoặc tiếng Nhật; chế độ song ngữ Anh–Nhật là
  chế độ nâng cao (chỉ bật khi concept đã được duyệt).

### 1.2 Tám chức năng (đặc tả đầy đủ — tổng hợp từ tài liệu yêu cầu gốc)

| # | Chức năng | Nội dung chính | Phase | Module NestJS |
|---|-----------|----------------|-------|----------------|
| 1 | Tra từ điển | Tra Anh–Việt, Nhật–Việt (kanji/kana/romaji), audio, lịch sử 50 từ, lưu vào sổ tay; tách từ thành Hán tự, bộ thủ, số nét/thứ tự viết, On–Kun, nghĩa từng chữ, JLPT từng chữ | 1 (P2: từ khác dùng chung chữ) | `dictionary` |
| 2 | Collection & Flashcard | Tạo/quản lý bộ sưu tập, thêm từ (tra, nhập tay, clone bộ hệ thống), ghi chú, tag, tìm trong sổ tay; entry = 1 nghĩa tiếng Việt + tuỳ chọn EN/JA; ôn flashcard trực tiếp; chia sẻ (P2) | 1 | `collections` |
| 3 | SRS | SM-2 → FSRS, Again/Hard/Good/Easy, lưu interval/ease/next_review, màn "cần ôn hôm nay", thống kê | 1 | `srs` |
| 4 | Nhiều chế độ ôn | Flashcard, trắc nghiệm, ghép thẻ, viết lại; nghe–chọn (P2) | 1 | `review-modes` |
| 5 | Nhắc nhở hằng ngày | Giờ nhắc, bật/tắt, push (FCM/APNs), email, nhắc thông minh (P2) | 1 | `reminders` |
| 6 | AI Chatbot | Hỏi nghĩa/ngữ pháp/cách dùng, luyện hội thoại theo tình huống, lưu lịch sử, chọn ngôn ngữ | 1 | `ai/chatbot` |
| 7 | AI Quiz | Sinh câu hỏi từ vốn từ đã học, chọn dạng/độ khó/số lượng, chấm điểm, lưu lịch sử, AI giải thích (P2) | 1 | `ai/quiz-generator` |
| 8 | Gamification | XP (ôn +1, quiz đúng +5), streak, huy hiệu, thống kê cá nhân; leaderboard tuần (P2), realtime (P3) | 1 | `gamification` |

### 1.3 Quyết định sản phẩm đã chốt (không được vô hiệu hoá khi code)

1. **Không có bảng `cards`.** Flashcard là một chế độ đọc của collection — dữ liệu ghim ở
   `app.collection_item` + `app.collection_item_face`, lịch ôn ở `app.srs_state`.
2. **Liên kết liên ngữ ở cấp nghĩa.** Không lưu cặp `en_ja_pairs`; cặp sinh từ
   hai sense cùng trỏ một `concept`. Gloss (chuỗi mô tả nghĩa) **không phải** lexeme.
3. **Không bao giờ "add một từ" bằng chuỗi.** Client gửi `sense_id` (khi lưu) và
   `face_id` + `direction` (khi ôn); server không đoán nghĩa.
4. **Song ngữ là cờ của hồ sơ học** (`study_profile.secondary_language_id`), không phải chế độ mặc định.
5. **Chất lượng có cổng:** mọi thứ hiển thị cho người học từ concept phải qua `status='curated'`;
   gloss máy phải có badge "chưa kiểm duyệt" + nút báo lỗi (`app.gloss_report`).
6. **SRS tách theo mặt và chiều:** mỗi `face` có 2 lịch (`recognize`, `recall`) độc lập.
7. **XP/streak append-only:** sổ cái `app.xp_event` + `app.streak_day`; `app.user_stats` là cache.

---

## 2. Trạng thái hiện tại (2026-09-24)

### 2.1 Đã có

| Hạng mục | Số liệu |
|----------|---------|
| **Schema** | `public` (5 bảng) · `staging` (14) · `core` (41) · `app` (32) · `serve` (4 view) |
| **Migration** | 001–025 đã chạy (xem §12) |
| **Ngôn ngữ** | en (id 1) · ja (2) · vi (3) · zh-Hans (4) — id nhớ theo bảng này |
| **Nguồn dữ liệu** | 16 dòng `public.source` |
| **Từ vựng** | 2.375.240 lexeme · 2.917.954 sense (wiktextract 1.744.214 · jmdict 218.794 · oewn 161.646 · omw-en 156.584 · omw-ja 94.002) |
| **Concept** | 120.875 concept (ILI) · 577.525 `sense_concept` (toàn bộ từ WordNet) |
| **Cặp en↔ja thô** | 57.184 concept có sense cả en lẫn ja (chưa concept nào curated) |
| **Kanji** | 13.108 chữ · 54.321 liên kết bộ phận · 588.916 liên kết chữ-trong-form |
| **Ví dụ** | 3.512.695 câu · 872.814 cạnh dịch (ja↔en 280.513 · en↔vi 23.133 · ja↔vi 8.477) |
| **Phát âm** | 609.858 (IPA 459.404 · audio 150.454) |
| **Gloss** | `sense_gloss` 443.328 (toàn bộ tiếng Anh từ JMdict) · `concept_gloss` 196.901 (vi 5.368) |
| **JLPT** | `lexeme_level` 7.810 dòng; `jlpt_link`/`source_form`/`example_*` còn trống (chờ chạy mapping) |
| **Tầng app** | 32 bảng đã tạo, sẵn FK/index/trigger; có seed demo |

### 2.2 Chưa có (đừng tưởng là lỗi)

- **Concept curation:** 120.875/120.875 concept đang `draft` → `serve.sense_pair` rỗng;
  tính năng song ngữ "tự ẩn" (đúng thiết kế).
- **Gloss tiếng Việt cấp sense:** cần pipeline (chuyển lemma OMW sang `concept_label`, sinh gloss vi
  theo concept, trải xuống `sense_gloss`). Trước khi xong, nghĩa tiếng Việt hiển thị lấy từ
  `collection_item.meaning_vi` (người dùng tự nhập) hoặc gloss EN + badge.
- **Bộ thủ:** bảng `public.radical` đã tạo nhưng **chưa seed 214 dòng** (tên/ý nghĩa tiếng Việt).
- **Media thứ tự nét:** bảng `core.media_asset`/`core.kanji_media` đã tạo, chưa nạp KanjiVG.
- **`core.deck`/`core.deck_item`:** đã tạo, chưa seed bộ từ hệ thống.
- **Index tìm kiếm:** DB2 đã làm — `pg_trgm` + 4 GIN trigram (033) và `core.bigrams` + 4 GIN
  bigram (035, chạy cả trên PG nhúng); tra **không dấu** (`unaccent`) vẫn chờ dữ liệu VI.
- **Mapping nội dung 011–014:** bảng đã tạo nhưng chưa chạy `scripts/run_mapping.py`
  (jlpt, examples, translations, relations).
- **Backend/frontend:** chưa có mã ứng dụng (chỉ có `app/server.py` — UI xem dữ liệu staging, không phải app).

### 2.3 Dữ liệu demo

`scripts/seed_app_dev.py` đã tạo (chạy lại bằng `--reset`):

| Thứ | Giá trị |
|-----|---------|
| User | `demo@langoo.local` (id 5, mật khẩu placeholder) |
| Profile | Nhật–Việt (ja primary, en secondary, vi support) |
| Collection | "JLPT N5 — bộ mẫu" — 11 từ thật lấy từ `core` |
| SRS | 24 lịch ôn (12 face × 2 chiều), 4 thẻ đến hạn |
| Hoạt động | 5 ngày gần nhất, 26 XP, streak 5, 30 lượt ôn |
| Khác | 1 quiz 3 câu · 1 chat 4 tin · 1 reminder 20:00 · 3 search history · 1 share link |

---

## 3. Kiến trúc hệ thống

### 3.1 Năm schema và vai trò

| Schema | Vai trò | Tính chất | Ghi chú vận hành |
|--------|---------|-----------|------------------|
| `public` | metadata dùng chung | gần bất biến | language một nguồn sự thật cho id ngôn ngữ; source dùng sinh trang /credits |
| `staging` | dump thô 1-1 với nguồn | bất biến theo batch | giữ payload JSON + id gốc → tái transform không cần tải lại |
| `core` | từ điển chuẩn hoá + concept + mapping | read-heavy, gần bất biến | có thể tách read replica; import idempotent theo `external_id` |
| `app` | dữ liệu người học | write-heavy | PK uuid v7 do app sinh; cascade theo users; partition review_log |
| `serve` | read model | refresh định kỳ | matview `sense_pair` có cổng curated |

### 3.2 Sơ đồ dòng dữ liệu

```
downloads/  (dump gốc bất biến + manifest.json sha256)
   │  scripts/stage_*.py   — parse 1-1, KHÔNG chuẩn hoá
   ▼
staging.*   (payload jsonb + id gốc + batch_id)
   │  scripts/import_core.py  — chuẩn hoá, khớp, upsert theo khoá tự nhiên
   ▼
core.*      (lexeme/sense/concept/kanji/example/pronunciation + mapping run/candidate)
   │  scripts/run_mapping.py — candidate, review, assert, accept có kiểm định
   │  (LLM gloss vi, curate concept — các bước nội dung tiếp theo)
   ▼
serve.*     (sense_pair matview + sense_card/kanji_card/dictionary_search view)
   ▲
app.*  ─────┘  (người học ghi/đọc; chỉ tham chiếu core qua FK, không bao giờ ngược lại)
```

### 3.3 Quy tắc phụ thuộc (bất di bất dịch)

1. `core` **không** tham chiếu `app` — nạp lại/duyệt lại từ điển không được ảnh hưởng dữ liệu người học.
2. FK từ `app` sang `core` đều `ON DELETE RESTRICT` (sense/concept/kanji) — xoá nội dung core
   không được kéo theo dữ liệu người dùng.
3. FK trong `app` cascade theo người dùng (`users` → mọi thứ) để xoá dữ liệu theo yêu cầu.
4. Re-import không bao giờ DELETE+INSERT bảng core có dữ liệu người dùng trỏ tới; luôn upsert
   theo `external_id` (`jmdict:1402540`, `jmdict:1402540:1`, `tatoeba:162365`, `wikt:<id>`, `wn:<id>`).
5. Điều kiện upsert loại trừ dòng đã duyệt (`reviewed_by IS NOT NULL`, `verified = true`).

---

## 4. Mô hình từ điển 3 tầng (phải hiểu trước khi code)

### 4.1 lexeme → sense → concept

```
concept (phi ngôn ngữ, neo CILI)
  i35545  "di chuyển nhanh bằng chân"
      ▲                            ▲
      │ sense_concept (confidence, method, verified)
      │
sense run #1                     sense 走る #1
      ▲                            ▲
lexeme "run" (en)                lexeme "走る" (ja)
```

- **lexeme**: một mục từ của một ngôn ngữ (`run`, `走る`, `chạy`). Có `lemma` (dạng đầu mục),
  `reading` (kana), `pos` (taxonomy chuẩn hoá 15 giá trị), `homograph_no` để tách đồng hình.
- **sense**: một nghĩa của lexeme. `definition` là định nghĩa *cùng ngôn ngữ lexeme*
  (thực tế với Wiktextract có thể khác — xem `definition_language_id`).
- **concept**: khái niệm phi ngôn ngữ, neo `ili` (CILI, dạng `i35545`), có `status`
  `draft → review → curated → rejected`. **Chỉ `curated` mới được hiển thị.**
- **sense_concept**: n-n có `relation` (`exact/broader/narrower/related`), `confidence`,
  `method` (`wordnet_synset`, `omw`, `gloss-match`, `llm`, `manual`…), `verified` (chỉ người duyệt),
  `mapping_run_id` (truy vết theo lần chạy), `decided_at`.

Ví dụ chuẩn: từ `run` có 4 nghĩa → 4 concept; nghĩa "điều hành" trỏ về `経営する`, không phải `走る`.
Nối ở cấp từ sẽ hỏng ngay — đây là lý do toàn bộ mô hình.

### 4.2 gloss ≠ lexeme (quy tắc vàng)

Gloss tiếng Anh trong JMdict ("to run") là **văn bản mô tả nghĩa** của từ tiếng Nhật, không phải
một mục từ tiếng Anh: không có id, phiên âm, chia động từ. Vì vậy không join thẳng gloss sang phía
tiếng Anh; phải khớp mờ (gloss-match) hoặc đi qua concept.

### 4.3 ILI/CILI và PWN offset

- **CILI/CILI (`i35545`)**: mã khái niệm liên ngữ ổn định — dùng làm khoá ngoài của `concept`.
- **PWN 3.0 offset (`00001740-n`)**: khoá *gián tiếp* của Princeton WordNet — khác nhau giữa các
  phiên bản/ngôn ngữ, chỉ là cầu nối trung gian (`staging.ili_map_pwn30` quy đổi offset → ILI).
- Concept tự tạo (từ lóng, đặc thù tiếng Nhật) có `ili = NULL` và `status='curated'` khi được duyệt.

### 4.4 Tầng kanji

| Bảng | Vai trò |
|------|---------|
| `core.kanji` | Một dòng/chữ: `literal` PK, số nét, grade, tần suất, JLPT cũ (`jlpt_old`) & mới (`jlpt_new`), âm (on/kun/Hán-Việt/pinyin) trong `readings`, nghĩa trong `meanings`, `nanori`, mã tra cứu |
| `core.kanji_radical` | Tách bộ phận theo KRADFILE (253 cấu kiện; **không** phải 214 bộ Kangxi) |
| `public.radical` | 214 bộ Kangxi + tên/ý nghĩa tiếng Việt (chưa seed) |
| `core.lexeme_form_kanji_char` | Chữ nào xuất hiện ở vị trí nào trong form kanji — nguồn cho "tách từ thành Hán tự" và "từ khác dùng chung chữ" |
| `core.lexeme_form_char` | Mọi ký tự của mọi form (kể cả kana/số/dấu câu) — cho phân tích ký tự đầy đủ |
| `core.kanji_media` + `core.media_asset` | Ảnh/GIF thứ tự viết (KanjiVG, chưa nạp) |

Cạm bẫy dữ liệu đã kiểm chứng: 354 chữ trong JMdict không có ở KANJIDIC2, 413 không có ở KRADFILE →
mọi join phải LEFT JOIN; KRADFILE không đệ quy hoàn toàn (阿 → có cả `阡` là cấu kiện trung gian).

### 4.5 Chất lượng dữ liệu

Ba lớp bảo vệ được thiết kế sẵn — code backend phải tôn trọng:

1. **Cổng curated** ở `serve.sense_pair` (chỉ concept `curated` + confidence ≥ 0.7).
2. **Dấu máy/người** trên gloss: `sense_gloss.is_machine`, `reviewed_by`, `quality` 0–100;
   hiển thị badge khi `is_machine AND reviewed_by IS NULL`.
3. **Báo lỗi người dùng** `app.gloss_report` — kênh kiểm duyệt duy nhất khi chưa có người duyệt nội bộ.

---

## 5. Quy ước thiết kế xuyên suốt

1. **ID:** `bigint identity` cho thực thể nội bộ/nóng (users, log, srs_state, message…);
   `uuid` cho thực thể client-visible/sync (collection, item, face, session, quiz, chat, reminder…).
   App sinh **uuid v7** (`scripts/seed_app_dev.py::uuid7` là generator mẫu); `DEFAULT gen_random_uuid()`
   trên DB chỉ là lưới an toàn cho thử nghiệm.
2. **Ngôn ngữ:** id ngôn ngữ nhớ cố định **1=en, 2=ja, 3=vi, 4=zh-Hans**. Mọi bảng nội dung đều
   có `language_id`; thêm ngôn ngữ mới = thêm dữ liệu, không đổi schema.
3. **Thời gian:** `timestamptz` UTC; "ngày học" (streak, daily cap) tính theo timezone người dùng
   (`app.user_settings.timezone`, mặc định `Asia/Ho_Chi_Minh`).
4. **Idempotency:** mọi luồng ghi có thể retry phải có khoá chống trùng:
   `xp_event(user_id, idempotency_key)`, `notification_log(reminder_id, idempotency_key)`.
5. **Append-only:** `review_log`, `xp_event`, `streak_day` là sự thật; `srs_state`, `user_stats` là cache.
6. **Không có bảng cards:** xem §1.3.
7. **Face:** một mặt ngôn ngữ của entry; `UNIQUE(item, language_id)` — thêm mặt mới (zh/ko) là thêm dòng.
8. **Partition:** `review_log` theo tháng; tạo trước bằng `app.ensure_month_partition(m)`; 36 tháng
   đã tạo (2026-09 → 2029-08). `srs_state` chỉ partition khi vượt ~50 triệu dòng (HASH theo face_id —
   khoá `(face_id, direction)` đã chứa partition key nên giữ nguyên được).
9. **Ràng buộc xuyên bảng do service kiểm:** ví dụ `collection_item_face.language_id` phải khớp
   ngôn ngữ của `sense_id` — DB không ép được, service phải kiểm khi ghi.
10. **Xoá dữ liệu:** xoá `users` cascade toàn bộ dữ liệu học tập; `review_log.srs_id` là
    `ON DELETE SET NULL` để giữ lịch sử khi face bị xoá.
11. **Migration:** mỗi file một mục đích, chạy trong 1 transaction, **không** dùng
    `IF NOT EXISTS` cho bảng (để phát hiện schema trôi). Sửa schema = thêm file mới.
12. **Search:** DB2 (033/035) đã có trigram + bigram; tra **không dấu/giống âm** (`unaccent`)
    để dành khi có gloss VI. PG nhúng thiếu contrib — migration tự guard, bigram vẫn chạy.

---

## 6. CSDL theo tầng

> Phần này mô tả bảng theo **vai trò**. Đặc tả cột/kiểu/FK/index từng bảng: xem `CSDL-THAM-CHIEU.md`.

### 6.1 `public` — metadata dùng chung (5 bảng)

| Bảng | Vai trò |
|------|---------|
| `language` | 4 ngôn ngữ; `is_target` (học được: en/ja/zh), `is_support` (giải nghĩa: vi) |
| `source` | 16 nguồn dữ liệu: license, attribution (cho trang /credits), url, version, sha256 |
| `tag` | 266 mã gốc JMdict → `kind` (pos/misc/field/dialect/kanji/kana), `pos_norm` (15 giá trị chuẩn), `domain_vi` |
| `radical` | 214 bộ Kangxi + tên/ý nghĩa tiếng Việt (**chưa seed**) |
| `schema_migration` | Nhật ký migration đã chạy (do `apply_migrations.py` quản lý) |

### 6.2 `staging` — dump thô (14 bảng)

Nhóm Nhật: `jmdict_entry` (218.794 — payload nguyên entry: kanji/kana/sense/gloss/examples),
`kanji_entry` (13.108), `krad_entry` (12.156), `jlpt_entry` (7.972), `kanji_data_entry` (13.108).

Nhóm WordNet: `wn_synset` (295.473; khoá `(lexicon, synset_id)`, cột `ili`), `wn_relation` (582.498),
`wn_example` (127.251).

Nhóm Wiktextract: `wikt_entry` (1.744.216; `lang_code`, `word`, `pos`, payload **đã trim**: chỉ giữ
senses/glosses/translations en-ja-vi, `sounds`, `forms`).

Nhóm Tatoeba: `tatoeba_sentence` (2.319.079), `tatoeba_link` (872.814).

Nhóm tiếng Việt: `ili_map_pwn30` (117.659 — cầu PWN30 → ILI), `omw_wikt_vi` (5.498 — lemma Việt theo offset).

Điều phối: `import_batch` (16 batch: sha256, row_count, status, error).

### 6.3 `core` — từ điển chuẩn hoá (41 bảng)

Nhóm **lexeme & form**: `lexeme` (2.375.240), `lexeme_form` (499.183 — kanji/kana với `is_common`,
`form_order`), `lexeme_form_tag`, `lexeme_form_applies_to` (kana ↔ kanji), `lexeme_form_kanji_char`
(588.916), `lexeme_form_char`, `source_form` (form Wiktextract — chờ chạy), `sense_form`,
`sense`, `sense_tag`, `sense_gloss`, `sense_gloss_history` (audit trigger).

Nhóm **concept**: `concept` (120.875, `status`), `concept_gloss`, `concept_label`, `concept_gloss_history`,
`sense_concept` (577.525), `wordnet_synset` (295.473 — danh tính synset gốc), `wordnet_relation` (582.498).

Nhóm **kanji**: `kanji`, `kanji_radical`, `kanji_media`, `media_asset`.

Nhóm **ví dụ & phát âm**: `example` (3.512.695), `example_translation`, `example_annotation`,
`example_sense`, `example_concept`, `pronunciation` (609.858).

Nhóm **trình độ & bộ từ**: `lexeme_level` (7.810 — JLPT), `jlpt_link`, `deck`, `deck_item` (deck chưa seed).

Nhóm **mapping/provenance** — nơi lưu vết quá trình nối dữ liệu thay vì ghi thẳng vào bảng liên kết:

| Bảng | Vai trò |
|------|---------|
| `mapping_run` | Một lần chạy mapping: task, algorithm, model, prompt_version, tham số, số liệu (seen/accepted/rejected/unresolved), trạng thái — **đơn vị rollback** |
| `source_entry_identity` | Crosswalk bền vững giữa khoá nguồn (`wikt:<id>`, `jmdict:<id>`, `oewn:<id>`) và `core.lexeme`; dùng để phát hiện thêm/xoá/đổi khi nạp snapshot mới |
| `sense_concept_candidate` + `sense_concept_candidate_review` | Ứng viên nối sense↔concept (score, evidence, llm_result, decision `pending/accepted/rejected/stale/uncertain`) + nhiều lượt đánh giá LLM/người không ghi đè nhau |
| `sense_relation` + `sense_relation_candidate` | Quan hệ nghĩa↔nghĩa khi chưa có concept phù hợp (`equivalent/related/antonym/broader/narrower`), có hướng + chứng cứ |
| `translation_assertion` + `translation_target_candidate` | Khẳng định bản dịch của nguồn (entry/sense, ngôn ngữ đích, nguyên văn, sense_hint) + phân giải về lexeme/sense đích |
| `jlpt_link` | Mọi dòng JLPT nguồn với trạng thái `accepted/ambiguous/unmatched/pattern/rejected` — giữ cả xung đột |

**Nguyên tắc bốn lớp (không được trộn):**

```
1. NGUỒN            staging.* + sha256 + batch_id            — dữ kiện thô, bất biến
2. KHẲNG ĐỊNH NGUỒN translation_assertion, jlpt_link,       — nguồn NÓI gì (chưa chứng minh đích)
                    example_annotation
3. ỨNG VIÊN         *_candidate + *_candidate_review        — có điểm + chứng cứ, KHÔNG hiển thị
4. LIÊN KẾT         sense_concept, sense_relation           — đã chấp nhận, có provenance + run id
   CHẤP NHẬN        (+ verified cho duyệt người)
```

Quy tắc áp dụng: chỉ tự ghi liên kết khi vượt ngưỡng kiểm định; `verified = true` **chỉ** dành cho
người duyệt từng dòng — LLM/thuật toán luôn ghi `verified = false` kèm `method`, `score`, `evidence`
và `mapping_run_id`; mọi accepted row thuộc một run để rollback theo lô; từ chối cũng phải lưu
(decision `rejected`) để lần sau không đề xuất lại. Ứng dụng **chỉ đọc** lớp 4 (và chỉ concept
`curated`), không bao giờ đọc candidate.

### 6.4 `app` — người học (32 bảng)

#### Nhóm xác thực & hồ sơ (migration 017)

| Bảng | Cột chính | Quy tắc |
|------|-----------|---------|
| `users` | id (bigint identity), email, display_name, status (active/locked/deleted), deleted_at | unique `lower(email)`; xoá mềm + ẩn danh hoá khi cần |
| `user_identity` | user_id, provider (password/google/apple), provider_uid, password_hash, email_verified_at | UNIQUE(provider, provider_uid); CHECK: chỉ provider='password' mới có hash |
| `user_session` | user_id, device_id, refresh_token_hash, expires_at, revoked_at | chỉ lưu hash; index `(user_id, expires_at) WHERE revoked_at IS NULL` |
| `device` | platform, push_provider, push_token, revoked_at | unique token sống; FCM "unregistered" → set revoked_at |
| `study_profile` | primary/secondary/support_language_id, is_default | mỗi user tối đa 1 default (partial unique); 3 ngôn ngữ phải khác nhau (CHECK) |
| `user_settings` | timezone (default Asia/Ho_Chi_Minh), daily_goal, notify jsonb, active_profile_id | trigger `updated_at`; nguồn duy nhất cho quy đổi "ngày học" |
| `search_history` | raw_query, normalized, language_id, matched_sense_id, result_count | index `(user_id, created_at DESC)`; job dọn còn 50 dòng/user |
| `gloss_report` | target_kind (sense_gloss/concept_gloss/example/translation), target_id text, issue, status | `target_id` là chuỗi (gloss có thể bị thay khi re-import); index hàng chờ |

#### Nhóm collection (migration 018)

| Bảng | Cột chính | Quy tắc |
|------|-----------|---------|
| `collection` | profile_id, owner_id, name, kind (personal/cloned/shared), cloned_from_deck_id, cloned_from_collection_id, is_public, item_count | `item_count` do service/trigger giữ; index `(profile_id, archived_at, updated_at DESC)` |
| `collection_item` | collection_id, concept_id (nullable), anchor_sense_id, meaning_vi, meaning_source (user/source/machine/llm), note, status (learning/paused/known), position, added_from_deck_id | UNIQUE(collection_id, anchor_sense_id); FK core là RESTRICT |
| `collection_item_face` | item_id, sense_id, language_id, role (primary/secondary) | UNIQUE(item_id, language_id) — tối đa 1 mặt/ngôn ngữ; UNIQUE(item_id, sense_id) |
| `tag` | user_id, name, color | unique `(user_id, lower(name))` — khác namespace với `public.tag` |
| `collection_item_tag` | item_id, tag_id | PK đôi; index theo tag |
| `collection_share` | collection_id, token unique, permission (view/clone), expires_at, revoked_at | Phase 2 |

**Bất biến quan trọng:** mỗi `face` mới **phải** sinh 2 dòng `srs_state` (recognize + recall) trong
cùng transaction. Không bao giờ tồn tại face không có lịch ôn.

#### Nhóm SRS (migration 019)

| Bảng | Cột chính | Ghi chú |
|------|-----------|---------|
| `srs_state` | face_id, user_id (denormalize), profile_id, direction, state (new/learning/review/relearning), due_at, stability, difficulty, reps, lapses, scheduled_days, elapsed_days, suspended | UNIQUE(face_id, direction); index chính `(user_id, due_at) WHERE NOT suspended`; `(profile_id, due_at)` |
| `review_log` | srs_id (SET NULL), user_id, face_id, rating 1–4, mode, elapsed_ms, reviewed_at | **Partitioned theo tháng** (RANGE reviewed_at), PK `(id, reviewed_at)`; 36 partition sẵn (2026-09→2029-08) |
| `app.ensure_month_partition(date)` | — | Hàm tạo partition tháng; cron gọi trước mỗi tháng mới |

Thuật toán: MVP có thể chạy SM-2, nhưng schema đã đủ cột FSRS (stability/difficulty) để nâng cấp
không cần migration dữ liệu. Truy vấn nóng: `WHERE user_id=? AND due_at <= now() ORDER BY due_at LIMIT n`.

#### Nhóm phiên ôn & quiz (migrations 020, 023)

| Bảng | Cột chính | Ghi chú |
|------|-----------|---------|
| `study_session` | user_id, profile_id, kind (review/practice/quiz), mode (flashcard/multiple_choice/matching/typing/listening), collection_id, quiz_id, settings jsonb, status, item_count, correct_count, score, xp_awarded | CHECK: kind='quiz' ⇒ quiz_id NOT NULL; correct_count ≤ item_count |
| `study_session_item` | session_id, ordinal, srs_id, face_id, quiz_question_id, prompt jsonb (snapshot), correct_answer, user_answer, answer_receipt jsonb (response retry), is_correct, rating, elapsed_ms | UNIQUE(session_id, ordinal); index câu sai |
| `quiz` | user_id, profile_id, collection_id, quiz_type, difficulty, question_count, generator jsonb (model/prompt), status, expires_at | Sinh bởi AI từ vốn từ đã học |
| `quiz_question` | quiz_id, ordinal, question_type, prompt, options jsonb, correct_answer jsonb, explanation, concept_id, item_id | UNIQUE(quiz_id, ordinal) |

**Lượt làm quiz không có bảng riêng** — dùng `study_session(kind='quiz')` + `study_session_item`.
Điểm/thời gian/câu sai nằm chung mô hình với các chế độ ôn khác.

#### Nhóm gamification (migration 021)

| Bảng | Cột chính | Ghi chú |
|------|-----------|---------|
| `xp_rule` | code (review/quiz_correct/streak_day), amount, daily_cap | Seed sẵn: ôn +1 (cap 200), quiz đúng +5 (cap 200), ngày học +2 (cap 2) |
| `xp_event` | user_id, amount, source, ref_kind, ref_id, idempotency_key | Sổ cái append-only; UNIQUE(user_id, idempotency_key) chống cộng trùng |
| `streak_day` | user_id, day (date), review_count, xp, met_goal | PK (user_id, day); ngày theo timezone người dùng |
| `user_stats` | xp_total, level, streak_current, streak_longest, last_study_date, items_learned, reviews_total | Cache denormalize — rebuild từ log được |
| `achievement` | code, name_vi, rule jsonb (metric/gte), xp_reward, category | Seed 5 thành tích mẫu (words_100, reviews_1000, streak_7, streak_30, quiz_100) |
| `user_achievement` | user_id, achievement_code, progress, unlocked_at, seen_at | PK đôi; index mục chưa xem |
| `leaderboard_snapshot` | period_start (tuần), scope, user_id, xp, rank | Phase 2 — cron tổng hợp từ xp_event |

Streak: khi ghi hoạt động, upsert `streak_day` theo ngày địa phương; nếu `last_study_date` = hôm qua
thì +1, hôm nay thì giữ, cũ hơn thì reset 1 — tính tại thời điểm ghi, không cần cron 0h.

#### Nhóm nhắc nhở (migration 022)

| Bảng | Cột chính | Ghi chú |
|------|-----------|---------|
| `reminder` | time_of_day, timezone, weekdays smallint[], channels text[], is_enabled, smart_reminder, missed_days_threshold, next_fire_at | Index `(next_fire_at) WHERE is_enabled`; worker quét `next_fire_at <= now() FOR UPDATE SKIP LOCKED` |
| `notification_log` | reminder_id, channel, title, body, provider_message_id, status, sent_at, idempotency_key | Unique chống gửi trùng; trạng thái queued/sent/failed/opened/clicked |

#### Nhóm AI (migration 023)

| Bảng | Cột chính | Ghi chú |
|------|-----------|---------|
| `chat_session` | user_id, profile_id, language_id, scenario, model, prompt_version, summary, message_count | `summary` để cuộn ngữ cảnh hội thoại dài |
| `chat_message` | session_id, role (system/user/assistant/tool), content, content_json, ref_sense_id, tokens_in/out, cost_usd, model | `ref_sense_id` khi tin nhắn gắn với kết quả tra từ |
| `ai_usage` | user_id, period (date), feature, request_count, tokens_in/out, cost_usd | PK (user_id, period, feature) — quota + chi phí |

### 6.5 `serve` — read model (4 view)

| View | Loại | Nội dung |
|------|------|----------|
| `sense_pair` | materialized view | Cặp sense khác ngôn ngữ cùng concept; **chỉ concept `curated`**, confidence ≥ 0.7; unique index `(sense_a, sense_b)` để refresh CONCURRENTLY. Hiện **rỗng** (đúng thiết kế khi chưa curate). Refresh: `REFRESH MATERIALIZED VIEW CONCURRENTLY serve.sense_pair;` (chạy ngoài transaction, bằng script/cron) |
| `sense_card` | view | 1 dòng/sense cho UI tra cứu: lexeme + gloss vi ưu tiên (người duyệt → nguồn → máy) + badge `is_machine/reviewed` + gloss en + concept |
| `kanji_card` | view | 1 dòng/chữ: số nét, grade, JLPT, bộ thủ (kèm nghĩa Việt khi seed `radical`), readings/meanings jsonb, số form dùng chữ, media kinds |
| `dictionary_search` | view | 1 dòng/"mặt chữ": lemma + mọi form với `lang_code`, POS, frequency — nguồn chuẩn cho API search (DB2: trigram 033 + bigram 035 qua `core.bigrams`) |

---

## 7. Luồng nghiệp vụ chính

### 7.1 Thêm một từ vào collection (kèm tuỳ chọn mặt ngôn ngữ 2)

```
Client gửi sense_id (mặt chính)
  → server đọc serve.sense_pair tìm sense ngôn ngữ còn lại (chỉ curated; hiện trả rỗng)
  → transaction:
      1. INSERT app.collection_item (concept_id, anchor_sense_id, meaning_vi, meaning_source)
      2. INSERT app.collection_item_face (1 hoặc 2 dòng — UNIQUE(item, language))
      3. INSERT app.srs_state ×2 cho MỖI face (recognize + recall)
      4. UPDATE collection.item_count
```

### 7.2 Một lượt ôn (mọi chế độ)

```
transaction:
  1. INSERT app.review_log (rating CHỈ có ở flashcard; các mode khác ghi session_item)
  2. UPDATE app.srs_state (FSRS/SM-2 do service tính: state, due_at, stability, difficulty, reps, lapses)
  3. UPDATE app.study_session_item (user_answer, is_correct, elapsed_ms, answered_at); quiz ghi item trước gamification để achievement đếm câu vừa trả lời
  4. INSERT app.xp_event (idempotency_key = session:ordinal)  ← ON CONFLICT DO NOTHING
  5. UPSERT app.streak_day (ngày địa phương: review_count+1, xp+…)
  6. UPDATE app.user_stats (xp_total, streak, level…)
  7. UPDATE app.study_session (correct_count/xp_awarded) — đóng phiên khi hết câu
```

### 7.3 AI quiz

```
1. Service đọc collection_item + srs_state.state IN ('review','relearning') làm nguồn từ vựng
2. Gọi LLM sinh câu hỏi → INSERT app.quiz + app.quiz_question (lưu generator + model + prompt_version)
3. Người dùng làm bài → tạo study_session(kind='quiz', quiz_id) + session_item cho từng câu
4. Chấm & XP như 7.2; màn "câu sai" = session_item WHERE is_correct = false
```

### 7.4 Nhắc nhở (worker)

```
Mỗi phút: SELECT * FROM app.reminder WHERE is_enabled AND next_fire_at <= now()
          FOR UPDATE SKIP LOCKED
  → gửi FCM/APNs (app.device) hoặc email → INSERT app.notification_log
  → tính next_fire_at kế tiếp (theo timezone)
```

### 7.5 Chatbot

```
Tạo chat_session (ngôn ngữ + scenario) → mỗi lượt:
  gửi N tin gần nhất + summary (+ sense_card nếu user hỏi nghĩa từ)
  → INSERT chat_message (user) → gọi LLM → INSERT chat_message (assistant, tokens/cost)
  → UPSERT ai_usage (period, feature='chat')
```

---

## 8. Ánh xạ chức năng → bảng → API gợi ý

| Chức năng | Bảng chính | API gợi ý (NestJS) |
|-----------|------------|--------------------|
| 1. Tra từ điển | `serve.sense_card`, `serve.kanji_card`, `serve.dictionary_search`, `core.*`, `app.search_history`, `app.gloss_report`, `app.collection_item` (nút Lưu) | `GET /dictionary/search?q=` · `GET /dictionary/senses/:id` · `GET /dictionary/senses/:id/links` · `GET /kanji/:literal` · `GET /me/search-history` · `POST /gloss-reports` |
| 2. Collection | `app.collection`, `app.collection_item`, `_face`, `app.tag`, `app.collection_item_tag`, `core.deck` | `GET/POST/PATCH/DELETE /collections` · `POST /collections/:id/items` · `DELETE /collections/:id/items/:itemId` · `GET/POST /collections/:id/tags` |
| 3. SRS | `app.srs_state`, `app.review_log` | `GET /srs/due?limit=` · `POST /srs/reviews` `{face_id, direction, rating, elapsed_ms}` · `GET /srs/stats` |
| 4. Chế độ ôn | `app.study_session`, `app.study_session_item` | `POST /sessions` `{kind, mode, collection_id}` · `GET /sessions/:id` · `POST /sessions/:id/answers` |
| 5. Nhắc nhở | `app.reminder`, `app.notification_log`, `app.device` | `GET/PUT /reminders` · `POST /devices` (đăng ký push token) |
| 6. Chatbot | `app.chat_session`, `app.chat_message`, `app.ai_usage` | `POST /chat/sessions` · `POST /chat/sessions/:id/messages` · `GET /chat/sessions` |
| 7. AI quiz | `app.quiz`, `app.quiz_question` + `study_session` | `POST /quizzes` (generate) · `POST /quizzes/:id/start` · `POST /sessions/:id/answers` |
| 8. Gamification | `app.xp_event`, `app.streak_day`, `app.user_stats`, `app.achievement`, `app.user_achievement` | `GET /me/stats` · `GET /me/achievements` · `GET /leaderboard?period=` |

Quy ước chung gợi ý: REST, phân trang `?limit&cursor`, lỗi `{code,message,details}`, mọi mutation
trả về tài nguyên sau khi ghi; auth bằng Bearer JWT; mọi request cần `profile_id` (mặc định lấy
`user_settings.active_profile_id`).

---

## 9. Nguồn dữ liệu & giấy phép

| Nguồn (source.code) | Dùng cho | Giấy phép | Trạng thái |
|---------------------|----------|-----------|------------|
| `jmdict` | từ vựng Nhật, gloss en, ví dụ ja-en | CC BY-SA 4.0 (EDRDG) | đã nạp |
| `kanjidic2` | chi tiết chữ: nét, grade, JLPT cũ, âm, nghĩa | CC BY-SA 4.0 (EDRDG) | đã nạp |
| `kradfile` | tách bộ phận chữ | CC BY-SA 4.0 (EDRDG) | đã nạp |
| `cili` | mã concept liên ngữ | CC BY 4.0 | đã nạp |
| `oewn` | xương sống concept + sense en | CC BY 4.0 | đã nạp |
| `omw-ja` / `omw-en` | sense ja/en theo ILI | ghi nguồn | đã nạp |
| `wiktextract` | sense en chi tiết, IPA, bản dịch vi, form | CC BY-SA 4.0 (dẫn Ylonen LREC 2022) | đã nạp |
| `omw-wikt-vi` | lemma vi theo PWN offset | CC BY-SA | đã nạp |
| `ili-map-pwn30` | cầu PWN30 → ILI | CC BY 4.0 | đã nạp |
| `tatoeba` | câu ví dụ + cặp dịch | CC BY 2.0 FR | đã nạp |
| `kanji-data`, `jlpt-list` | JLPT/jlpt mới, tần suất | cần xác minh | đã nạp vào staging |
| `llm-vi` | gloss vi do LLM sinh | nội bộ | chưa chạy |
| `wordfreq` | tần suất | CC BY-SA 4.0 | chưa dùng |
| **KanjiVG** (media thứ tự nét) | `core.media_asset` | CC BY-SA | **cần tải khi làm tính năng viết** |
| **Bộ thủ 214** | `public.radical` | dữ liệu phổ thông | **cần seed** |

Bắt buộc làm sớm: trang `/credits` sinh từ `public.source` (attribution + license + url).

---

## 10. Pipeline & script

| Script | Việc |
|--------|------|
| `scripts/pgdev.sh` | start/stop/status PostgreSQL nhúng (port 55432, data `~/.local/share/langoo/pgdata`) |
| `scripts/db.py` | helper kết nối (`DATABASE_URL`, mặc định `postgresql://postgres@127.0.0.1:55432/langoo`), batch, sha256 |
| `scripts/apply_migrations.py` | chạy migration theo tên, ghi `schema_migration` |
| `scripts/seed_metadata.py` | seed language/source/tag |
| `scripts/download.sh`, `fetch_wordnets.py`, `export_wordnets_json.py`, `make_manifest.py` | tải + manifest dump |
| `scripts/stage_raw.py`, `stage_extras.py`, `stage_wiktextract.py`, `stage_tatoeba.py`, `stage_wordnet.py`, `stage_vi_tabs.py` | nạp dump → staging |
| `scripts/import_core.py` | staging → core (idempotent, chạy từng chặng, `--from-step`) |
| `scripts/run_mapping.py` | mapping nội dung theo 4 lớp: `foundation` (crosswalk), `examples` (JMdict↔Tatoeba), `jlpt`, `translations`, `relations`, `candidates`, `report`, `all-safe` |
| `scripts/seed_app_dev.py` | seed dữ liệu demo tầng app (`--reset`) |
| `scripts/smoke_app_schema.py` | smoke test chuỗi FK + view serve (rollback) |
| `scripts/dump_schema_doc.py` | sinh `CSDL-THAM-CHIEU.md` |
| `app/server.py` + `scripts/run_ui.sh` | UI xem thử dữ liệu staging (không phải app thật) |

---

## 11. Vận hành dev (lệnh thường dùng)

```bash
bash scripts/pgdev.sh start                      # bật PostgreSQL nhúng
.venv/bin/python scripts/apply_migrations.py     # áp migration mới
.venv/bin/python scripts/seed_app_dev.py --reset # dữ liệu demo
.venv/bin/python scripts/smoke_app_schema.py     # kiểm tra chuỗi FK (rollback)
.venv/bin/python scripts/dump_schema_doc.py      # cập nhật CSDL-THAM-CHIEU.md
bash scripts/run_ui.sh                           # UI xem staging tại :8770
```

Kết nối mặc định: `postgresql://postgres@127.0.0.1:55432/langoo` (đổi bằng `DATABASE_URL`).
Lưu ý: PG nhúng **không có** `pg_trgm`, `unaccent`, `citext`, `pg_partman`; chỉ có `vector` (0.6.2, chưa cài). Migration DB2 tự guard phần extension; index **bigram** (`core.bigrams`) vẫn tạo được trên PG nhúng.

### 11.1. DB tối giản cho cloud (giới hạn 500 MB)

DB đầy đủ ~9,7 GB; bản tối giản ~15 MB, dùng để code API trên cloud. Bộ dump nằm trong `db/exports/`:

| File | Nội dung |
|------|----------|
| `langoo-min-full.sql` (~320 KB) | Restore một lệnh: schema 001–025 + metadata + dữ liệu mẫu (25 lexeme, 26 sense, 13 concept `curated`, 14 kanji + 13 bộ thủ, 2 deck, 26 ví dụ; user `demo@langoo.local`, collection 11 từ, 22 lịch SRS, quiz/chat/reminder) + `REFRESH serve.sense_pair` |
| `langoo-min-schema.sql` (~230 KB) | Chỉ cấu trúc, không dữ liệu |

- Restore: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/exports/langoo-min-full.sql`
  (nếu `psql` nội bộ thiếu SSL như pgserver, dùng `scripts/push_min_db.py` — xem README).
- Dựng lại từ đầu: `apply_migrations.py` → `seed_metadata.py` → `seed_core_demo.py` → `seed_app_dev.py --reset` → `smoke_app_schema.py`.
- `seed_core_demo.py` gắn mọi dòng với `source_id = 100` (source `demo`) và `external_id` tiền tố `demo:` — tách hoàn toàn khỏi dữ liệu thật; `--reset` TRUNCATE core (cascade app) rồi seed lại.
- Concept demo là tự tạo (`ili = NULL`, `status = 'curated'`, `method='manual'`) nên `sense_pair` có dữ liệu ngay.
- Dữ liệu thật nạp sau lên VPS bằng `import_core.py` + `run_mapping.py` từ `downloads/` (không đổi schema).

---

## 12. Lịch sử migration

| # | File | Nội dung |
|---|------|----------|
| 001–004 | metadata, staging, staging indexes, wn_example | nền tầng metadata + staging |
| 005–008 | core, lexeme forms, source links, extra levels | từ điển chuẩn hoá + kanji + JLPT |
| 009–014 | mapping foundation, labels, example mapping, jlpt/forms/chars, translations/relations, storage trim | hạ tầng mapping/candidate/provenance |
| 015 | `015_wikt_definition_language_backfill.sql` | (chủ dự án) đánh `definition_language_id=1` cho sense Wiktextract có definition cache |
| 016 | `016_candidate_reviews.sql` | (chủ dự án) bảng review nhiều lượt cho `sense_concept_candidate` |
| 017 | `017_app_users_auth.sql` | schema app + users/identity/session/device/profile/settings/search_history/gloss_report |
| 018 | `018_app_collections.sql` | collection/item/face/tag/share |
| 019 | `019_app_srs.sql` | srs_state + review_log partition + hàm tạo partition |
| 020 | `020_app_sessions.sql` | study_session + study_session_item |
| 021 | `021_app_gamification.sql` | xp_rule/xp_event/streak_day/user_stats/achievement/user_achievement/leaderboard |
| 022 | `022_app_reminders.sql` | reminder + notification_log |
| 023 | `023_app_ai.sql` | chat + ai_usage + quiz + FK bổ sung |
| 024 | `024_core_reference.sql` | public.radical, media_asset/kanji_media, deck/deck_item, FK deck cho app |
| 025 | `025_serve_models.sql` | serve.sense_pair (matview) + sense_card/kanji_card/dictionary_search |

**Số tiếp theo: 026.**

---

## 13. Lộ trình & việc tiếp theo

### A. Hoàn thiện nội dung (song song, không chặn backend)

1. **Gloss tiếng Việt**: chuyển lemma OMW vi từ `concept_gloss` sang `concept_label`; sinh gloss vi
   theo concept (LLM có ngữ cảnh, `is_machine=true`); trải xuống `sense_gloss` theo thứ tự ưu tiên;
   giữ badge + `gloss_report`.
2. **Curate concept**: duyệt `draft → curated` cho tập lõi (JLPT + phổ biến) để mở khoá song ngữ;
   refresh `serve.sense_pair`.
3. **Chạy `run_mapping.py`** (mục §10): JLPT links, examples (JMdict↔Tatoeba), translations, relations.
4. **Seed `public.radical`** 214 bộ + nạp KanjiVG vào `core.media_asset` (khi làm màn học viết).
5. **Seed `core.deck`** (JLPT N5–N1 từ `lexeme_level`; TOEIC sau) để clone bộ hoạt động.

### B. Backend (NestJS)

1. Khung module NestJS (9 module ở §1.2): `auth`, `users`, `dictionary`, `collections`, `srs`,
   `review-modes`, `reminders`, `ai/chatbot`, `ai/quiz-generator`, `gamification`, `common`.
2. Auth: JWT + refresh (`app.user_session`), argon2/bcrypt cho `password_hash`.
3. Dùng `serve.*` cho đọc, `app.*` cho ghi; service chịu trách nhiệm các ràng buộc xuyên bảng.
4. FSRS/SM-2 chạy trong service SRS; XP/streak cập nhật cùng transaction.
5. Cron: partition tháng (`app.ensure_month_partition`), refresh `sense_pair`, nhắc nhở,
   tổng hợp leaderboard tuần.

### C. Frontend

Đọc API contract (chưa viết — nên là việc kế tiếp trước khi FE bắt đầu); dùng seed demo để dựng UI
tra từ, collection, phiên ôn, thống kê.

### D. Production

- ~~Chọn PostgreSQL có `pg_trgm` + `unaccent`~~ **đã xong ở DB2** (033 trigram + 035 bigram; VPS PG16 đủ extension, cloud chỉ cần `core.bigrams`).
- Redis cache theo `sense_id` (tầng từ điển) + rate limit AI.
- Object storage cho `media_asset`/`audio`; cân nhắc pgvector cho RAG (extension `vector` có sẵn).

---

## 14. Quyết định còn mở

| # | Quyết định | Ảnh hưởng | Mặc định đang dùng |
|---|------------|-----------|--------------------|
| 1 | Auth tự làm hay dịch vụ (Supabase/Auth0/Clerk) | Bảng `user_identity/user_session` có dùng hay không | Tự làm (bảng đã sẵn; SSO thêm sau) |
| 2 | UUID v7 sinh ở app hay extension | Cách viết repository | App sinh; prod có thể cài `pg_uuidv7` |
| 3 | Phát hành gói offline? | Nghĩa vụ ShareAlike + sync (updated_at/tombstone) | Chưa chốt; uuid + updated_at đã sẵn |
| 4 | Retention nội dung chat AI | Dung lượng + privacy | Giữ 6 tháng (chưa cấu hình) |
| 5 | Ngưỡng XP / cap / công thức level | Cân bằng game | 1 XP/ôn, 5 XP/câu đúng, cap 200/ngày |
| 6 | Leaderboard realtime (P3) | Redis hay DB | Redis sorted set; DB giữ snapshot tuần |
| 7 | Ai duyệt concept/gloss và bao nhiêu giờ/tuần | Quy mô song ngữ | LLM + badge + báo lỗi người dùng |
| 8 | TTS tự host hay dịch vụ | Chi phí vận hành | Chưa chốt |
| 9 | Nguồn dữ liệu bộ thủ 214 + KanjiVG | Tính năng học viết | Chưa chốt nguồn |

---

## 15. Thuật ngữ

| Thuật ngữ | Nghĩa |
|-----------|-------|
| **lexeme** | Một mục từ của một ngôn ngữ (`run`, `走る`) — tầng 1 |
| **lemma** | Dạng đầu mục của lexeme |
| **sense** | Một nghĩa cụ thể của lexeme — đơn vị để học và liên kết — tầng 2 |
| **gloss** | Chuỗi văn bản mô tả nghĩa; **không phải** một lexeme |
| **concept** | Khái niệm phi ngôn ngữ, neo ILI — tầng 3 |
| **ILI / CILI** | Mã khái niệm liên ngữ (`i35545`), ổn định giữa các wordnet |
| **synset** | Tập từ đồng nghĩa trong WordNet — cách WordNet biểu diễn concept |
| **PWN offset** | Mã synset Princeton WordNet 3.0 (`00001740-n`) — khoá gián tiếp, đổi theo phiên bản |
| **staging / core / app / serve** | 4 tầng dữ liệu (thô → chuẩn hoá → người học → read model) |
| **face** | Một mặt ngôn ngữ của entry trong collection (en, ja…) |
| **direction** | Chiều ôn: `recognize` (nhận ra) hoặc `recall` (nhớ lại) |
| **deck** | Bộ từ hệ thống, biên soạn sẵn (JLPT N5, TOEIC…) |
| **SRS / FSRS / SM-2** | Ôn tập ngắt quãng; FSRS và SM-2 là hai thuật toán xếp lịch |
| **curated** | Concept/nội dung đã được duyệt — điều kiện để hiển thị |
| **mapping_run** | Một lần chạy thuật toán mapping, có provenance để rollback |
| **candidate** | Ứng viên liên kết chưa được chấp nhận (không hiển thị cho người dùng) |
| **provenance** | Dấu vết nguồn gốc: dòng dữ liệu đến từ file/batch/run nào |
| **badge** | Nhãn "chưa kiểm duyệt" cho gloss máy chưa có người duyệt |
