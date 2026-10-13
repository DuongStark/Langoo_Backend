-- Apply bản dịch VI (muse.ai native) cho ví dụ JA đang thiếu vie.
-- Input: staging.tmp_ja_ex_vi (example_id bigint, vi text) — nạp từ mapping.tsv
-- của job /opt/langoo/storage/muse-native/ja-ex-vi-2026-10-13.
--
-- NẠP STAGING (đã chạy thật 13/10):
--   sudo cp /opt/langoo/storage/muse-native/ja-ex-vi-2026-10-13/mapping.tsv \
--            /tmp/ja-ex-mapping.tsv && sudo chmod 644 /tmp/ja-ex-mapping.tsv
--   sudo -u postgres psql langoo <<'SQL'
--     DROP TABLE IF EXISTS staging.tmp_ja_ex_vi;
--     CREATE TABLE staging.tmp_ja_ex_vi(example_id bigint NOT NULL, vi text NOT NULL);
--     \copy staging.tmp_ja_ex_vi FROM '/tmp/ja-ex-mapping.tsv' (FORMAT text)
--   SQL
--   (mapping.tsv nằm trong dir 700 của langoo nên postgres không đọc trực tiếp.)
--
-- Kết quả đã apply: 200.031/200.061 row (30 câu lỗi 1 batch, xem failed.jsonl);
-- tổng example JA có vie: 51.864 → 251.895.
-- Rollback ở cuối file (chỉ xoá vie có machine=true của đúng các row trong staging).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('ja-ex-vi-apply-20261013'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

\echo '--- trước: số row sắp apply đang CÓ vie (phải = 0):'
SELECT count(*) AS da_co_vie
FROM staging.tmp_ja_ex_vi t
JOIN core.example e ON e.id = t.example_id
WHERE e.translation @> '{"sentences":[{"lang":"vie"}]}';

DO $$
DECLARE bad int; dup int;
BEGIN
  SELECT count(*) INTO bad
  FROM staging.tmp_ja_ex_vi t
  LEFT JOIN core.example e ON e.id = t.example_id
  WHERE e.id IS NULL OR btrim(t.vi) = '';
  IF bad <> 0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO dup
  FROM staging.tmp_ja_ex_vi t
  JOIN core.example e ON e.id = t.example_id
  WHERE e.translation @> '{"sentences":[{"lang":"vie"}]}';
  IF dup <> 0 THEN RAISE EXCEPTION 'already has vie: %', dup; END IF;
END $$;

-- Ví dụ JMdict có sẵn sentences (jpn/eng) → append vie; row khác → tạo sentences.
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
FROM staging.tmp_ja_ex_vi t
WHERE e.id = t.example_id
  AND NOT (e.translation @> '{"sentences":[{"lang":"vie"}]}');

\echo '--- sau: row trong staging đã có vie (phải = tổng staging):'
SELECT count(*) AS da_apply
FROM staging.tmp_ja_ex_vi t
JOIN core.example e ON e.id = t.example_id
WHERE e.translation @> '{"sentences":[{"lang":"vie"}]}';

\echo '--- tổng example JA có vie (mọi nguồn):'
SELECT count(*) AS tong_vi
FROM core.example e
JOIN public.language lg ON lg.id = e.language_id AND lg.code = 'ja'
WHERE e.translation @> '{"sentences":[{"lang":"vie"}]}';
COMMIT;

-- ROLLBACK (chỉ gỡ phần vie machine vừa thêm theo đúng staging):
--   BEGIN;
--   UPDATE core.example e
--   SET translation = jsonb_set(
--     e.translation, '{sentences}',
--     coalesce((
--       SELECT jsonb_agg(s)
--       FROM jsonb_array_elements(e.translation -> 'sentences') s
--       WHERE NOT (s ->> 'lang' = 'vie' AND (s ->> 'machine') = 'true')
--     ), '[]'::jsonb))
--   FROM staging.tmp_ja_ex_vi t
--   WHERE e.id = t.example_id;
--   COMMIT;
--   DELETE FROM staging.tmp_ja_ex_vi;  -- khi không cần rollback nữa
