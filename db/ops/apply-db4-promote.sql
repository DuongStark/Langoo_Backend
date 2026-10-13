-- DB4-D6 promote: gắn proposal LLM (muse+mimo confirm) vào core.sense_concept.
-- Requires: staging.tmp_db4_promote (sense_id, concept_id, tier 1|2).
-- KHÔNG tự động refresh serve.sense_pair/sense_card (D7 — chạy riêng sau khi đủ batch).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('db4-promote-20261013'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; dup int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_db4_promote t
    LEFT JOIN core.sense s ON s.id=t.sense_id
    LEFT JOIN core.concept c ON c.id=t.concept_id
    WHERE s.id IS NULL OR c.id IS NULL OR t.tier NOT IN (1,2);
  IF bad<>0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO dup FROM core.sense_concept sc
    WHERE sc.source_id = 183;
  IF dup<>0 THEN RAISE EXCEPTION 'already applied: %', dup; END IF;
END $$;

-- source cho mapping LLM
INSERT INTO public.source(id, code, name, license, attribution, version)
VALUES (183, 'llm-sense-concept-v1', 'Gán sense–concept bằng LLM (muse + mimo confirm)',
        'nội bộ', 'Sinh bởi mô hình, chưa kiểm duyệt', 'v1');

-- mapping run (provenance + rollback theo mapping_run_id)
INSERT INTO core.mapping_run(run_key, task, algorithm, model, prompt_version, source_snapshot, parameters, status, finished_at)
VALUES ('db4-llm-exact-20261013', 'sense_concept_promote', 'db4-d4-d5-llm-v1',
        'muse-spark-1.3-contributor + mimo-v2.6-flash', 'v1',
        jsonb_build_object('cohort', 'jlpt-n1-n5', 'batch', 'initial-1000-selected',
                           'artifacts', '/opt/langoo/storage/db4-batches/db4-d4-d5-final-2026-10-12/'),
        jsonb_build_object('audit', 'pilot A/B: 175/175 positive pass; precision >=98.3% (95% CI)',
                           'tier_confidence', jsonb_build_object('t1', 0.9, 't2', 0.7),
                           'note', 'disputes/unresolved excluded; serve refresh = D7 riêng'),
        'completed', now());

-- batch (provenance file)
INSERT INTO staging.import_batch(source_code, file_name, sha256, row_count, status, finished_at)
SELECT 'llm-sense-concept-v1', 'db4-promote-2026-10-13', :'sha256', count(*), 'completed', now()
FROM staging.tmp_db4_promote;

-- promote (không đụng baseline wordnet_synset; bỏ qua nếu cặp đã tồn tại)
INSERT INTO core.sense_concept(sense_id, concept_id, relation, confidence, method, verified, source_id, batch_id, mapping_run_id, decided_at)
SELECT t.sense_id, t.concept_id, 'exact',
       CASE WHEN t.tier = 1 THEN 0.9 ELSE 0.7 END,
       'llm_exact_v1', false, 183,
       (SELECT id FROM staging.import_batch WHERE source_code='llm-sense-concept-v1' ORDER BY started_at DESC LIMIT 1),
       (SELECT id FROM core.mapping_run WHERE run_key='db4-llm-exact-20261013'),
       now()
FROM staging.tmp_db4_promote t
ON CONFLICT (sense_id, concept_id) DO NOTHING;

\echo '--- mapping mới (source 183):'
SELECT count(*) AS promoted, count(*) FILTER (WHERE confidence >= 0.9) AS tier1 FROM core.sense_concept WHERE source_id=183;
\echo '--- tổng sense_concept:'
SELECT count(*) FROM core.sense_concept;
COMMIT;

-- ROLLBACK:
--   DELETE FROM core.sense_concept WHERE source_id=183;  -- hoặc theo mapping_run_id
--   DELETE FROM staging.import_batch WHERE source_code='llm-sense-concept-v1';
--   DELETE FROM core.mapping_run WHERE run_key='db4-llm-exact-20261013';
--   DELETE FROM public.source WHERE id=183;
--
-- D7 (sau khi đồng ý mở serving):
--   REFRESH MATERIALIZED VIEW serve.sense_pair;
--   REFRESH MATERIALIZED VIEW serve.sense_card;
