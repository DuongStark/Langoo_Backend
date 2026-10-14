-- DB4-D6 expansion promote: gắn proposal LLM đợt expansion (13.749 sense) vào core.sense_concept.
-- Requires: staging.tmp_db4_promote_exp (ext_id text, concept_id bigint, tier 1|2) đã load từ
--   final-high.jsonl (tier1) + final-tier2.jsonl (tier2).
-- Không đụng baseline; ON CONFLICT bỏ qua cặp đã tồn tại (kể cả 479 links đợt 1).
-- KHÔNG tự động refresh serve.sense_pair/sense_card (D7 — chạy riêng khi mở serving).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('db4-promote-expansion-20261014'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='900s';

DO $$
DECLARE bad int; miss int; dup bigint; n bigint; n2 bigint;
BEGIN
  SELECT count(*) INTO n FROM staging.tmp_db4_promote_exp;
  IF n = 0 THEN RAISE EXCEPTION 'staging rỗng'; END IF;
  SELECT count(*) INTO bad FROM staging.tmp_db4_promote_exp t
    LEFT JOIN core.concept c ON c.id = t.concept_id
    WHERE c.id IS NULL OR t.tier NOT IN (1,2);
  IF bad <> 0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO miss FROM staging.tmp_db4_promote_exp t
    LEFT JOIN core.sense s ON s.external_id = t.ext_id
    WHERE s.id IS NULL;
  IF miss <> 0 THEN RAISE EXCEPTION 'sense chưa map (external_id): %', miss; END IF;
  SELECT count(*) INTO n2 FROM staging.tmp_db4_promote_exp t
    JOIN core.sense s ON s.external_id = t.ext_id;
  IF n2 <> n THEN RAISE EXCEPTION 'join staging<->core.sense không 1-1: % vs %', n, n2; END IF;
  SELECT count(*) INTO dup FROM core.mapping_run WHERE run_key = 'db4-llm-exact-expansion-20261014';
  IF dup <> 0 THEN RAISE EXCEPTION 'run key đã tồn tại (đã apply?)'; END IF;
END $$;

-- mapping run (provenance + rollback theo mapping_run_id)
INSERT INTO core.mapping_run(run_key, task, algorithm, model, prompt_version, source_snapshot, parameters, status, finished_at)
VALUES ('db4-llm-exact-expansion-20261014', 'sense_concept_promote', 'db4-d4-d5-llm-v1',
        'muse-spark-1.3-contributor + muse-ai-native + deepseek-v4-flash-vision', 'v1',
        jsonb_build_object('cohort', 'jlpt-n1-n5', 'batch', 'expansion-13749',
                           'artifacts', '/opt/langoo/storage/db4-batches/db4-expansion-2026-10-12/'),
        jsonb_build_object('tier_confidence', jsonb_build_object('t1', 0.9, 't2', 0.7),
                           'note', 'vòng 2: 434 tier2 (238 cứu từ disputes); disputes/unresolved excluded; serve refresh = D7 riêng'),
        'completed', now());

-- batch (provenance file)
INSERT INTO staging.import_batch(source_code, file_name, sha256, row_count, status, finished_at)
SELECT 'llm-sense-concept-v1', 'db4-promote-expansion-2026-10-14', :'sha256', count(*), 'completed', now()
FROM staging.tmp_db4_promote_exp;

-- promote (không đụng baseline; bỏ qua nếu cặp đã tồn tại)
INSERT INTO core.sense_concept(sense_id, concept_id, relation, confidence, method, verified, source_id, batch_id, mapping_run_id, decided_at)
SELECT s.id, t.concept_id, 'exact',
       CASE WHEN t.tier = 1 THEN 0.9 ELSE 0.7 END,
       'llm_exact_v1', false, 183,
       (SELECT id FROM staging.import_batch WHERE source_code='llm-sense-concept-v1' ORDER BY started_at DESC LIMIT 1),
       (SELECT id FROM core.mapping_run WHERE run_key='db4-llm-exact-expansion-20261014'),
       now()
FROM staging.tmp_db4_promote_exp t
JOIN core.sense s ON s.external_id = t.ext_id
ON CONFLICT (sense_id, concept_id) DO NOTHING;

\echo '--- mapping expansion (theo run):'
SELECT count(*) AS promoted_exp, count(*) FILTER (WHERE confidence >= 0.9) AS tier1 FROM core.sense_concept
 WHERE mapping_run_id = (SELECT id FROM core.mapping_run WHERE run_key='db4-llm-exact-expansion-20261014');
\echo '--- tổng source 183:'
SELECT count(*) FROM core.sense_concept WHERE source_id=183;
\echo '--- tổng sense_concept:'
SELECT count(*) FROM core.sense_concept;
\echo '--- 5 dòng mới nhất (smoke):'
SELECT s.external_id, sc.concept_id, sc.confidence, sc.method, sc.verified
FROM core.sense_concept sc JOIN core.sense s ON s.id = sc.sense_id
WHERE sc.mapping_run_id = (SELECT id FROM core.mapping_run WHERE run_key='db4-llm-exact-expansion-20261014')
ORDER BY sc.decided_at DESC LIMIT 5;
COMMIT;

-- ROLLBACK:
--   DELETE FROM core.sense_concept WHERE mapping_run_id = (SELECT id FROM core.mapping_run WHERE run_key='db4-llm-exact-expansion-20261014');
--   DELETE FROM staging.import_batch WHERE file_name='db4-promote-expansion-2026-10-14';
--   DELETE FROM core.mapping_run WHERE run_key='db4-llm-exact-expansion-20261014';
