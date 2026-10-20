-- Bộ từ mẫu tiếng Nhật v2 (13 deck): 5 deck JLPT refresh + 8 bộ mẫu
-- - Loại dạng chữ Hán hiếm (rK / common:false trong lexeme.attributes.kanji)
-- - 6 bộ chủ đề + starter-100: danh sách lemma CURATE TAY (staging file wanted)
-- - verbs-basic / adjectives-basic: auto theo POS (N5–N4) + tần suất
-- Yêu cầu: \copy staging.jlpt_deck_wanted_20261019 (slug, lemma) từ ja-decks-wanted.tsv
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('ja-decks-20261019'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='900s';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM staging.jlpt_deck_wanted_20261019;
  IF n < 300 THEN RAISE EXCEPTION 'wanted rows=% (quá ít)', n; END IF;
END $$;

-- 0a) JLPT pool: dedupe lemma, bỏ dạng hiếm, lấy sense tốt nhất + concept curated
CREATE TEMP TABLE pick_jlpt ON COMMIT DROP AS
WITH cand AS (
  SELECT DISTINCT ON (l.lemma)
         l.id AS lexeme_id, l.lemma, ll.level, jp.corpus_rank
  FROM core.lexeme_level ll
  JOIN core.lexeme l ON l.id = ll.lexeme_id AND l.language_id = 2
  LEFT JOIN serve.japanese_lexeme_priority jp ON jp.lexeme_id = ll.lexeme_id
  WHERE ll.scheme = 'JLPT'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(l.attributes->'kanji') = 'array' THEN l.attributes->'kanji' ELSE '[]'::jsonb END) k
      WHERE k->>'text' = l.lemma
        AND (k @> '{"common": false}'::jsonb OR (k->'tags') @> '["rK"]'::jsonb))
  ORDER BY l.lemma, jp.corpus_rank NULLS LAST, l.id
)
SELECT c.*, COALESCE(sp.sense_id, fb.fallback_sense) AS final_sense, cm.concept_id
FROM cand c
LEFT JOIN LATERAL (
  SELECT p.sense_id FROM serve.japanese_sense_priority p
  WHERE p.lexeme_id = c.lexeme_id ORDER BY p.display_order LIMIT 1
) sp ON true
LEFT JOIN LATERAL (
  SELECT s.id AS fallback_sense FROM core.sense s
  WHERE s.lexeme_id = c.lexeme_id ORDER BY s.is_primary DESC, s.sense_no LIMIT 1
) fb ON true
LEFT JOIN LATERAL (
  SELECT sc.concept_id FROM core.sense_concept sc
  JOIN core.concept cc ON cc.id = sc.concept_id AND cc.status = 'curated'
  WHERE sc.sense_id = COALESCE(sp.sense_id, fb.fallback_sense) AND sc.confidence >= 0.7
  ORDER BY sc.confidence DESC, sc.concept_id LIMIT 1
) cm ON true;

DO $$
BEGIN
  IF (SELECT count(*) FROM pick_jlpt WHERE final_sense IS NULL) > 0 THEN
    RAISE EXCEPTION 'pick_jlpt thiếu sense';
  END IF;
END $$;

-- 0b) Curated pool: lemma từ staging → lexeme tốt nhất → sense + concept
CREATE TEMP TABLE pick_curated ON COMMIT DROP AS
WITH cand AS (
  SELECT DISTINCT ON (w.slug, w.lemma)
         w.slug, l.id AS lexeme_id, l.lemma, jp.corpus_rank
  FROM staging.jlpt_deck_wanted_20261019 w
  JOIN core.lexeme l ON l.language_id = 2 AND l.lemma = w.lemma
  LEFT JOIN serve.japanese_lexeme_priority jp ON jp.lexeme_id = l.id
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(l.attributes->'kanji') = 'array' THEN l.attributes->'kanji' ELSE '[]'::jsonb END) k
    WHERE k->>'text' = l.lemma
      AND (k @> '{"common": false}'::jsonb OR (k->'tags') @> '["rK"]'::jsonb))
  ORDER BY w.slug, w.lemma, jp.corpus_rank NULLS LAST, l.id
)
SELECT c.slug, c.lexeme_id, c.lemma, c.corpus_rank,
       COALESCE(sp.sense_id, fb.fallback_sense) AS final_sense, cm.concept_id
FROM cand c
LEFT JOIN LATERAL (
  SELECT p.sense_id FROM serve.japanese_sense_priority p
  WHERE p.lexeme_id = c.lexeme_id ORDER BY p.display_order LIMIT 1
) sp ON true
LEFT JOIN LATERAL (
  SELECT s.id AS fallback_sense FROM core.sense s
  WHERE s.lexeme_id = c.lexeme_id ORDER BY s.is_primary DESC, s.sense_no LIMIT 1
) fb ON true
LEFT JOIN LATERAL (
  SELECT sc.concept_id FROM core.sense_concept sc
  JOIN core.concept cc ON cc.id = sc.concept_id AND cc.status = 'curated'
  WHERE sc.sense_id = COALESCE(sp.sense_id, fb.fallback_sense) AND sc.confidence >= 0.7
  ORDER BY sc.confidence DESC, sc.concept_id LIMIT 1
) cm ON true;

-- 1) xoá items cũ 13 deck (idempotent)
DELETE FROM core.deck_item
 WHERE deck_id IN (SELECT id FROM core.deck WHERE slug IN
   ('jlpt-n1','jlpt-n2','jlpt-n3','jlpt-n4','jlpt-n5','starter-100','greetings','numbers-time','family','food','transport','verbs-basic','adjectives-basic'));

-- 2) 5 deck JLPT
INSERT INTO core.deck_item(deck_id, anchor_sense_id, concept_id, position)
SELECT d.id, p.final_sense, p.concept_id,
       row_number() OVER (PARTITION BY d.id ORDER BY p.corpus_rank NULLS LAST, p.lexeme_id)::int
FROM pick_jlpt p
JOIN core.deck d ON d.slug = 'jlpt-n' || p.level;

-- 3) upsert 8 deck mẫu + publish
INSERT INTO core.deck(slug, title, description, language_id, level_label, is_published) VALUES
 ('starter-100',      '100 từ tiếng Nhật đầu tiên', 'Bộ khởi động: 100 từ thông dụng nhất cho người mới (chọn tay).', 2, 'N5', true),
 ('greetings',        'Chào hỏi & giao tiếp cơ bản', 'Chào hỏi, cảm ơn, xin lỗi, giao tiếp hằng ngày (chọn tay).', 2, 'N5–N4', true),
 ('numbers-time',     'Số đếm · Giờ · Ngày tháng', 'Số đếm, giờ giấc, ngày tháng, mùa, thứ trong tuần.', 2, 'N5–N4', true),
 ('family',           'Gia đình & con người', 'Từ vựng về gia đình và con người.', 2, 'N5–N4', true),
 ('food',             'Đồ ăn & nhà hàng', 'Món ăn, đồ uống, nhà hàng, gọi món.', 2, 'N5–N4', true),
 ('transport',        'Đi lại & địa điểm', 'Phương tiện, nhà ga, đường đi, địa điểm.', 2, 'N5–N4', true),
 ('verbs-basic',      'Động từ cơ bản', 'Động từ N5–N4 theo tần suất (BCCWJ).', 2, 'N5–N4', true),
 ('adjectives-basic', 'Tính từ cơ bản', 'Tính từ N5–N4 theo tần suất (BCCWJ).', 2, 'N5–N4', true)
ON CONFLICT (slug) DO UPDATE
  SET title = EXCLUDED.title, description = EXCLUDED.description,
      language_id = EXCLUDED.language_id, level_label = EXCLUDED.level_label,
      is_published = true;

UPDATE core.deck SET is_published = true WHERE slug LIKE 'jlpt-n%';

-- 4) 6 bộ curated (cap: greetings 45, numbers-time 70, family 45, food 55, transport 55; starter 100)
WITH ranked AS (
  SELECT p.*,
         row_number() OVER (PARTITION BY p.slug ORDER BY p.corpus_rank NULLS LAST, p.lexeme_id)::int AS rn
  FROM pick_curated p
), capped AS (
  SELECT * FROM ranked r
  WHERE r.rn <= CASE r.slug
    WHEN 'starter-100' THEN 100 WHEN 'greetings' THEN 45 WHEN 'numbers-time' THEN 70
    WHEN 'family' THEN 45 WHEN 'food' THEN 55 WHEN 'transport' THEN 55 ELSE 0 END
)
INSERT INTO core.deck_item(deck_id, anchor_sense_id, concept_id, position)
SELECT d.id, c.final_sense, c.concept_id, c.rn
FROM capped c JOIN core.deck d ON d.slug = c.slug;

-- 5) verbs-basic / adjectives-basic (auto, N5–N4, frequency, rK-free pool)
INSERT INTO core.deck_item(deck_id, anchor_sense_id, concept_id, position)
SELECT (SELECT id FROM core.deck WHERE slug = 'verbs-basic'), s.final_sense, s.concept_id, s.rn
FROM (SELECT p.*, row_number() OVER (ORDER BY p.corpus_rank NULLS LAST, p.lexeme_id)::int AS rn
      FROM pick_jlpt p
      JOIN core.lexeme l ON l.id = p.lexeme_id
      WHERE p.level IN (4,5) AND l.pos = 'verb') s WHERE s.rn <= 100;

INSERT INTO core.deck_item(deck_id, anchor_sense_id, concept_id, position)
SELECT (SELECT id FROM core.deck WHERE slug = 'adjectives-basic'), s.final_sense, s.concept_id, s.rn
FROM (SELECT p.*, row_number() OVER (ORDER BY p.corpus_rank NULLS LAST, p.lexeme_id)::int AS rn
      FROM pick_jlpt p
      JOIN core.lexeme l ON l.id = p.lexeme_id
      WHERE p.level IN (4,5) AND l.pos = 'adjective') s WHERE s.rn <= 80;

-- 6) item_count
UPDATE core.deck d
   SET item_count = COALESCE(c.n, 0)
  FROM (SELECT deck_id, count(*) AS n FROM core.deck_item GROUP BY deck_id) c
 WHERE c.deck_id = d.id;

\echo '--- 13 deck:';
SELECT id, slug, item_count, is_published FROM core.deck ORDER BY id;
\echo '--- mẫu starter-100 (10 từ đầu):';
SELECT di.position || '. ' || l.lemma || ' — ' || coalesce((SELECT g.text FROM core.sense_gloss g WHERE g.sense_id = s.id AND g.language_id = 3 ORDER BY g.rank, g.id LIMIT 1), '(chưa VI)')
FROM core.deck_item di JOIN core.sense s ON s.id = di.anchor_sense_id JOIN core.lexeme l ON l.id = s.lexeme_id
WHERE di.deck_id = (SELECT id FROM core.deck WHERE slug = 'starter-100') ORDER BY di.position LIMIT 10;
\echo '--- mẫu greetings (10 từ đầu):';
SELECT di.position || '. ' || l.lemma
FROM core.deck_item di JOIN core.sense s ON s.id = di.anchor_sense_id JOIN core.lexeme l ON l.id = s.lexeme_id
WHERE di.deck_id = (SELECT id FROM core.deck WHERE slug = 'greetings') ORDER BY di.position LIMIT 10;
COMMIT;
