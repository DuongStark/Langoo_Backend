-- M10.5: apply EN sense priority (muse native, common-5000-ready-20261007).
-- Requires: 041_english_learner_priority.sql applied; staging.tmp_m105_rows loaded from m105-rows.tsv.
-- Run UUID fixed for traceability: fbd1cd59-3d7d-45db-9d6d-506ca5d13333
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('m10.5-en-priority-v1'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='300s';

DO $$
DECLARE bad int; dup uuid;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_m105_rows r
    LEFT JOIN core.sense s ON s.id=r.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id
    LEFT JOIN public.language lg ON lg.id=l.language_id
    WHERE s.id IS NULL OR lg.code<>'en' OR lower(l.lemma)<>lower(r.lemma);
  IF bad<>0 THEN RAISE EXCEPTION 'm105 rows invalid: %', bad; END IF;
  SELECT id INTO dup FROM core.dictionary_priority_run
    WHERE artifact_sha256='09cc717c28ebc27ac288819aea4966f9fa98f35a6e78438ec75d63a1f9203488'
      AND target_identity='langoo-vps:langoo:en-m10.5-bulk-v1' LIMIT 1;
  IF dup IS NOT NULL THEN RAISE EXCEPTION 'artifact already imported: %', dup; END IF;
END $$;

INSERT INTO core.dictionary_priority_run(id,policy,language_id,source_code,source_version,source_sha256,artifact_sha256,target_identity,summary)
SELECT 'fbd1cd59-3d7d-45db-9d6d-506ca5d13333','en-m10.5-v1',id,'muse-native','m10.5-bulk-v1',
  '742996a2b6908000abde8e8151e04dcedad8867180aa9b957e2a4859a005efbe',
  '09cc717c28ebc27ac288819aea4966f9fa98f35a6e78438ec75d63a1f9203488',
  'langoo-vps:langoo:en-m10.5-bulk-v1',
  jsonb_build_object(
    'words_total',5000,'words_with_selections',4882,'zero_selection',118,
    'sense_rows',9646,'needs_review',244,'provider','muse_native',
    'source_policy','muse_direct_no_semantic_recheck',
    'artifact','results-merged-20261008.jsonl')
FROM public.language WHERE code='en';

INSERT INTO core.sense_learner_priority(run_id,sense_id,lexeme_id,input_hash,display_order,reason,reviewer_kind)
SELECT 'fbd1cd59-3d7d-45db-9d6d-506ca5d13333', s.id, s.lexeme_id,
       core.english_sense_input_hash(s.id), r.display_order, r.reason, 'llm'
FROM staging.tmp_m105_rows r JOIN core.sense s ON s.id=r.sense_id;

DO $$
DECLARE n int; expect int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_learner_priority WHERE run_id='fbd1cd59-3d7d-45db-9d6d-506ca5d13333';
  SELECT count(*) INTO expect FROM staging.tmp_m105_rows;
  IF n<>expect THEN RAISE EXCEPTION 'inserted % <> expected %', n, expect; END IF;
END $$;

UPDATE core.dictionary_priority_run SET active=false WHERE policy='en-m10.5-v1' AND active AND id<>'fbd1cd59-3d7d-45db-9d6d-506ca5d13333';
UPDATE core.dictionary_priority_run SET active=true WHERE id='fbd1cd59-3d7d-45db-9d6d-506ca5d13333';
ANALYZE core.sense_learner_priority;
ANALYZE core.dictionary_priority_run;

\echo '--- view serve.english_sense_priority rows:'
SELECT count(*) FROM serve.english_sense_priority;
COMMIT;
