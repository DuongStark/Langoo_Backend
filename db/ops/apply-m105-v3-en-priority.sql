-- M10.5-v3: EN sense priority mở rộng rank 20k-50k — merged artifact v1+v2+v3.
-- Requires: staging.tmp_m105_v3_rows loaded from m105-v3-merged-rows.tsv (dedupe sense_id).
-- Run UUID: e83c5b82-c025-4917-af70-5dc7420599c8 | policy giữ nguyên en-m10.5-v1.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('m10.5-en-priority-v3'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; dup uuid;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_m105_v3_rows r
    LEFT JOIN core.sense s ON s.id=r.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id
    LEFT JOIN public.language lg ON lg.id=l.language_id
    WHERE s.id IS NULL OR lg.code<>'en' OR lower(l.lemma)<>lower(r.lemma);
  IF bad<>0 THEN RAISE EXCEPTION 'm105v3 rows invalid: %', bad; END IF;
  SELECT id INTO dup FROM core.dictionary_priority_run
    WHERE artifact_sha256='7c2d0c506bfbbb81e145e1327c13dfb68b05f34aa62c503f34a84980a06a0f03'
      AND target_identity='langoo-vps:langoo:en-m10.5-bulk-v3' LIMIT 1;
  IF dup IS NOT NULL THEN RAISE EXCEPTION 'artifact already imported: %', dup; END IF;
END $$;

INSERT INTO core.dictionary_priority_run(id,policy,language_id,source_code,source_version,source_sha256,artifact_sha256,target_identity,summary)
SELECT 'e83c5b82-c025-4917-af70-5dc7420599c8','en-m10.5-v1',id,'muse-native','m10.5-v3-bulk',
  '1e07a845f74106d7f01453b2d902200723b4a9ccbbd1311c2e5ca135a60b0694',
  '7c2d0c506bfbbb81e145e1327c13dfb68b05f34aa62c503f34a84980a06a0f03',
  'langoo-vps:langoo:en-m10.5-bulk-v3',
  jsonb_build_object(
    'words_total',38235,'words_v1',5000,'words_v2',12450,'words_v3',20785,
    'sense_rows',53536,'sense_rows_v1',9646,'sense_rows_v2',18469,'sense_rows_v3',25423,
    'provider','muse_native','model','muse-spark-1.3-contributor',
    'ranking_prompt','m10.5-native-ranking-v2 (API mirror)',
    'artifact','m105-v3-merged-rows.tsv = v1 + curated-v2 + curated-v3 (dedupe sense_id)')
FROM public.language WHERE code='en';

INSERT INTO core.sense_learner_priority(run_id,sense_id,lexeme_id,input_hash,display_order,reason,reviewer_kind)
SELECT 'e83c5b82-c025-4917-af70-5dc7420599c8', s.id, s.lexeme_id,
       core.english_sense_input_hash(s.id), r.display_order, r.reason, 'llm'
FROM staging.tmp_m105_v3_rows r
JOIN core.sense s ON s.id=r.sense_id
JOIN core.lexeme l ON l.id=s.lexeme_id
JOIN public.language lg ON lg.id=l.language_id
WHERE lg.code='en' AND lower(l.lemma)=lower(r.lemma);

DO $$
DECLARE n int; valid int; skipped int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_learner_priority WHERE run_id='e83c5b82-c025-4917-af70-5dc7420599c8';
  SELECT count(*) INTO valid FROM staging.tmp_m105_v3_rows r
    JOIN core.sense s ON s.id=r.sense_id
    JOIN core.lexeme l ON l.id=s.lexeme_id
    JOIN public.language lg ON lg.id=l.language_id
    WHERE lg.code='en' AND lower(l.lemma)=lower(r.lemma);
  skipped := (SELECT count(*) FROM staging.tmp_m105_v3_rows) - valid;
  IF n<>valid THEN RAISE EXCEPTION 'inserted % <> valid %', n, valid; END IF;
  UPDATE core.dictionary_priority_run
    SET summary = summary || jsonb_build_object('rows_inserted', n, 'rows_skipped_lemma_mismatch', skipped)
    WHERE id='e83c5b82-c025-4917-af70-5dc7420599c8';
  RAISE NOTICE 'inserted %, skipped %', n, skipped;
END $$;

UPDATE core.dictionary_priority_run SET active=false WHERE policy='en-m10.5-v1' AND active AND id<>'e83c5b82-c025-4917-af70-5dc7420599c8';
UPDATE core.dictionary_priority_run SET active=true WHERE id='e83c5b82-c025-4917-af70-5dc7420599c8';
ANALYZE core.sense_learner_priority;
ANALYZE core.dictionary_priority_run;

\echo '--- serve.english_sense_priority:'
SELECT count(*) FROM serve.english_sense_priority;
COMMIT;
