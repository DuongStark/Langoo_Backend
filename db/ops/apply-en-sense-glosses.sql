-- Thêm gloss VI cho 48k sense EN còn thiếu (dịch muse từ định nghĩa EN).
-- Requires: staging.tmp_en_gloss (sense_id, vi).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('en-sense-gloss-20261011'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; dup int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_en_gloss t
    LEFT JOIN core.sense s ON s.id=t.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id AND l.language_id=1
    WHERE s.id IS NULL OR l.id IS NULL OR btrim(t.vi)='';
  IF bad<>0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO dup FROM core.sense_gloss g
    WHERE g.language_id=3 AND g.source_id=181;
  IF dup<>0 THEN RAISE EXCEPTION 'already applied: %', dup; END IF;
END $$;

INSERT INTO public.source(id, code, name, license, attribution, version)
VALUES (181, 'b2-align-muse-vi-sense-1',
        'B2 mở rộng — gloss VI cho sense EN còn thiếu (muse-spark-1.3-contributor)',
        'Nội dung: định nghĩa EN (WordNet/Wiktionary — license gốc); dịch bởi muse (máy)',
        'Sinh bởi mô hình, chưa kiểm duyệt', 'v1');

INSERT INTO staging.import_batch(source_code, file_name, sha256, row_count, status, finished_at)
SELECT 'b2-align-muse-vi-sense-1', 'en-sense-gloss-2026-10-11', :'sha256', count(*), 'completed', now()
FROM staging.tmp_en_gloss;

INSERT INTO core.sense_gloss(sense_id, language_id, text, is_machine, rank, source_id, batch_id)
SELECT t.sense_id, 3, t.vi, true, 1, 181,
       (SELECT id FROM staging.import_batch WHERE source_code='b2-align-muse-vi-sense-1' ORDER BY started_at DESC LIMIT 1)
FROM staging.tmp_en_gloss t
WHERE btrim(t.vi) <> ''
  AND NOT EXISTS (SELECT 1 FROM core.sense_gloss g WHERE g.sense_id=t.sense_id AND g.language_id=3);

\echo '--- gloss VI mới (source 181):'
SELECT count(*) FROM core.sense_gloss WHERE source_id=181;
\echo '--- sense EN có VI sau apply:'
SELECT count(*) FROM core.sense s JOIN core.lexeme l ON l.id=s.lexeme_id AND l.language_id=1
WHERE EXISTS (SELECT 1 FROM core.sense_gloss g WHERE g.sense_id=s.id AND g.language_id=3);
COMMIT;
