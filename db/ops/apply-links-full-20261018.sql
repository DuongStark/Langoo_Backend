-- DB4-LINKS full apply: 40.135 mapping (high 28.576 @0.9 + tier2 11.559 @0.7) từ job links 246k sense.
-- Requires: staging.tmp_links_full (sense_id bigint, concept_id bigint, tier smallint).
-- KHÔNG tự refresh serve (chạy tay sau COMMIT).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('db4-links-full-20261018'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='900s';

DO $$
DECLARE bad int; n bigint; dup int;
BEGIN
  SELECT count(*) INTO n FROM staging.tmp_links_full;
  IF n = 0 THEN RAISE EXCEPTION 'staging rỗng'; END IF;
  SELECT count(*) INTO bad FROM staging.tmp_links_full t
    LEFT JOIN core.concept c ON c.id = t.concept_id
    LEFT JOIN core.sense s ON s.id = t.sense_id
    WHERE c.id IS NULL OR s.id IS NULL OR t.tier NOT IN (1,2);
  IF bad <> 0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO dup FROM core.mapping_run WHERE run_key = 'db4-llm-links-full-20261018';
  IF dup <> 0 THEN RAISE EXCEPTION 'run key đã tồn tại (đã apply?)'; END IF;
END $$;

INSERT INTO core.mapping_run(run_key, task, algorithm, model, prompt_version, source_snapshot, parameters, status, finished_at)
VALUES ('db4-llm-links-full-20261018', 'sense_concept_promote', 'db4-links-full-llm-v1',
        'muse-spark-1.3-contributor + deepseek-v4.1-flash + muse-ai-native', 'v1',
        jsonb_build_object('cohort', 'jmdict-unmapped-246166', 'batch', 'links-full-20261018',
                           'artifacts', '/opt/langoo/storage/db4-links/'),
        jsonb_build_object('tier_confidence', jsonb_build_object('t1', 0.9, 't2', 0.7),
                           'gates', 'pick -> confirmA(muse-spark) -> confirmB(deepseek/native)',
                           'note', 'tier2 gồm 3.427 mục confirmB lỗi 502 chưa qua cửa 3; retry sau để nâng cấp'),
        'completed', now());

INSERT INTO staging.import_batch(source_code, file_name, sha256, row_count, status, finished_at)
SELECT 'llm-sense-concept-v1', 'db4-links-full-2026-10-18', :'sha256', count(*), 'completed', now()
FROM staging.tmp_links_full;

INSERT INTO core.sense_concept(sense_id, concept_id, relation, confidence, method, verified, source_id, batch_id, mapping_run_id, decided_at)
SELECT t.sense_id, t.concept_id, 'exact',
       CASE WHEN t.tier = 1 THEN 0.9 ELSE 0.7 END,
       'llm_exact_v1', false, 183,
       (SELECT id FROM staging.import_batch WHERE source_code='llm-sense-concept-v1' ORDER BY started_at DESC LIMIT 1),
       (SELECT id FROM core.mapping_run WHERE run_key='db4-llm-links-full-20261018'),
       now()
FROM staging.tmp_links_full t
ON CONFLICT (sense_id, concept_id) DO NOTHING;

\echo '--- promoted theo run:'
SELECT count(*) AS promoted, count(*) FILTER (WHERE confidence >= 0.9) AS t1 FROM core.sense_concept
 WHERE mapping_run_id = (SELECT id FROM core.mapping_run WHERE run_key='db4-llm-links-full-20261018');
\echo '--- source 183 tổng:'
SELECT count(*) FROM core.sense_concept WHERE source_id=183;
\echo '--- jmdict sense có concept / tổng:'
SELECT count(distinct s.id) FROM core.sense s JOIN public.source sr ON sr.id=s.source_id
 JOIN core.sense_concept sc ON sc.sense_id=s.id WHERE sr.code='jmdict';
SELECT count(*) FROM core.sense s JOIN public.source sr ON sr.id=s.source_id WHERE sr.code='jmdict';
\echo '--- tổng sense_concept:'
SELECT count(*) FROM core.sense_concept;
COMMIT;

-- ROLLBACK:
--   DELETE FROM core.sense_concept WHERE mapping_run_id = (SELECT id FROM core.mapping_run WHERE run_key='db4-llm-links-full-20261018');
--   DELETE FROM staging.import_batch WHERE file_name='db4-links-full-2026-10-18';
--   DELETE FROM core.mapping_run WHERE run_key='db4-llm-links-full-20261018';
