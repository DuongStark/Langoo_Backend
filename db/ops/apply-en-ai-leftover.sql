-- Gắn ví dụ leftover EN: usage wiktextract (src='wikt') + AI muse (src='ai').
-- Requires: staging.tmp_en_ai (sense_id, text, vi, src).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('en-ai-examples-20261011'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; dup int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_en_ai t
    LEFT JOIN core.sense s ON s.id=t.sense_id
    WHERE s.id IS NULL OR btrim(t.text)='' OR t.src NOT IN ('wikt','ai');
  IF bad<>0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO dup FROM core.example e
    WHERE e.external_id LIKE 'llm-en:%' OR e.external_id LIKE 'wikt-usage:%';
  IF dup<>0 THEN RAISE EXCEPTION 'already applied: %', dup; END IF;
END $$;

-- source mới cho ví dụ AI EN (nếu có)
INSERT INTO public.source(id, code, name, license, attribution, version)
SELECT 180, 'llm-en-examples', 'Ví dụ câu tiếng Anh do LLM sinh (muse + verify)',
       'nội bộ', 'Sinh bởi mô hình, chưa kiểm duyệt', 'v1'
WHERE EXISTS (SELECT 1 FROM staging.tmp_en_ai WHERE src='ai');

-- import batch cho phần AI
INSERT INTO staging.import_batch(source_code, file_name, sha256, row_count, status, finished_at)
SELECT 'llm-en-examples', 'en-ai-leftover-2026-10-11', :'sha256', count(*), 'completed', now()
FROM staging.tmp_en_ai WHERE src='ai';

-- 1) usage wiktextract (source 8)
INSERT INTO core.example(sense_id, language_id, text, translation, external_id, source_id)
SELECT t.sense_id, 1, t.text,
       jsonb_build_object('sentences',
         CASE WHEN btrim(coalesce(t.vi,'')) <> ''
              THEN jsonb_build_array(jsonb_build_object('lang','vie','text',t.vi,'machine',true))
              ELSE '[]'::jsonb END),
       'wikt-usage:' || t.sense_id, 8
FROM staging.tmp_en_ai t
WHERE t.src='wikt'
  AND NOT EXISTS (SELECT 1 FROM core.example e WHERE e.sense_id = t.sense_id)
  AND NOT EXISTS (SELECT 1 FROM core.example_sense es WHERE es.sense_id = t.sense_id AND es.relation='illustrates');

-- 2) AI muse (source 180)
INSERT INTO core.example(sense_id, language_id, text, translation, external_id, source_id, batch_id)
SELECT t.sense_id, 1, t.text,
       jsonb_build_object('sentences',
         CASE WHEN btrim(coalesce(t.vi,'')) <> ''
              THEN jsonb_build_array(jsonb_build_object('lang','vie','text',t.vi,'machine',true))
              ELSE '[]'::jsonb END,
         'machine_generated', true),
       'llm-en:' || t.sense_id, 180,
       (SELECT id FROM staging.import_batch WHERE source_code='llm-en-examples' ORDER BY started_at DESC LIMIT 1)
FROM staging.tmp_en_ai t
WHERE t.src='ai'
  AND NOT EXISTS (SELECT 1 FROM core.example e WHERE e.sense_id = t.sense_id)
  AND NOT EXISTS (SELECT 1 FROM core.example_sense es WHERE es.sense_id = t.sense_id AND es.relation='illustrates');

\echo '--- ví dụ wikt leftover:'
SELECT count(*) FROM core.example WHERE external_id LIKE 'wikt-usage:%';
\echo '--- ví dụ AI EN:'
SELECT count(*) FROM core.example WHERE external_id LIKE 'llm-en:%';
COMMIT;
