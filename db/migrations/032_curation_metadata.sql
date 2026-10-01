-- 032_curation_metadata.sql — DB1: metadata curation + provenance quyết định mapping.
--
-- 1) core.concept: ai duyệt concept, khi nào (reviewed_by/reviewed_at).
--    `reviewed_by` là tham chiếu LOGIC tới app.users.id (KHÔNG FK) theo bất biến
--    "core không tham chiếu app" — giống core.sense_gloss.reviewed_by.
-- 2) core.sense_concept_candidate.decision_run_id: run đưa ra quyết định cuối
--    (promote/reject) để rollback theo lô (kế hoạch mapping G-2). Khác `run_id`
--    (run SINH candidate).

ALTER TABLE core.concept
  ADD COLUMN reviewed_by bigint,
  ADD COLUMN reviewed_at timestamptz,
  ADD CONSTRAINT concept_review_pair
    CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));

ALTER TABLE core.sense_concept_candidate
  ADD COLUMN decision_run_id bigint REFERENCES core.mapping_run(id);
CREATE INDEX sense_concept_candidate_decision_run
  ON core.sense_concept_candidate (decision_run_id)
  WHERE decision_run_id IS NOT NULL;

COMMENT ON COLUMN core.concept.reviewed_by IS
  'ID curator (tham chiếu logic app.users.id, không FK do bất biến core→app).';
COMMENT ON COLUMN core.concept.reviewed_at IS
  'Thời điểm duyệt concept; luôn đi cặp với reviewed_by.';
COMMENT ON COLUMN core.sense_concept_candidate.decision_run_id IS
  'mapping_run đưa ra quyết định cuối (promote/reject) — dùng rollback theo lô.';
COMMENT ON COLUMN core.sense_concept.verified IS
  'true = liên kết nguồn chuẩn (WordNet/OMW) hoặc do người duyệt; false = máy/LLM chưa audit.';
COMMENT ON COLUMN core.concept.status IS
  'draft → review → curated/rejected; chỉ curated + confidence ≥ 0.7 vào serve.sense_pair.';
