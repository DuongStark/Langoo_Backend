-- Chính sách 15/10 (chủ dự án): máy dịch/mapping máy MẶC ĐỊNH OK — không chờ duyệt trước;
-- sai thì user report → admin sửa sau (M14). Đây là đợt 2: mở serve cho run links 246k.
-- Script: concept có mapping từ run 'db4-llm-links-full-20261018' mà còn draft → curated,
-- giữ reviewed_by = NULL ("máy mặc định duyệt"). Journal rollback: staging.concept_default_accept_20261019.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='900s';

CREATE TABLE IF NOT EXISTS staging.concept_default_accept_20261019(
  concept_id bigint PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO staging.concept_default_accept_20261019(concept_id)
SELECT DISTINCT sc.concept_id
FROM core.sense_concept sc
JOIN core.mapping_run mr ON mr.id = sc.mapping_run_id
JOIN core.concept c ON c.id = sc.concept_id
WHERE mr.run_key = 'db4-llm-links-full-20261018' AND c.status = 'draft'
ON CONFLICT DO NOTHING;

UPDATE core.concept c SET status = 'curated'
FROM staging.concept_default_accept_20261019 t
WHERE c.id = t.concept_id AND c.status = 'draft';

\echo '--- journal rows:'
SELECT count(*) FROM staging.concept_default_accept_20261019;
\echo '--- status concept sau flip:'
SELECT status, count(*) AS n FROM core.concept GROUP BY status ORDER BY n DESC;
COMMIT;

\echo '--- refresh serve.sense_pair (khoảng 1 phút)...'
REFRESH MATERIALIZED VIEW CONCURRENTLY serve.sense_pair;
\echo '--- số cặp sau refresh:'
SELECT count(*) AS pairs FROM serve.sense_pair;

-- ROLLBACK (nếu cần):
--   UPDATE core.concept c SET status='draft'
--   FROM staging.concept_default_accept_20261019 t
--   WHERE c.id=t.concept_id AND c.reviewed_by IS NULL AND c.status='curated';
--   REFRESH MATERIALIZED VIEW CONCURRENTLY serve.sense_pair;
