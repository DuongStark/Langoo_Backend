# DB4-D0 — Khảo sát trùng từ điển trên VPS

Ngày: **06/10/2026**, khảo sát `langoo-vps` qua SSH. Môi trường:
PostgreSQL **16.15**, DB `langoo` tại VPS, API loopback `127.0.0.1:3000`.
Phạm vi lượt này: **đọc DB/code/runtime, thống kê, lập plan**. Không sửa DB,
restart, deploy, migration, gọi AI, commit hoặc push. D0 tổng thể còn source/license
và legacy-review audit; báo cáo này chỉ hoàn tất phần khảo sát duplicate.

## 1. Bằng chứng và cách đo

- [SQL tái chạy](db4-d0-vps-duplicates-2026-10-06.sql): hai transaction
  `REPEATABLE READ READ ONLY`, truy vấn tuần tự, timeout 60s/câu, work_mem 16MB,
  tắt parallel gather, giới hạn temp 768MB. Không tạo object trong DB.
- [Số liệu và HTTP response gốc](db4-d0-vps-duplicates-2026-10-06.json): 16 metric,
  snapshot chính `2336:2336:` từ **12:12:35–12:13:48 UTC**; bổ sung `2342:2342:`
  từ **12:17:17–12:17:26 UTC**; cross-check tổng lần cuối ở snapshot `2458:2458:`
  **12:24:08 UTC**, lexeme/sense khớp tổng theo nguồn ở snapshot chính. Giờ Bangkok
  cộng 7 giờ. Có thể có content drift giữa các snapshot; cùng count chưa đủ hash. Các COUNT là số thật,
  không dùng `n_live_tup` làm số chính thức.
- API anonymous GET: health, 4 search, 2 lexeme-senses và 1 sense-detail đều **200**.
  Không gửi token, không tạo search_history người dùng. API nằm ngoài snapshot SQL.
- [Patch đang tồn tại trên VPS](db4-d0-vps-dictionary-hotfix-2026-10-06.patch)
  được chép về để bảo toàn bằng chứng; **không phải code mới được áp trong lượt này**.
- [Khảo sát local trước đó](db4-d0-dictionary-duplicates-2026-10-06.md) xác minh
  payload/importer; số liệu production trong báo cáo này lấy trực tiếp từ VPS.

## 2. Trạng thái hạ tầng thực tế

| Mục                      | Quan sát                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| HEAD checkout VPS        | `7b13b90d4239c3da4c1bd556069d2921db7a4a13`                                                                            |
| Dictionary source        | **3 file modified chưa commit**; compiled dist cũng chứa logic hotfix                                                 |
| App                      | PM2 `langoo-api` online, `dist/main.js`, health DB ok, timezone UTC                                                   |
| DB URL trong `.env`      | DATABASE_URL/DIRECT_URL cùng trỏ `127.0.0.1:5432/langoo`; không xuất credentials                                      |
| Runtime DB               | PM2 không có override hai URL; thấy kết nối role langoo từ localhost; dữ liệu API phù hợp DB, có biến đổi tại service |
| Schema                   | **001–037 đã áp, trừ số 028 dành riêng**                                                                              |
| Dung lượng DB            | **6.653.303.831 bytes** (~6,65 GB thập phân)                                                                          |
| RAM / đĩa tại preflight  | 1.975MB tổng; 795MB available; swap dùng 111MB; đĩa còn **9,6GB**                                                     |
| Backup mới nhất quan sát | `langoo-2026-10-06-0930.dump`, 606.804.634 bytes, mtime server 09:32; chưa kiểm restore                               |
| Staging raw              | `wikt_entry`, `wn_synset`, `jmdict_entry`: **0 dòng** từng bảng                                                       |

**Runbook cũ nói API dùng cloud và thiếu migration 034/036/037 đã lỗi thời**.
Đã cập nhật các mục liên quan bằng quan sát trên. Không kiểm lại migration của
cloud trong lượt này; không suy trạng thái cloud từ VPS.

## 3. Quy mô từ điển chính thức

Tổng **2.375.240 lexeme**, **2.917.954 sense**. `with_definition` chỉ tính field
`core.sense.definition` không rỗng; **0 definition không đồng nghĩa 0 gloss**.

| Ngôn ngữ | Nguồn       |    Lexeme | Có reading |     Sense | Có definition |
| -------- | ----------- | --------: | ---------: | --------: | ------------: |
| en       | oewn        |   161.646 |          0 |   212.478 |       212.478 |
| en       | omw-en      |   156.584 |          0 |   206.978 |       206.978 |
| en       | wiktextract | 1.492.835 |          0 | 1.787.235 |     1.786.127 |
| ja       | jmdict      |   218.794 |    218.794 |   253.630 |             0 |
| ja       | omw-ja      |    94.002 |          0 |   158.069 |       158.069 |
| ja       | wiktextract |   199.483 |          0 |   237.327 |       183.046 |
| vi       | wiktextract |    51.896 |          0 |    62.237 |        56.761 |

## 4. Thống kê trùng và giới hạn diễn giải

### 4.1 Trùng face cùng ID trong view search

| Ngôn ngữ |    Lexeme |    Form | Tổng face | Cặp ID/surface lặp | Face dư cùng ID/surface |
| -------- | --------: | ------: | --------: | -----------------: | ----------------------: |
| en       | 1.811.065 |       0 | 1.811.065 |                  0 |                       0 |
| ja       |   512.279 | 499.183 | 1.011.462 |        **218.794** |             **218.794** |
| vi       |    51.896 |       0 |    51.896 |                  0 |                       0 |

`serve.dictionary_search` vẫn UNION ALL lemma và form. Đây là duplicate face thật,
**không phải 218.794 từ/sense cần xóa**. Hotfix repository đang lọc per_lexeme trước
LIMIT nên 4 search được thử đều **20 row / 20 ID khác nhau**. Chưa chứng minh toàn
query/cursor hết lỗi. Không báo lỗi face đang còn lộ ở API từ số của view.

### 4.2 Các nhóm lexical cần phân loại

Key đúng truy vấn: `(language_id, lemma, pos, reading)`, giữ nguyên text, NULL thành
một bucket riêng. Chưa xét raw POS, etymology, tags/restrictions và nghĩa đầy đủ.

| Chỉ số                          |          en |         ja |
| ------------------------------- | ----------: | ---------: |
| Nhóm key có >1 lexeme           | **174.367** | **34.200** |
| Lexeme thuộc các nhóm trên      |     461.638 |     73.354 |
| Số row vượt một row/key, Σ(n−1) |     287.271 |     39.154 |
| Nhóm có nhiều nguồn             |     158.364 |     28.749 |
| Nhóm chỉ một nguồn              |      16.003 |      5.451 |
| Nhóm lặp không có reading       |     174.367 | **33.509** |

Đây là **ứng viên grouping**, không phải duplicate đã đủ điều kiện merge.
JA thiếu reading ở OMW/Wiktextract làm exact key không bắt được cặp với JMdict có
reading; đồng thời không được dùng NULL như wildcard để nối 猫/ねこ với 猫/ねこま.
EN không bắt buộc reading theo mô hình này. Số lexical group không bằng số sense.

### 4.3 Definition giống nhau trong cùng lexeme

| Ngôn ngữ | Nhóm definition lặp | Lexeme liên quan | Sense trong nhóm | Row dư Σ(n−1) |
| -------- | ------------------: | ---------------: | ---------------: | ------------: |
| en       |              13.586 |           11.486 |           57.931 |    **44.345** |
| ja       |                 878 |              826 |            2.544 |     **1.666** |
| vi       |                 470 |              425 |            1.148 |       **678** |

Không merge dựa trên field này: một phần là **trùng giả do gloss cha**, một phần có
thể khác qualifier/scope. Truy vấn chỉ so exact definition không rỗng trong cùng
lexeme, không đo duplicate definition xuyên mọi lexeme.

### 4.4 Wiktextract: definition đang bằng gloss đầu khi đầu/cuối khác nhau

| Ngôn ngữ lexeme | Sense có nhóm EN gloss Wiktextract | Nhóm >1 gloss | Đầu/cuối khác | Definition = đầu | Definition = cuối |
| --------------- | ---------------------------------: | ------------: | ------------: | ---------------: | ----------------: |
| en              |                          1.785.990 |        53.061 |    **53.055** |           53.055 |                 0 |
| ja              |                            182.998 |         1.869 |     **1.869** |            1.869 |                 0 |
| vi              |                             56.756 |         1.073 |     **1.073** |            1.073 |                 0 |

Tổng **55.997 sense cần xét lại projection nguồn**. Có đầy đủ ranked EN gloss trong
core cho tập này, dù staging VPS rỗng. Các mẫu eat/cat xác nhận đầu là gloss cha,
cuối là nghĩa cụ thể. **Không suy mọi nhóm >1 gloss đều có cấu trúc cha/con** và
không áp `rank DESC` cho JMdict, nơi glosses thường là các cách diễn đạt cùng nghĩa.

### 4.5 WordNet: chứng cứ nguồn cho tái dùng/gộp hiển thị

- **205.883 nhóm EN** cùng lemma + POS + concept, link `exact`, `verified=true`,
  `method=wordnet_synset`, trải nhiều lexeme/nguồn; **411.766 sense memberships**.
- Trong đó **199.101 nhóm** còn cùng reading và exact definition không rỗng,
  đa nguồn; **398.202 memberships**, phần vượt một membership/nhóm **199.101**.
- 205.883 − 199.101 = **6.782 nhóm** chưa thỏa bộ điều kiện bổ sung này; không ép
  version nguồn có nội dung khác thành một meaning bằng cách chọn gloss giống nhau.

Membership có thể lặp sense ở nhiều concept, **không diễn giải thành số ID có thể
xóa hay số job AI chắc chắn tiết kiệm**. Cần so source version/full scope trước
reuse; không tự nâng concept lên curated hoặc tạo verified link mới từ grouping.

### 4.6 Phạm vi đang dịch DB3-B

JLPT accepted trên VPS: **7.285 lexeme / 15.245 sense**, tất cả nguồn **JMdict**,
0 definition. Vì vậy đợt sửa definition **chỉ Wiktextract** không trực tiếp chạm tập
pilot JLPT này. DB3-B vẫn dùng full EN gloss; nếu sửa policy/context builder thì
hash và input phải đo lại, không sửa artifact cũ để lách drift.

**Không cộng số liệu các mục 4.1–4.5**: chúng đo khác cấp và có thể chồng nhau.

## 5. Bản vá đang chạy và lỗi cần sửa tiếp

### P1 — Bản vá không nằm trong Git

Ba source file modified: dictionary.service.ts, dictionary-search.repository.ts,
sense-content.repository.ts; có thêm `.bak-20261006`. Checkout HEAD không đủ mô tả
runtime. Deploy script `git reset --hard origin/main` có thể làm mất tracked hotfix.
Patch đã lưu để tích hợp/review cùng base hiện tại trước lần deploy tiếp theo.
Chưa tìm thấy/chạy gate test của patch; không báo nó đạt nghiệm thu.

### P2 — Projection phụ thuộc thứ tự sense; list và detail trả nghĩa khác

Hotfix chỉ thay definition **khi text đã xuất hiện ở sense trước**, chọn một gloss
EN tiếp theo chưa dùng; không giới hạn nguồn trong hàm đó. Hậu quả đã kiểm qua API:

| Vị trí                     | Sense   | definition             | gloss_en       |
| -------------------------- | ------- | ---------------------- | -------------- |
| DB / serve.sense_card      | 1810301 | To ingest.             | To ingest.     |
| GET lexemes/1024067/senses | 1810301 | **To consume a meal.** | **To ingest.** |
| GET senses/1810301         | 1810301 | **To ingest.**         | **To ingest.** |

Sense đầu 1810300 vẫn To ingest. dù có gloss cụ thể phía sau. Nguyên nhân writer:
`data-Langoo/scripts/run_mapping.py` foundation lấy first_gloss rồi ghi đè importer.
View `serve.sense_card` cũng lấy EN rank đầu. Sửa service list riêng chưa giải quyết
DB input, endpoint detail, gloss_en, quiz và pipeline tái nhập.

### P2 — Search ẩn nguồn không tương đương nghĩa

Hotfix chọn `min(source_priority)` theo **language + lower(surface)**, chưa có POS
ở partition này; tiếp đó giữ một row theo language/surface/POS/coalesce(reading,'').
Không kiểm full sense scope trước ẩn. Các mẫu live chỉ còn Wiktextract cho cat/eat,
JMdict cho 学校; các sense riêng của nguồn bị ẩn không được union vào đại diện.
Nguy cơ mất POS/nghĩa/cách đọc là từ logic code, chưa đo số sense bị ẩn toàn corpus.

Không coi lower(surface), reading NULL hoặc homograph_no do importer tăng là bằng
chứng đồng nghĩa. Filter prefix EN còn bỏ một số dạng có space/accent/digit/case;
đó là policy khác duplicate, cần fixture riêng và không dùng để tăng số khử trùng.

### P2 — Xóa vật lý sẽ chạm dữ liệu học

Catalog có **27 FK** vào core.lexeme/sense, trong đó collection_item,
collection_item_face, chat_message, search_history và nhiều core mapping/example.
Ví dụ RESTRICT bảo vệ collection, SET NULL có thể làm mất anchor khi xóa.
Chưa đếm nội dung app và không xuất dữ liệu người dùng. Plan giữ IDs và serving
membership trước; physical deletion không thuộc scope.

## 6. Hướng triển khai và trạng thái

[Kế hoạch sửa theo từng hạng mục](../plans/db4-dictionary-deduplication.md):

1. Bảo toàn/tích hợp hotfix VPS vào Git; đối chiếu dist/source và test.
2. Sửa projector + writer; dry-run/journal backfill scoped Wiktextract.
3. Chuẩn hóa search một lexeme một hit, cursor ổn định, không che nghĩa bổ sung.
4. Group đa nguồn có membership/scope/provenance; phân loại duplicate đầy đủ.
5. Cache/reuse translation/mapping theo equivalence đã xác nhận; AI chỉ shortlist.

Chi phí khảo sát **0 request AI / 0 token AI**. Chưa có thống kê job reuse sau khi
áp policy nên chưa cam kết phần trăm giảm token. Đây là plan, chưa sửa runtime/DB.
Artifacts/report/plan mới **chưa commit/push**, không thay các file code local đang
có công việc khác. Gate lượt khảo sát: SQL thành công, 8 HTTP GET 200, JSON/count
consistency và diff/link checks; app regression/restore drill dành cho triển khai.
