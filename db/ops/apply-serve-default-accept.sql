-- Chính sách 15/10 (chủ dự án): máy dịch/mapping máy MẶC ĐỊNH OK — không chờ duyệt trước;
-- sai thì user report → admin sửa data/nối nghĩa sau (M14 thu gọn).
-- Script: chuyển concept có mapping source 183 (llm-sense-concept-v1) từ draft → curated,
-- giữ reviewed_by = NULL để phân biệt "máy mặc định duyệt" với "người duyệt".
-- Journal rollback: staging.concept_default_accept_20261015.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='900s';

CREATE TABLE IF NOT EXISTS staging.concept_default_accept_20261015(
  concept_id bigint PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO staging.concept_default_accept_20261015(concept_id)
SELECT DISTINCT concept_id FROM core.sense_concept WHERE source_id = 183
ON CONFLICT DO NOTHING;

UPDATE core.concept c SET status = 'curated'
FROM staging.concept_default_accept_20261015 t
WHERE c.id = t.concept_id AND c.status = 'draft';

\echo '--- concept default-accept (rollback journal):'
SELECT count(*) FROM staging.concept_default_accept_20261015;
\echo '--- status concept sau flip:'
SELECT status, count(*) FROM core.concept GROUP BY 1 ORDER BY 2 DESC;
COMMIT;

\echo '--- refresh serve.sense_pair...'
REFRESH MATERIALIZED VIEW serve.sense_pair;
\echo '--- số cặp sau refresh:'
SELECT count(*) AS pairs FROM serve.sense_pair;

-- ROLLBACK (nếu cần):
--   UPDATE core.concept c SET status='draft'
--   FROM staging.concept_default_accept_20261015 t
--   WHERE c.id=t.concept_id AND c.reviewed_by IS NULL AND c.status='curated';
--   REFRESH MATERIALIZED VIEW serve.sense_pair;
