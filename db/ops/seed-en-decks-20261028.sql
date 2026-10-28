-- Bộ từ mẫu tiếng Anh v1 (20 deck): CEFR (A1–C2, AWL) + TOEIC + IELTS + 9 bộ chuyên đề đời sống & công việc
-- Yêu cầu: \copy staging_en_wanted (slug, lemma) từ en-decks-wanted-20261028.tsv
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('en-decks-20261028'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='900s';

CREATE TEMP TABLE staging_en_wanted (
  line_no serial,
  slug text NOT NULL,
  lemma text NOT NULL
) ON COMMIT DROP;

\copy staging_en_wanted (slug, lemma) FROM 'db/ops/data/en-decks-wanted-20261028.tsv' WITH (FORMAT text, DELIMITER E'\t');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM staging_en_wanted;
  IF n < 1000 THEN RAISE EXCEPTION 'staging_en_wanted rows=% (quá ít)', n; END IF;
END $$;

-- 1) Upsert 20 deck tiếng Anh (language_id = 1) vào core.deck
INSERT INTO core.deck(slug, title, description, language_id, level_label, is_published) VALUES
  ('cefr-a1-a2',           'Từ vựng Căn bản A1–A2',                     '300 từ cốt lõi siêu tần suất nhất cho người mới bắt đầu hoặc mất gốc.',                    1, 'A1–A2',   true),
  ('cefr-b1',              'Từ vựng Trung cấp B1',                      'Từ vựng sơ trung cấp phục vụ tự tin giao tiếp đời sống và chuẩn đầu ra đại học.',         1, 'B1',      true),
  ('cefr-b2',              'Từ vựng Trung cao cấp B2',                  'Từ vựng trung cao cấp phục vụ tranh luận, viết luận và làm việc môi trường quốc tế.',      1, 'B2',      true),
  ('cefr-c1',              'Từ vựng Cao cấp C1',                        'Văn phong học thuật sâu, cấu trúc câu phức tạp và sắc thái diễn đạt tinh tế.',              1, 'C1',      true),
  ('cefr-c2',              'Từ vựng Bậc thầy C2',                       'Vốn từ tinh hoa tương đương người bản xứ trình độ cao, đọc hiểu tài liệu chuyên sâu.',    1, 'C2',      true),
  ('academic-word-list',   'Academic Word List (AWL)',                  'Danh sách từ vựng học thuật quốc tế (Averil Coxhead) dùng cho nghiên cứu và luận văn.',     1, 'AWL',     true),
  ('toeic-450',            'TOEIC Căn bản (450+)',                      'Trọng tâm tranh ảnh Part 1, hỏi đáp nhanh Part 2 và thông báo ngắn văn phòng.',             1, '450+',    true),
  ('toeic-650',            'TOEIC Trung cấp (650+)',                    'Chuẩn Barron 600 Essential Words: hợp đồng, tài chính, đàm phán và nhân sự.',              1, '650+',    true),
  ('toeic-800',            'TOEIC Nâng cao (800+)',                     'Từ vựng quản trị chiến lược, pháp lý kinh doanh, kinh tế vĩ mô và rủi ro.',                1, '800+',    true),
  ('ielts-core-6',         'IELTS Nền tảng (5.5 – 6.5)',                'Từ vựng học thuật theo các chủ đề lớn: Môi trường, Giáo dục, Xã hội, Công nghệ.',         1, '5.5–6.5', true),
  ('ielts-advanced-7',     'IELTS Bứt phá (7.0 – 8.5)',                 'Từ vựng học thuật nâng cao bứt phá điểm số Writing Task 2 và Reading.',                     1, '7.0–8.5', true),
  ('en-office-work',       'Tiếng Anh Công sở & Văn phòng',             'Họp hành, quản lý tiến độ, nhân sự, đánh giá hiệu quả và văn hóa doanh nghiệp.',           1, 'Office',  true),
  ('en-hospital-health',   'Y tế & Bệnh viện',                          'Chuyên khoa, triệu chứng, thủ thuật, đơn thuốc và dụng cụ y tế.',                          1, 'Medical', true),
  ('en-restaurant-dining', 'Ẩm thực & Nhà hàng',                        'Thực đơn, món ăn, chế biến, nguyên liệu, hương vị và đặt bàn.',                           1, 'Dining',  true),
  ('en-travel-hotel',      'Du lịch & Khách sạn',                       'Sân bay, hải quan, thủ tục nhận phòng, điểm tham quan và xử lý sự cố.',                    1, 'Travel',  true),
  ('en-shopping-commerce', 'Mua sắm & Thương mại điện tử',              'Thanh toán, đổi trả, bảo hành, chương trình khuyến mãi và dịch vụ khách hàng.',             1, 'Retail',  true),
  ('en-transport-traffic', 'Giao thông & Đi lại',                       'Phương tiện công cộng, biển báo, lộ trình, quy tắc giao thông và an toàn.',                 1, 'Transit', true),
  ('en-technology-digital','Công nghệ & Đời sống số',                   'Phần cứng, phần mềm, mạng, bảo mật thông tin, đám mây và xử lý dữ liệu.',                   1, 'Tech',    true),
  ('en-finance-banking',   'Tài chính & Ngân hàng',                     'Tài khoản, giao dịch, tiền tệ, tín dụng, lãi suất và đầu tư cá nhân.',                     1, 'Finance', true),
  ('en-daily-conversation','Đàm thoại Đời sống Hàng ngày',               'Cảm xúc, thời tiết, giao tiếp xã hội, thói quen và quan hệ bạn bè.',                       1, 'Daily',   true)
ON CONFLICT (slug) DO UPDATE
  SET title = EXCLUDED.title,
      description = EXCLUDED.description,
      language_id = EXCLUDED.language_id,
      level_label = EXCLUDED.level_label,
      is_published = true;

-- 2) Xoá items cũ của 20 deck tiếng Anh (idempotent)
DELETE FROM core.deck_item
 WHERE deck_id IN (
   SELECT id FROM core.deck WHERE slug IN (
     'cefr-a1-a2', 'cefr-b1', 'cefr-b2', 'cefr-c1', 'cefr-c2', 'academic-word-list',
     'toeic-450', 'toeic-650', 'toeic-800', 'ielts-core-6', 'ielts-advanced-7',
     'en-office-work', 'en-hospital-health', 'en-restaurant-dining', 'en-travel-hotel',
     'en-shopping-commerce', 'en-transport-traffic', 'en-technology-digital',
     'en-finance-banking', 'en-daily-conversation'
   )
 );

-- 3) Pick lexeme, sense, concept cho từng từ tiếng Anh
-- Thuật toán xếp hạng đa tiêu chí (chuẩn từ điển học & đồng bộ kết quả tìm kiếm):
--  1. no_vi: Bắt buộc ưu tiên nghĩa có bản dịch tiếng Việt (sense_gloss language_id = 3).
--  2. priority_order: Độ ưu tiên người học đã được curate (policy en-m10.5-v1).
--  3. source_pref: Nguồn từ điển đầy đủ ngữ nghĩa (Wiktionary = 8 > WordNet OEWN = 5 > OMW = 7).
--  4. no_ex: Ưu tiên nghĩa có ví dụ minh họa (core.example hoặc core.example_sense).
--  5. not_primary: Ưu tiên nghĩa chính của lexeme (sense.is_primary = true).
--  6. sense_no: Ưu tiên nghĩa thông dụng cơ bản (sense_no nhỏ nhất).
--  7. sense_id: Tie-breaker xác định.
CREATE TEMP TABLE cand_senses ON COMMIT DROP AS
SELECT
  w.line_no,
  w.slug,
  w.lemma,
  s.id AS sense_id,
  l.id AS lexeme_id,
  l.source_id,
  CASE WHEN vi.text IS NOT NULL THEN 0 ELSE 1 END AS no_vi,
  CASE WHEN ex.has_ex = 1 THEN 0 ELSE 1 END AS no_ex,
  CASE WHEN cp.display_order IS NOT NULL THEN cp.display_order ELSE 999 END AS priority_order,
  CASE WHEN l.source_id = 8 THEN 0 WHEN l.source_id = 5 THEN 1 ELSE 2 END AS source_pref,
  CASE WHEN s.is_primary THEN 0 ELSE 1 END AS not_primary,
  s.sense_no,
  sc.concept_id
FROM staging_en_wanted w
JOIN core.lexeme l ON l.language_id = 1 AND lower(l.lemma) = lower(w.lemma)
JOIN core.sense s ON s.lexeme_id = l.id
LEFT JOIN core.dictionary_priority_run r ON r.active AND r.policy = 'en-m10.5-v1' AND r.language_id = 1
LEFT JOIN core.sense_learner_priority cp ON cp.sense_id = s.id AND cp.run_id = r.id
LEFT JOIN LATERAL (
  SELECT g.text FROM core.sense_gloss g
  WHERE g.sense_id = s.id AND g.language_id = 3 AND NULLIF(btrim(g.text), '') IS NOT NULL
  ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine ASC, g.rank ASC
  LIMIT 1
) vi ON true
LEFT JOIN LATERAL (
  SELECT 1 AS has_ex FROM core.example e WHERE e.sense_id = s.id
  UNION
  SELECT 1 FROM core.example_sense es WHERE es.sense_id = s.id
  LIMIT 1
) ex ON true
LEFT JOIN LATERAL (
  SELECT sc.concept_id FROM core.sense_concept sc
  JOIN core.concept cc ON cc.id = sc.concept_id AND cc.status = 'curated'
  WHERE sc.sense_id = s.id AND sc.confidence >= 0.7
  ORDER BY sc.confidence DESC, sc.concept_id LIMIT 1
) sc ON true;

CREATE TEMP TABLE pick_en ON COMMIT DROP AS
SELECT line_no, slug, lemma, lexeme_id, sense_id AS final_sense, concept_id
FROM (
  SELECT *,
    row_number() OVER (
      PARTITION BY slug, lower(lemma)
      ORDER BY
        no_vi ASC,
        priority_order ASC,
        source_pref ASC,
        no_ex ASC,
        not_primary ASC,
        sense_no ASC,
        sense_id ASC
    ) as rn
  FROM cand_senses
) ranked
WHERE rn = 1;

-- 4) Nạp vào core.deck_item theo đúng thứ tự line_no của file TSV
INSERT INTO core.deck_item(deck_id, anchor_sense_id, concept_id, position)
SELECT d.id, p.final_sense, p.concept_id,
       row_number() OVER (PARTITION BY d.id ORDER BY p.line_no)::int
FROM pick_en p
JOIN core.deck d ON d.slug = p.slug
WHERE p.final_sense IS NOT NULL
ON CONFLICT (deck_id, anchor_sense_id) DO NOTHING;

-- 5) Cập nhật item_count chính xác cho core.deck
UPDATE core.deck d
SET item_count = COALESCE(cnt.total, 0)
FROM (
  SELECT deck_id, count(*) AS total
  FROM core.deck_item
  GROUP BY deck_id
) cnt
WHERE d.id = cnt.deck_id
  AND d.language_id = 1;

-- 6) Đồng bộ lại anchor_sense_id, concept_id và meaning_vi cho các collection cá nhân đã clone từ 20 deck tiếng Anh (nếu có)
UPDATE app.collection_item ci
SET anchor_sense_id = di.anchor_sense_id,
    concept_id = di.concept_id,
    meaning_vi = COALESCE(vi.text, en.text, cur_l.lemma),
    meaning_source = CASE
      WHEN vi.text IS NOT NULL AND vi.is_machine AND vi.reviewed_by IS NULL THEN 'machine'
      ELSE 'source'
    END,
    updated_at = clock_timestamp()
FROM app.collection c,
     core.sense old_s,
     core.lexeme old_l,
     core.deck_item di,
     core.sense cur_s,
     core.lexeme cur_l
LEFT JOIN LATERAL (
  SELECT g.text, g.is_machine, g.reviewed_by
  FROM core.sense_gloss g
  WHERE g.sense_id = cur_s.id AND g.language_id = 3
  ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
  LIMIT 1
) vi ON true
LEFT JOIN LATERAL (
  SELECT g.text
  FROM core.sense_gloss g
  WHERE g.sense_id = cur_s.id AND g.language_id = 1
  ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
  LIMIT 1
) en ON true
WHERE ci.collection_id = c.id
  AND c.cloned_from_deck_id IN (SELECT id FROM core.deck WHERE language_id = 1)
  AND old_s.id = ci.anchor_sense_id
  AND old_l.id = old_s.lexeme_id
  AND di.deck_id = c.cloned_from_deck_id
  AND cur_s.id = di.anchor_sense_id
  AND cur_l.id = cur_s.lexeme_id
  AND lower(cur_l.lemma) = lower(old_l.lemma);

-- Cập nhật face.sense_id tương ứng cho các mặt tiếng Anh trong collection_item
UPDATE app.collection_item_face f
SET sense_id = ci.anchor_sense_id
FROM app.collection_item ci
JOIN app.collection c ON c.id = ci.collection_id
WHERE f.item_id = ci.id
  AND f.language_id = 1
  AND c.cloned_from_deck_id IN (SELECT id FROM core.deck WHERE language_id = 1)
  AND f.sense_id IS DISTINCT FROM ci.anchor_sense_id;

COMMIT;
