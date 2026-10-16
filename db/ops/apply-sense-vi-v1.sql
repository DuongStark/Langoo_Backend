-- Apply nghĩa VI (sense gloss) toàn diện — job sense-vi-1 (15-16/10).
-- Input: staging.tmp_sense_vi_v1 (sense_id bigint, vi text) từ /tmp/opencode/sense-vi-mapping.tsv.
-- Chính sách 15/10: máy mặc định OK — gloss is_machine=true, rank 1, sửa sau theo report (M14).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('sense-vi-apply-20261016'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='900s';

DO $$
DECLARE bad int; conflict int; n int;
BEGIN
  SELECT count(*) INTO n FROM staging.tmp_sense_vi_v1;
  IF n = 0 THEN RAISE EXCEPTION 'staging rỗng'; END IF;
  SELECT count(*) INTO bad FROM staging.tmp_sense_vi_v1 t
    LEFT JOIN core.sense s ON s.id = t.sense_id
    WHERE s.id IS NULL OR btrim(t.vi) = '';
  IF bad <> 0 THEN RAISE EXCEPTION 'rows invalid: %', bad; END IF;
  SELECT count(*) INTO conflict FROM staging.tmp_sense_vi_v1 t
    JOIN core.sense_gloss g ON g.sense_id = t.sense_id
    JOIN public.language lg ON lg.id = g.language_id AND lg.code = 'vi';
  IF conflict <> 0 THEN RAISE EXCEPTION 'đã có gloss VI: %', conflict; END IF;
  IF EXISTS (SELECT 1 FROM public.source WHERE code = 'llm-sense-vi-v1') THEN
    RAISE EXCEPTION 'nguồn llm-sense-vi-v1 đã tồn tại (đã apply?)';
  END IF;
END $$;

LOCK TABLE public.source IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.source(id,code,name,license,attribution,url,version,sha256,imported_at)
SELECT coalesce(max(id),0)+1,'llm-sense-vi-v1',
  'Gloss VI theo sense jmdict — LLM dịch toàn diện (muse-spark-1.3-contributor qua zen/go)',
  'Nội dung dẫn xuất: JMdict (EDRDG, CC BY-SA 4.0) — gloss VI do LLM sinh (máy dịch, chưa duyệt)',
  'Sinh bởi muse-spark-1.3-contributor (zen/go, effort minimal), batch sense-vi-1 2026-10-15/16; default-accept 15/10, sửa sau theo report',
  null,'1.0',null, now()
FROM public.source;

INSERT INTO core.sense_gloss(sense_id,language_id,text,detail,is_machine,rank,source_id)
SELECT t.sense_id, lang.id, t.vi,
  'sense-vi-1 | model=muse-spark-1.3-contributor | effort=minimal | batch=2026-10-15 | default-accept',
  true, 1, src.id
FROM staging.tmp_sense_vi_v1 t
JOIN public.language lang ON lang.code = 'vi'
JOIN public.source src ON src.code = 'llm-sense-vi-v1';

DO $$
DECLARE n int; expect int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_gloss g
    JOIN public.source src ON src.id = g.source_id AND src.code = 'llm-sense-vi-v1';
  SELECT count(*) INTO expect FROM staging.tmp_sense_vi_v1;
  IF n <> expect THEN RAISE EXCEPTION 'inserted % <> expected %', n, expect; END IF;
END $$;
ANALYZE core.sense_gloss;

\echo '--- tổng gloss đợt này:'
SELECT count(*) FROM core.sense_gloss g
  JOIN public.source src ON src.id = g.source_id AND src.code = 'llm-sense-vi-v1';
\echo '--- tổng gloss VI:'
SELECT count(*) FROM core.sense_gloss g
  JOIN public.language l ON l.id = g.language_id WHERE l.code = 'vi';
\echo '--- jmdict sense có gloss VI / tổng jmdict:'
SELECT count(distinct s.id)
FROM core.sense s
JOIN public.source sr ON sr.id = s.source_id
JOIN core.sense_gloss g ON g.sense_id = s.id
JOIN public.language l ON l.id = g.language_id
WHERE sr.code = 'jmdict' AND l.code = 'vi';
SELECT count(*) FROM core.sense s JOIN public.source sr ON sr.id = s.source_id WHERE sr.code = 'jmdict';
COMMIT;

-- ROLLBACK:
--   DELETE FROM core.sense_gloss WHERE source_id = (SELECT id FROM public.source WHERE code='llm-sense-vi-v1');
--   DELETE FROM public.source WHERE code = 'llm-sense-vi-v1';
