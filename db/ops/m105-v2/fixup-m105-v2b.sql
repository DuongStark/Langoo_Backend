\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('m10.5-en-priority-v2-fix2'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_learner_priority WHERE run_id='bb277a78-ec6f-4388-bc82-b17a2ec5c143';
  IF n<>0 THEN RAISE EXCEPTION 'run already has % rows', n; END IF;
END $$;
INSERT INTO core.sense_learner_priority(run_id,sense_id,lexeme_id,input_hash,display_order,reason,reviewer_kind)
SELECT 'bb277a78-ec6f-4388-bc82-b17a2ec5c143', s.id, s.lexeme_id,
       core.english_sense_input_hash(s.id), r.display_order, r.reason, 'llm'
FROM staging.tmp_m105_v2_rows r
JOIN core.sense s ON s.id=r.sense_id
JOIN core.lexeme l ON l.id=s.lexeme_id
JOIN public.language lg ON lg.id=l.language_id
WHERE lg.code='en' AND lower(l.lemma)=lower(r.lemma);
DO $$
DECLARE n int; valid int; skipped int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_learner_priority WHERE run_id='bb277a78-ec6f-4388-bc82-b17a2ec5c143';
  SELECT count(*) INTO valid FROM staging.tmp_m105_v2_rows r
    JOIN core.sense s ON s.id=r.sense_id
    JOIN core.lexeme l ON l.id=s.lexeme_id
    JOIN public.language lg ON lg.id=l.language_id
    WHERE lg.code='en' AND lower(l.lemma)=lower(r.lemma);
  skipped := (SELECT count(*) FROM staging.tmp_m105_v2_rows) - valid;
  IF n<>valid THEN RAISE EXCEPTION 'inserted % <> valid %', n, valid; END IF;
  UPDATE core.dictionary_priority_run
    SET summary = summary || jsonb_build_object('rows_inserted', n, 'rows_skipped_lemma_mismatch', skipped)
    WHERE id='bb277a78-ec6f-4388-bc82-b17a2ec5c143';
  RAISE NOTICE 'inserted %, skipped %', n, skipped;
END $$;
ANALYZE core.sense_learner_priority;
\echo '--- view rows:'
SELECT count(*) FROM serve.english_sense_priority;
COMMIT;
