-- Gắn câu ví dụ AI (muse sinh + verify) vào sense JA chưa có ví dụ nào.
-- Requires: staging.tmp_ai_examples (sense_id, ja, vi). Chạy sau khi full xong.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('ai-examples-20261011'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; dup int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_ai_examples t
    LEFT JOIN core.sense s ON s.id=t.sense_id
    WHERE s.id IS NULL OR btrim(t.ja)='';
  IF bad<>0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO dup FROM core.example e
    WHERE e.external_id LIKE 'llm-ja:%';
  IF dup<>0 THEN RAISE EXCEPTION 'already applied: %', dup; END IF;
END $$;

-- 1) source mới cho ví dụ AI (theo convention llm-vi)
INSERT INTO public.source(id, code, name, license, attribution, version)
VALUES (179, 'llm-ja-examples', 'Ví dụ câu tiếng Nhật do LLM sinh (muse + verify)',
        'nội bộ', 'Sinh bởi mô hình, chưa kiểm duyệt', 'v1');

-- 2) import batch (provenance)
INSERT INTO staging.import_batch(source_code, file_name, sha256, row_count, status, finished_at)
SELECT 'llm-ja-examples', 'ai-examples-full-2026-10-11',
       :'sha256', count(*), 'completed', now()
FROM staging.tmp_ai_examples;

-- 3) ví dụ mới (chỉ sense CHƯA có ví dụ nào — direct hoặc link)
INSERT INTO core.example(sense_id, language_id, text, translation, external_id, source_id, batch_id)
SELECT t.sense_id, 2, t.ja,
       jsonb_build_object(
         'sentences',
         CASE WHEN btrim(coalesce(t.vi,'')) <> ''
              THEN jsonb_build_array(jsonb_build_object('lang','vie','text',t.vi,'machine',true))
              ELSE '[]'::jsonb END,
         'machine_generated', true),
       'llm-ja:' || t.sense_id,
       179,
       (SELECT id FROM staging.import_batch WHERE source_code='llm-ja-examples' ORDER BY started_at DESC LIMIT 1)
FROM staging.tmp_ai_examples t
WHERE btrim(t.ja) <> ''
  AND NOT EXISTS (SELECT 1 FROM core.example e WHERE e.sense_id = t.sense_id)
  AND NOT EXISTS (SELECT 1 FROM core.example_sense es WHERE es.sense_id = t.sense_id AND es.relation='illustrates');

\echo '--- ví dụ AI đã gắn:'
SELECT count(*) FROM core.example WHERE external_id LIKE 'llm-ja:%';
\echo '--- trong đó có bản dịch VI:'
SELECT count(*) FROM core.example WHERE external_id LIKE 'llm-ja:%' AND translation @> '{"sentences":[{"lang":"vie"}]}';
COMMIT;
