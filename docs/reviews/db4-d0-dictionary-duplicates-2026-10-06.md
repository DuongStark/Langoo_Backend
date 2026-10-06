# DB4-D0 — Rà soát bản ghi từ điển trùng

Ngày: 06/10/2026. Khảo sát mẫu trên bản DB full local
`127.0.0.1:55433/langoo`, BEGIN READ ONLY, statement timeout 12–20 giây.
Không ghi DB, không gọi AI, chưa đối chiếu trực tiếp VPS. Đây là một phần D0,
không phải audit toàn DB hoặc D0 đã hoàn tất.

## Kết quả đã xác nhận

### Search lặp face của cùng lexeme

`serve.dictionary_search` UNION ALL lemma và lexeme_form. Repository search UNION
ba nhánh tìm mặt chữ/reading/romaji nhưng SELECT cả surface_kind. Vì vậy cùng ID
và surface, khác kind vẫn là hai row khác nhau.

| Lexeme ID | Surface | Reading  | Kinds        |
| --------- | ------- | -------- | ------------ |
| 105236    | 学校    | がっこう | lemma, kanji |
| 156837    | 猫      | ねこ     | lemma, kanji |
| 156838    | 猫      | ねこま   | lemma, kanji |
| 214390    | 食べる  | たべる   | lemma, kanji |

Nguồn: migration 025 và `src/dictionary/repositories/dictionary-search.repository.ts`.
Search chỉ trả identity/face metadata; definition có thể được FE lấy qua endpoint senses.

### Nhiều nguồn tạo lexeme riêng cho cùng từ

`../data-Langoo/scripts/import_core.py` tạo lexeme theo WordNet lexicon/Wiktextract
entry, tăng homograph_no để tránh va chạm natural key. Khác homograph_no trong
mô hình nhập này chưa chứng minh hai từ đồng hình khác nhau về ngữ nghĩa.

| Từ / POS      | Số lexeme | Nguồn                     |
| ------------- | --------- | ------------------------- |
| eat / verb    | 3         | oewn, omw-en, wiktextract |
| cat / noun    | 5         | oewn, omw-en, wiktextract |
| school / noun | 4         | oewn, omw-en, wiktextract |

Cat senses 313644 và 313651 có definition giống hệt và cùng concept 58321,
relation=exact, verified=true, method=wordnet_synset. Đây là chứng cứ nguồn để gộp
hiển thị cặp này; không cho phép xóa sense hay tự curate concept.

### Pipeline lấy gloss cha làm definition, tạo trùng giả

`../data-Langoo/scripts/run_mapping.py`, stage_foundation(), chọn first_gloss
(rank thấp nhất) rồi UPDATE core.sense.definition. Importer core hiện chọn gloss
cuối, nhưng bước foundation ghi đè lại thành gloss đầu.

| Sense ID      | Definition hiện tại       | Gloss chi tiết vẫn còn                                            |
| ------------- | ------------------------- | ----------------------------------------------------------------- |
| 1810300 (eat) | To ingest.                | To consume solid/semi-solid food by swallowing                    |
| 1810301 (eat) | To ingest.                | To consume a meal.                                                |
| 1810302 (eat) | To ingest.                | To have a particular quality of diet; to be well-fed or underfed. |
| 1417635 (cat) | Terms relating to things. | A double tripod for holding a plate…                              |
| 1417636 (cat) | Terms relating to things. | The game of trap ball…                                            |

Ở cat có 8 sense cùng definition Terms relating to things. Full EN gloss groups
vẫn còn trong sense_gloss/staging, gồm gloss cha rank 1 và gloss cụ thể rank 2 ở
những mẫu trên. Không merge các sense này theo definition đang hiển thị.

### Cùng gloss có thể là hai entry đúng

Hai Wiktextract noun lexeme 猫 2282106/2282107 đều definition a cat và core.reading=null,
nhưng payload etymology_number là 1/2 và IPA là [ne̞ko̞]/[ne̞ko̞ma̠]. JMdict cũng giữ
猫/ねこ và 猫/ねこま riêng. Entry 2282108 có original_pos=character, normalized POS unknown.
Không merge chỉ theo lemma/definition; reading=null không là wildcard nối hai cách đọc.

## Thứ tự xử lý đề xuất

1. **Sửa definition projection trước phân loại duplicate sense.** Bỏ ghi đè gloss
   cha thành định nghĩa. Chọn gloss cụ thể theo cấu trúc nguồn đã xác minh, giữ toàn
   ancestor/leaf gloss và tags/restrictions làm context. Mẫu này leaf ở cuối, nhưng
   không áp dụng last một cách mù quáng cho mọi nguồn. Backfill từ payload gốc có
   dry-run, before/after hashes và journal, giữ sense_id; không cần AI viết lại.
2. **Khử face lặp cùng lexeme_id trước LIMIT/cursor.** Chọn face match phù hợp nhất,
   giữ matched surface và forms trong chi tiết. Không chỉ filter trùng trong FE sau
   phân trang. Ranking/cursor cần regression khi triển khai.
3. **Gộp cách hiển thị các nguồn bằng membership/alias.** Group theo language,
   spelling, reading đã xác minh, raw POS/etymology/homograph; vẫn giữ sense khác
   nhau trong group. Đại diện theo source quality/độ đầy đủ và policy có version.
   JMdict có reading/restrictions hữu ích cho JA; WordNet hỗ trợ concept; Wiktextract
   bổ sung nghĩa. Không bỏ các nguồn phụ hoặc gộp unknown reading vào mọi reading.
4. **Xác nhận duplicate bằng đầy đủ context.** Hash toàn source gloss group,
   raw POS/restrictions/domain/register/etymology để tìm ứng viên, rồi so payload.
   Cùng exact source concept/ILI bổ sung chứng cứ khi đúng lexical scope. Empty
   gloss không tạo nhóm; similarity cao hay definition ngắn giống nhau không đủ.
5. **Giữ IDs và provenance.** Collection/SRS/examples/mapping tham chiếu IDs cũ.
   Gộp ở serving trước; xóa hoặc repoint FK cần kiểm dependency và rollback riêng.
6. **AI chỉ kiểm shortlist còn mơ hồ.** Cache theo full input hash + policy/model/
   prompt version. Không so mọi sense với mọi sense hoặc gọi AI cho exact duplicates.

Comparison key dùng NFC/trim/whitespace có version, giữ text gốc. Case-fold/width/
kana variants dùng retrieval; không tự làm bằng chứng identity. Không bỏ qualifier,
phủ định/cách đọc để tăng số lượng merge.

## Tiết kiệm dịch và mapping

SQL/rule đủ cho face duplicates và sửa definition từ gloss có sẵn. Group full context
trước tạo AI jobs; chỉ tái dùng dịch khi scope/restrictions thật sự tương đương.
Mỗi target vẫn cần artifact/provenance và binding IDs riêng; không copy output rồi
sửa ID để vượt validator. Cùng bản VI không chứng minh sense_concept exact.

Chưa kiểm kê toàn DB nên chưa có tỷ lệ duplicate/tiết kiệm đáng tin. Sửa definition
làm đổi semantic hash của job sử dụng field đó; stale/rebuild đúng subset, không
sửa artifact đã chạy để giả nguyên input.

## SQL tái hiện

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';

SELECT d.lexeme_id, d.surface, d.reading,
       count(*) AS rows, array_agg(DISTINCT d.surface_kind) AS kinds
FROM serve.dictionary_search d
WHERE d.surface IN ('学校', '猫', '食べる')
GROUP BY d.lexeme_id, d.surface, d.reading
HAVING count(*) > 1;

SELECT s.id, s.definition, g.rank, g.text
FROM core.sense s
JOIN core.sense_gloss g ON g.sense_id = s.id AND g.language_id = 1
WHERE s.id IN (1810300, 1810301, 1417635, 1417636)
ORDER BY s.id, g.rank, g.id;

SELECT sc.sense_id, sc.concept_id, sc.relation, sc.verified, sc.method
FROM core.sense_concept sc
WHERE sc.sense_id IN (313644, 313651);

ROLLBACK;
```

[PostgreSQL UNION](https://www.postgresql.org/docs/current/queries-union.html)
khử row trùng toàn bộ cột SELECT; khác kind/ID vẫn còn.
[PostgreSQL string functions](https://www.postgresql.org/docs/current/functions-string.html)
có normalization NFC trên UTF-8; lexical equality vẫn cần policy riêng.

## Trạng thái

Đã đọc schema/search/importer và query khảo sát mẫu read-only. Chưa sửa code/DB,
không có test implementation. D0 full inventory/source audit, VPS comparison,
API runtime verification và plan sửa chi tiết còn chờ. Chỉ lưu report/PROGRESS;
chưa commit/push/deploy.
