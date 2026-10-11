-- Trim Wiktextract EN (source_id=8) theo ngưỡng wordfreq <= 100000.
-- GIỮ: rank<=100k, lexeme/sense liên quan translation_assertion/target_candidate,
--       sense được deck/collection (user data) tham chiếu.
-- Dry-run: chạy file này (tạo staging.trim_doomed_* + in số đếm).
-- Apply:  loop gọi SELECT staging.trim_en_batch(b); cho b = 0..batch_count-1.
\set ON_ERROR_STOP on

DROP TABLE IF EXISTS staging.trim_keep_lexeme;
DROP TABLE IF EXISTS staging.trim_doomed_lexeme;
DROP TABLE IF EXISTS staging.trim_doomed_sense;

-- Tập "giữ" (set-based)
CREATE UNLOGGED TABLE staging.trim_keep_lexeme AS
SELECT id AS lexeme_id
FROM core.lexeme
WHERE language_id = 1 AND source_id = 8
  AND frequency_rank IS NOT NULL AND frequency_rank <= 100000
UNION
SELECT source_lexeme_id FROM core.translation_assertion
WHERE source_lexeme_id IS NOT NULL
UNION
SELECT s.lexeme_id
FROM core.translation_assertion a JOIN core.sense s ON s.id = a.source_sense_id
UNION
SELECT target_lexeme_id FROM core.translation_target_candidate
WHERE target_lexeme_id IS NOT NULL
UNION
SELECT s.lexeme_id
FROM core.translation_target_candidate c JOIN core.sense s ON s.id = c.target_sense_id
UNION
SELECT s.lexeme_id FROM core.deck_item d JOIN core.sense s ON s.id = d.anchor_sense_id
UNION
SELECT s.lexeme_id FROM app.collection_item c JOIN core.sense s ON s.id = c.anchor_sense_id
UNION
SELECT s.lexeme_id FROM app.collection_item_face f JOIN core.sense s ON s.id = f.sense_id;
ALTER TABLE staging.trim_keep_lexeme ADD PRIMARY KEY (lexeme_id);

CREATE UNLOGGED TABLE staging.trim_doomed_lexeme AS
SELECT l.id AS lexeme_id
FROM core.lexeme l
LEFT JOIN staging.trim_keep_lexeme k ON k.lexeme_id = l.id
WHERE l.language_id = 1 AND l.source_id = 8 AND k.lexeme_id IS NULL;
ALTER TABLE staging.trim_doomed_lexeme ADD PRIMARY KEY (lexeme_id);
ALTER TABLE staging.trim_doomed_lexeme ADD COLUMN batch_no int;
UPDATE staging.trim_doomed_lexeme d
SET batch_no = x.b
FROM (
  SELECT lexeme_id,
         ((row_number() OVER (ORDER BY lexeme_id) - 1) / 20000)::int AS b
  FROM staging.trim_doomed_lexeme
) x
WHERE x.lexeme_id = d.lexeme_id;
ALTER TABLE staging.trim_doomed_lexeme ALTER COLUMN batch_no SET NOT NULL;
CREATE INDEX trim_doomed_lexeme_batch ON staging.trim_doomed_lexeme (batch_no);

CREATE UNLOGGED TABLE staging.trim_doomed_sense AS
SELECT s.id AS sense_id
FROM core.sense s
JOIN staging.trim_doomed_lexeme d ON d.lexeme_id = s.lexeme_id;
ALTER TABLE staging.trim_doomed_sense ADD PRIMARY KEY (sense_id);
ALTER TABLE staging.trim_doomed_sense ADD COLUMN batch_no int;
UPDATE staging.trim_doomed_sense ds
SET batch_no = d.batch_no
FROM staging.trim_doomed_lexeme d, core.sense s
WHERE s.id = ds.sense_id AND s.lexeme_id = d.lexeme_id;
ALTER TABLE staging.trim_doomed_sense ALTER COLUMN batch_no SET NOT NULL;
CREATE INDEX trim_doomed_sense_batch ON staging.trim_doomed_sense (batch_no);

-- Xoá đúng 1 batch (mỗi lần gọi = 1 transaction).
CREATE OR REPLACE FUNCTION staging.trim_en_batch(b int) RETURNS void AS $$
DECLARE
  n_lex int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM core.translation_assertion a
    JOIN staging.trim_doomed_lexeme d ON d.lexeme_id = a.source_lexeme_id AND d.batch_no = b
  ) THEN
    RAISE EXCEPTION 'batch % đụng translation_assertion — dừng', b;
  END IF;

  DELETE FROM core.sense_concept_candidate_review r
  WHERE r.candidate_id IN (
    SELECT c.id FROM core.sense_concept_candidate c
    JOIN staging.trim_doomed_sense d ON d.sense_id = c.sense_id AND d.batch_no = b
  );

  DELETE FROM core.sense_concept_candidate c
  USING staging.trim_doomed_sense d
  WHERE c.sense_id = d.sense_id AND d.batch_no = b;

  DELETE FROM core.sense_concept sc
  USING staging.trim_doomed_sense d
  WHERE sc.sense_id = d.sense_id AND d.batch_no = b;

  DELETE FROM core.sense_relation r
  USING staging.trim_doomed_sense d
  WHERE d.batch_no = b
    AND (r.source_sense_id = d.sense_id OR r.target_sense_id = d.sense_id);

  DELETE FROM core.sense_relation_candidate r
  USING staging.trim_doomed_sense d
  WHERE d.batch_no = b
    AND (r.source_sense_id = d.sense_id OR r.target_sense_id = d.sense_id);

  CREATE TEMP TABLE IF NOT EXISTS _trim_example ON COMMIT DROP AS
  SELECT e.id AS example_id
  FROM core.example e
  JOIN staging.trim_doomed_sense d ON d.sense_id = e.sense_id AND d.batch_no = b;
  CREATE INDEX ON _trim_example (example_id);
  ANALYZE _trim_example;

  DELETE FROM core.example_annotation ea
  WHERE ea.canonical_example_id IN (SELECT example_id FROM _trim_example)
     OR ea.source_example_id IN (SELECT example_id FROM _trim_example);

  DELETE FROM core.example_translation et
  WHERE et.example_id IN (SELECT example_id FROM _trim_example)
     OR et.translation_id IN (SELECT example_id FROM _trim_example);

  DELETE FROM core.example_concept ec
  WHERE ec.example_id IN (SELECT example_id FROM _trim_example);

  DELETE FROM core.example_sense es
  WHERE es.sense_id IN (SELECT sense_id FROM staging.trim_doomed_sense WHERE batch_no = b)
     OR es.example_id IN (SELECT example_id FROM _trim_example);

  DELETE FROM core.example e
  WHERE e.id IN (SELECT example_id FROM _trim_example);

  DELETE FROM core.sense_gloss g
  USING staging.trim_doomed_sense d
  WHERE g.sense_id = d.sense_id AND d.batch_no = b;

  DELETE FROM core.sense_form f
  USING staging.trim_doomed_sense d
  WHERE f.sense_id = d.sense_id AND d.batch_no = b;

  DELETE FROM core.sense_tag t
  USING staging.trim_doomed_sense d
  WHERE t.sense_id = d.sense_id AND d.batch_no = b;

  DELETE FROM core.translation_target_candidate c
  WHERE c.target_lexeme_id IN (SELECT lexeme_id FROM staging.trim_doomed_lexeme WHERE batch_no = b)
     OR c.target_sense_id IN (SELECT sense_id FROM staging.trim_doomed_sense WHERE batch_no = b);

  DELETE FROM core.sense s
  WHERE s.lexeme_id IN (SELECT lexeme_id FROM staging.trim_doomed_lexeme WHERE batch_no = b);

  DELETE FROM core.pronunciation p
  USING staging.trim_doomed_lexeme d
  WHERE p.lexeme_id = d.lexeme_id AND d.batch_no = b;

  DELETE FROM core.jlpt_link j
  USING staging.trim_doomed_lexeme d
  WHERE j.lexeme_id = d.lexeme_id AND d.batch_no = b;

  DELETE FROM core.lexeme_level lv
  USING staging.trim_doomed_lexeme d
  WHERE lv.lexeme_id = d.lexeme_id AND d.batch_no = b;

  DELETE FROM core.lexeme_form_applies_to fa
  WHERE fa.form_id IN (
      SELECT lf.id FROM core.lexeme_form lf
      JOIN staging.trim_doomed_lexeme d ON d.lexeme_id = lf.lexeme_id AND d.batch_no = b)
     OR fa.target_form_id IN (
      SELECT lf.id FROM core.lexeme_form lf
      JOIN staging.trim_doomed_lexeme d ON d.lexeme_id = lf.lexeme_id AND d.batch_no = b);

  DELETE FROM core.lexeme_form_char fc
  WHERE fc.form_id IN (
    SELECT lf.id FROM core.lexeme_form lf
    JOIN staging.trim_doomed_lexeme d ON d.lexeme_id = lf.lexeme_id AND d.batch_no = b);

  DELETE FROM core.lexeme_form_kanji_char fk
  WHERE fk.form_id IN (
    SELECT lf.id FROM core.lexeme_form lf
    JOIN staging.trim_doomed_lexeme d ON d.lexeme_id = lf.lexeme_id AND d.batch_no = b);

  DELETE FROM core.lexeme_form_tag ft
  WHERE ft.form_id IN (
    SELECT lf.id FROM core.lexeme_form lf
    JOIN staging.trim_doomed_lexeme d ON d.lexeme_id = lf.lexeme_id AND d.batch_no = b);

  DELETE FROM core.lexeme_form lf
  USING staging.trim_doomed_lexeme d
  WHERE lf.lexeme_id = d.lexeme_id AND d.batch_no = b;

  DELETE FROM core.source_form sf
  USING staging.trim_doomed_lexeme d
  WHERE sf.lexeme_id = d.lexeme_id AND d.batch_no = b;

  DELETE FROM core.source_entry_identity sei
  USING staging.trim_doomed_lexeme d
  WHERE sei.lexeme_id = d.lexeme_id AND d.batch_no = b;

  DELETE FROM core.lexeme l
  USING staging.trim_doomed_lexeme d
  WHERE l.id = d.lexeme_id AND d.batch_no = b;

  GET DIAGNOSTICS n_lex = ROW_COUNT;
  RAISE NOTICE 'batch %: xoá % lexeme', b, n_lex;
END;
$$ LANGUAGE plpgsql;

ANALYZE staging.trim_doomed_lexeme;
ANALYZE staging.trim_doomed_sense;

-- Đếm dry-run
SELECT 'doomed_lexeme' AS muc, count(*) FROM staging.trim_doomed_lexeme
UNION ALL SELECT 'doomed_sense', count(*) FROM staging.trim_doomed_sense
UNION ALL SELECT 'batch_count', count(DISTINCT batch_no) FROM staging.trim_doomed_lexeme;
