-- Vòng 2: gloss VI cho sense EN có định nghĩa trong core.sense.definition (OEWN).
-- Requires: staging.tmp_en_gloss2 (sense_id, vi).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('en-sense-gloss-20261011-2'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

INSERT INTO staging.import_batch(source_code, file_name, sha256, row_count, status, finished_at)
SELECT 'b2-align-muse-vi-sense-1', 'en-sense-gloss2-2026-10-11', :'sha256', count(*), 'completed', now()
FROM staging.tmp_en_gloss2;

DO $$
DECLARE bad int; dup int; bid uuid;
BEGIN
  SELECT id INTO bid FROM staging.import_batch WHERE file_name='en-sense-gloss2-2026-10-11' ORDER BY started_at DESC LIMIT 1;
  SELECT count(*) INTO bad FROM staging.tmp_en_gloss2 t
    LEFT JOIN core.sense s ON s.id=t.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id AND l.language_id=1
    WHERE s.id IS NULL OR l.id IS NULL OR btrim(t.vi)='';
  IF bad<>0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO dup FROM core.sense_gloss g WHERE g.batch_id=bid;
  IF dup<>0 THEN RAISE EXCEPTION 'already applied: %', dup; END IF;
END $$;

INSERT INTO core.sense_gloss(sense_id, language_id, text, is_machine, rank, source_id, batch_id)
SELECT t.sense_id, 3, t.vi, true, 1, 181,
       (SELECT id FROM staging.import_batch WHERE file_name='en-sense-gloss2-2026-10-11' ORDER BY started_at DESC LIMIT 1)
FROM staging.tmp_en_gloss2 t
WHERE btrim(t.vi) <> ''
  AND NOT EXISTS (SELECT 1 FROM core.sense_gloss g WHERE g.sense_id=t.sense_id AND g.language_id=3);

\echo '--- gloss vòng 2:'
SELECT count(*) FROM core.sense_gloss WHERE source_id=181;
\echo '--- sense EN có VI sau vòng 2:'
SELECT count(*) FROM core.sense s JOIN core.lexeme l ON l.id=s.lexeme_id AND l.language_id=1
WHERE EXISTS (SELECT 1 FROM core.sense_gloss g WHERE g.sense_id=s.id AND g.language_id=3);
COMMIT;
