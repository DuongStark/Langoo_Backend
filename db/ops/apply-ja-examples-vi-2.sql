-- Apply bản dịch VI đợt 2 (job ja-ex-vi-2, 15/10) cho ví dụ JA còn thiếu vie.
-- Input: staging.tmp_ja_ex_vi2 (example_id bigint, vi text) — nạp từ /tmp/opencode/ja-ex-vi2-mapping.tsv.
-- Rollback ở cuối file (chỉ xoá vie có machine=true của đúng các row trong staging).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('ja-ex-vi-apply-20261015'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

\echo '--- trước: số row sắp apply đang CÓ vie (phải = 0):'
SELECT count(*) AS da_co_vie
FROM staging.tmp_ja_ex_vi2 t
JOIN core.example e ON e.id = t.example_id
WHERE e.translation @> '{"sentences":[{"lang":"vie"}]}';

DO $$
DECLARE bad int; dup int;
BEGIN
  SELECT count(*) INTO bad
  FROM staging.tmp_ja_ex_vi2 t
  LEFT JOIN core.example e ON e.id = t.example_id
  WHERE e.id IS NULL OR btrim(t.vi) = '';
  IF bad <> 0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO dup
  FROM staging.tmp_ja_ex_vi2 t
  JOIN core.example e ON e.id = t.example_id
  WHERE e.translation @> '{"sentences":[{"lang":"vie"}]}';
  IF dup <> 0 THEN RAISE EXCEPTION 'already has vie: %', dup; END IF;
END $$;

-- Ví dụ có sẵn sentences (jpn/eng) → append vie; row khác → tạo sentences.
UPDATE core.example e
SET translation = CASE
    WHEN e.translation ? 'sentences' THEN
      jsonb_set(
        e.translation,
        '{sentences}',
        (e.translation -> 'sentences') || jsonb_build_array(
          jsonb_build_object('lang', 'vie', 'text', t.vi, 'machine', true)
        ),
        true
      )
    ELSE
      jsonb_build_object(
        'sentences',
        jsonb_build_array(
          jsonb_build_object('lang', 'vie', 'text', t.vi, 'machine', true)
        )
      )
  END
FROM staging.tmp_ja_ex_vi2 t
WHERE e.id = t.example_id
  AND NOT (e.translation @> '{"sentences":[{"lang":"vie"}]}');

\echo '--- sau: row trong staging đã có vie (phải = tổng staging):'
SELECT count(*) AS da_apply
FROM staging.tmp_ja_ex_vi2 t
JOIN core.example e ON e.id = t.example_id
WHERE e.translation @> '{"sentences":[{"lang":"vie"}]}';

\echo '--- tổng ví dụ JA có vie (mọi nguồn):'
SELECT count(*) AS tong_vi
FROM core.example e
JOIN public.language lg ON lg.id = e.language_id AND lg.code = 'ja'
WHERE e.translation @> '{"sentences":[{"lang":"vie"}]}';

\echo '--- tổng ví dụ JA (đối chiếu):'
SELECT count(*) AS tong_ja
FROM core.example e
JOIN public.language lg ON lg.id = e.language_id AND lg.code = 'ja';
COMMIT;

-- ROLLBACK (nếu cần):
--   UPDATE core.example e
--   SET translation = jsonb_set(e.translation, '{sentences}', (
--         SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM jsonb_array_elements(e.translation->'sentences') s
--         WHERE NOT (s->>'lang' = 'vie' AND (s->>'machine')::boolean IS TRUE)
--       ), true)
--   FROM staging.tmp_ja_ex_vi2 t
--   WHERE e.id = t.example_id
--     AND e.translation -> 'sentences' @> '[{"lang":"vie","machine":true}]';
