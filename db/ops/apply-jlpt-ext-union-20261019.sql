-- JLPT extension: hợp nhất OpenJLPT (CC BY-SA) + Tanos qua jlpt-vocab-api với list Tanos hiện có,
-- quy tắc "cấp dễ nhất thắng"; CHỈ THÊM từ chưa gắn cấp (giữ nguyên 298 conflict).
-- Yêu cầu: staging.jlpt_ext_promote_20261019 (2.941 dòng) + staging.jlpt_ext_union_20261019 (10.430 dòng).
-- Biến: -v sha_union= -v sha_oj= -v sha_wk= -v sha_pr=
-- Rollback: xoá theo batch_id (cuối file).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('jlpt-ext-20261019'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='900s';

DO $$
DECLARE n bigint; bad int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.source WHERE code = 'jlpt-open-union-2026-10') THEN
    RAISE EXCEPTION 'source jlpt-open-union-2026-10 đã tồn tại (đã apply?)';
  END IF;
  SELECT count(*) INTO n FROM staging.jlpt_ext_promote_20261019;
  IF n <> 2941 THEN RAISE EXCEPTION 'promote rows=% (mong đợi 2941)', n; END IF;
  SELECT count(*) INTO bad
  FROM staging.jlpt_ext_promote_20261019 p
  LEFT JOIN core.lexeme l ON l.id = p.lexeme_id
  LEFT JOIN core.lexeme_level ll ON ll.lexeme_id = p.lexeme_id AND ll.scheme = 'JLPT'
  WHERE l.id IS NULL OR ll.lexeme_id IS NOT NULL
     OR p.level NOT BETWEEN 1 AND 5
     OR p.match_method NOT IN ('form_reading', 'lemma_reading');
  IF bad <> 0 THEN RAISE EXCEPTION 'promote rows invalid=%', bad; END IF;
END $$;

INSERT INTO public.source(id, code, name, license, attribution, url, version, sha256, imported_at)
SELECT COALESCE(MAX(id), 0) + 1,
       'jlpt-open-union-2026-10',
       'JLPT open lists union (OpenJLPT + Tanos via jlpt-vocab-api)',
       'CC BY-SA 4.0 (OpenJLPT); Tanos lists via jlpt-vocab-api (tanos.co.uk)',
       'OpenJLPT: github.com/evanclan/OpenJLPT (CC BY-SA 4.0). jlpt-vocab-api: github.com/wkei — dữ liệu tải từ tanos.co.uk. Hợp nhất với list Tanos hiện có (source 12), quy tắc cấp-dễ-nhất-thắng.',
       'https://github.com/evanclan/OpenJLPT',
       '2026-10-19',
       :'sha_union',
       now()
FROM public.source;

INSERT INTO staging.import_batch(source_code, file_name, sha256, row_count, status, finished_at) VALUES
  ('jlpt-open-union-2026-10', 'jlpt-ext-20261019/openjlpt.tsv',  :'sha_oj', 7811, 'completed', now()),
  ('jlpt-open-union-2026-10', 'jlpt-ext-20261019/tanos-api.tsv', :'sha_wk', 8385, 'completed', now()),
  ('jlpt-open-union-2026-10', 'jlpt-ext-20261019/promote.tsv',   :'sha_pr', 2941, 'completed', now());

INSERT INTO core.lexeme_level(lexeme_id, scheme, level, match_method, source_id, batch_id)
SELECT p.lexeme_id, 'JLPT', p.level, p.match_method,
       (SELECT id FROM public.source WHERE code = 'jlpt-open-union-2026-10'),
       (SELECT id FROM staging.import_batch
         WHERE file_name = 'jlpt-ext-20261019/promote.tsv'
           AND source_code = 'jlpt-open-union-2026-10'
         ORDER BY started_at DESC LIMIT 1)
FROM staging.jlpt_ext_promote_20261019 p
ON CONFLICT (lexeme_id, scheme) DO NOTHING;

INSERT INTO core.mapping_run(run_key, task, algorithm, model, prompt_version, source_snapshot, parameters, status, finished_at)
VALUES ('jlpt-ext-union-20261019', 'lexeme_level_extend', 'union-easiest-wins',
        'community-lists (openjlpt + tanos-api)', 'v1',
        jsonb_build_object('sources', jsonb_build_array('openjlpt', 'tanos-api', 'tanos-list'),
                           'union_words', 10430, 'promote_tags', 2941,
                           'conflicts_kept', 298, 'ambiguous', 894, 'unmatched', 465,
                           'artifacts', '/opt/langoo/storage/jlpt-ext-20261019/'),
        jsonb_build_object('rule', 'cấp dễ nhất thắng; chỉ thêm từ chưa gắn; giữ nguyên conflict',
                           'gate', 'chủ dự án duyệt 2026-10-19'),
        'completed', now());

\echo '--- verify:'
SELECT 'source: ' || id || ' ' || code FROM public.source WHERE code = 'jlpt-open-union-2026-10';
SELECT 'lexeme_level tổng: ' || count(*) FROM core.lexeme_level WHERE scheme = 'JLPT';
SELECT level, count(*) AS n FROM core.lexeme_level WHERE scheme = 'JLPT' GROUP BY level ORDER BY level;
SELECT 'mapping_run: ' || run_key FROM core.mapping_run WHERE run_key = 'jlpt-ext-union-20261019';
COMMIT;

-- ROLLBACK (nếu cần):
--   DELETE FROM core.lexeme_level
--    WHERE batch_id = (SELECT id FROM staging.import_batch
--                       WHERE file_name='jlpt-ext-20261019/promote.tsv'
--                         AND source_code='jlpt-open-union-2026-10');
--   DELETE FROM core.mapping_run WHERE run_key='jlpt-ext-union-20261019';
--   (giữ public.source + import_batch + staging để audit; xoá thêm nếu muốn sạch hoàn toàn)
