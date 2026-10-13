-- Vá 160 sense JA thiếu gloss VI (dịch muse). Requires staging.tmp_ja_gap (sense_id, vi).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('ja-sense-gap-20261013'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='300s';

DO $$
DECLARE bad int; dup int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_ja_gap t
    LEFT JOIN core.sense s ON s.id=t.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id AND l.language_id=2
    WHERE s.id IS NULL OR l.id IS NULL OR btrim(t.vi)='';
  IF bad<>0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO dup FROM core.sense_gloss g WHERE g.source_id=182;
  IF dup<>0 THEN RAISE EXCEPTION 'already applied: %', dup; END IF;
END $$;

INSERT INTO public.source(id, code, name, license, attribution, version)
VALUES (182, 'llm-ja-sense-gap-1', 'Gloss VI vá sense JA thiếu (muse-spark-1.3-contributor)',
        'Nội dung: định nghĩa EN (JMdict/WordNet — license gốc); dịch bởi muse (máy)',
        'Sinh bởi mô hình, chưa kiểm duyệt', 'v1');

INSERT INTO staging.import_batch(source_code, file_name, sha256, row_count, status, finished_at)
SELECT 'llm-ja-sense-gap-1', 'ja-sense-gap-2026-10-13', :'sha256', count(*), 'completed', now()
FROM staging.tmp_ja_gap;

INSERT INTO core.sense_gloss(sense_id, language_id, text, is_machine, rank, source_id, batch_id)
SELECT t.sense_id, 3, t.vi, true, 1, 182,
       (SELECT id FROM staging.import_batch WHERE source_code='llm-ja-sense-gap-1' ORDER BY started_at DESC LIMIT 1)
FROM staging.tmp_ja_gap t
WHERE btrim(t.vi) <> ''
  AND NOT EXISTS (SELECT 1 FROM core.sense_gloss g WHERE g.sense_id=t.sense_id AND g.language_id=3);

\echo '--- gloss vá:'
SELECT count(*) FROM core.sense_gloss WHERE source_id=182;
\echo '--- sense JA trong từ có VI còn thiếu:'
WITH viled AS (SELECT DISTINCT s.lexeme_id FROM core.sense s JOIN core.sense_gloss g ON g.sense_id=s.id AND g.language_id=3
  JOIN core.lexeme l ON l.id=s.lexeme_id WHERE l.language_id=2)
SELECT count(*) FROM core.sense s JOIN viled ON viled.lexeme_id=s.lexeme_id
WHERE NOT EXISTS (SELECT 1 FROM core.sense_gloss g WHERE g.sense_id=s.id AND g.language_id=3);
COMMIT;
