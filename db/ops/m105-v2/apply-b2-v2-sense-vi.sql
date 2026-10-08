-- B2-v2: apply thêm gloss VI theo sense (muse alignment v2, từ rank 5k-20k).
-- Requires: staging.tmp_b2_v2_rows loaded from b2-v2-rows.tsv.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('b2-vi-apply-v2'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; conflict int; n int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_b2_v2_rows r
    LEFT JOIN core.sense s ON s.id=r.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id
    LEFT JOIN public.language lg ON lg.id=l.language_id
    WHERE s.id IS NULL OR lg.code<>'en';
  IF bad<>0 THEN RAISE EXCEPTION 'b2v2 rows invalid: %', bad; END IF;
  SELECT count(*) INTO conflict FROM staging.tmp_b2_v2_rows r
    JOIN core.sense_gloss g ON g.sense_id=r.sense_id
    JOIN public.language lg ON lg.id=g.language_id AND lg.code='vi';
  IF conflict<>0 THEN RAISE EXCEPTION 'b2v2 vi gloss conflict: %', conflict; END IF;
  SELECT count(*) INTO n FROM staging.tmp_b2_v2_rows r
    JOIN core.sense_gloss g ON g.sense_id=r.sense_id
    JOIN public.source src ON src.id=g.source_id AND src.code='b2-align-muse-vi-2';
  IF n<>0 THEN RAISE EXCEPTION 'b2v2 already applied: %', n; END IF;
END $$;

LOCK TABLE public.source IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.source(id,code,name,license,attribution,url,version,sha256,imported_at)
SELECT coalesce(max(id),0)+1,'b2-align-muse-vi-2',
  'B2 alignment mở rộng — gloss VI theo sense (muse-spark-1.3-contributor)',
  'Nội dung: vi.wiktionary (CC BY-SA 4.0 / GFDL); căn ghép & chọn nghĩa bởi pipeline B2 (máy)',
  'vi.wiktionary kaikki.org dump + muse-spark-1.3-contributor (zen/go, effort minimal), B2 v2 2026-10-08',
  'https://kaikki.org/dictionary/Vietnamese/','2.0',
  '6164f9d9a87231053b2ae9f4729ee46743bab9b4cd2ddfe5c854aa8a071afdf1', now()
FROM public.source
HAVING NOT EXISTS(SELECT 1 FROM public.source WHERE code='b2-align-muse-vi-2');

INSERT INTO core.sense_gloss(sense_id,language_id,text,detail,is_machine,rank,source_id)
SELECT r.sense_id, lang.id, r.gloss_vi,
  'b2-align-v1 (v2) | model=muse-spark-1.3-contributor | effort=minimal | verified=true | batch=2026-10-08-v2',
  true, 1, src.id
FROM staging.tmp_b2_v2_rows r
JOIN public.language lang ON lang.code='vi'
JOIN public.source src ON src.code='b2-align-muse-vi-2';

DO $$
DECLARE n int; expect int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_gloss g
    JOIN public.source src ON src.id=g.source_id AND src.code='b2-align-muse-vi-2';
  SELECT count(*) INTO expect FROM staging.tmp_b2_v2_rows;
  IF n<>expect THEN RAISE EXCEPTION 'inserted % <> expected %', n, expect; END IF;
END $$;
ANALYZE core.sense_gloss;

\echo '--- tổng gloss v2:'
SELECT count(*) FROM core.sense_gloss g JOIN public.source src ON src.id=g.source_id AND src.code='b2-align-muse-vi-2';
COMMIT;
