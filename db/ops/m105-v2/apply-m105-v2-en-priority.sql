-- M10.5-v2: EN sense priority mở rộng (rank <= 20k) — merged artifact v1+v2.
-- Requires: staging.tmp_m105_v2_rows loaded from m105-merged-rows.tsv.
-- Run UUID: bb277a78-ec6f-4388-bc82-b17a2ec5c143 | policy giữ nguyên en-m10.5-v1.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('m10.5-en-priority-v2'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; dup uuid;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_m105_v2_rows r
    LEFT JOIN core.sense s ON s.id=r.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id
    LEFT JOIN public.language lg ON lg.id=l.language_id
    WHERE s.id IS NULL OR lg.code<>'en' OR lower(l.lemma)<>lower(r.lemma);
  IF bad<>0 THEN RAISE EXCEPTION 'm105v2 rows invalid: %', bad; END IF;
  SELECT id INTO dup FROM core.dictionary_priority_run
    WHERE artifact_sha256='76fe396c344f0e6a08d65f98de8e26bee2512d041f33f7159b9b616f1357023d'
      AND target_identity='langoo-vps:langoo:en-m10.5-bulk-v2' LIMIT 1;
  IF dup IS NOT NULL THEN RAISE EXCEPTION 'artifact already imported: %', dup; END IF;
END $$;

INSERT INTO core.dictionary_priority_run(id,policy,language_id,source_code,source_version,source_sha256,artifact_sha256,target_identity,summary)
SELECT 'bb277a78-ec6f-4388-bc82-b17a2ec5c143','en-m10.5-v1',id,'muse-native','m10.5-v2-bulk',
  '74bdd0ab1dde0863ff64452df8096479b3aa28b6c49bc20649155d4d8a966cff',
  '76fe396c344f0e6a08d65f98de8e26bee2512d041f33f7159b9b616f1357023d',
  'langoo-vps:langoo:en-m10.5-bulk-v2',
  jsonb_build_object(
    'words_total',17450,'words_v1',5000,'words_v2',12450,
    'sense_rows',28115,'sense_rows_v1',9646,'sense_rows_v2',18469,
    'provider','muse_native','model','muse-spark-1.3-contributor',
    'ranking_prompt','m10.5-native-ranking-v2 (API mirror)',
    'artifact','m105-merged-rows.tsv = results-merged-20261008 (v1) + curated-v2 selections')
FROM public.language WHERE code='en';

INSERT INTO core.sense_learner_priority(run_id,sense_id,lexeme_id,input_hash,display_order,reason,reviewer_kind)
SELECT 'bb277a78-ec6f-4388-bc82-b17a2ec5c143', s.id, s.lexeme_id,
       core.english_sense_input_hash(s.id), r.display_order, r.reason, 'llm'
FROM staging.tmp_m105_v2_rows r JOIN core.sense s ON s.id=r.sense_id;

DO $$
DECLARE n int; expect int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_learner_priority WHERE run_id='bb277a78-ec6f-4388-bc82-b17a2ec5c143';
  SELECT count(*) INTO expect FROM staging.tmp_m105_v2_rows;
  IF n<>expect THEN RAISE EXCEPTION 'inserted % <> expected %', n, expect; END IF;
END $$;

UPDATE core.dictionary_priority_run SET active=false WHERE policy='en-m10.5-v1' AND active AND id<>'bb277a78-ec6f-4388-bc82-b17a2ec5c143';
UPDATE core.dictionary_priority_run SET active=true WHERE id='bb277a78-ec6f-4388-bc82-b17a2ec5c143';
ANALYZE core.sense_learner_priority;
ANALYZE core.dictionary_priority_run;

\echo '--- serve.english_sense_priority:'
SELECT count(*) FROM serve.english_sense_priority;
COMMIT;
