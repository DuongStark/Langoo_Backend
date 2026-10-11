-- B2-v3: apply thêm gloss VI theo sense (muse alignment v3, rank 20k-50k).
-- Requires: staging.tmp_b2_v3_rows loaded from b2-v3-rows.tsv.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('b2-vi-apply-v3'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; conflict int; n int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_b2_v3_rows r
    LEFT JOIN core.sense s ON s.id=r.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id
    LEFT JOIN public.language lg ON lg.id=l.language_id
    WHERE s.id IS NULL OR lg.code<>'en';
  IF bad<>0 THEN RAISE EXCEPTION 'b2v3 rows invalid: %', bad; END IF;
  SELECT count(*) INTO conflict FROM staging.tmp_b2_v3_rows r
    JOIN core.sense_gloss g ON g.sense_id=r.sense_id
    JOIN public.language lg ON lg.id=g.language_id AND lg.code='vi';
  IF conflict<>0 THEN RAISE EXCEPTION 'b2v3 vi gloss conflict: %', conflict; END IF;
  SELECT count(*) INTO n FROM staging.tmp_b2_v3_rows r
    JOIN core.sense_gloss g ON g.sense_id=r.sense_id
    JOIN public.source src ON src.id=g.source_id AND src.code='b2-align-muse-vi-3';
  IF n<>0 THEN RAISE EXCEPTION 'b2v3 already applied: %', n; END IF;
END $$;

LOCK TABLE public.source IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.source(id,code,name,license,attribution,url,version,sha256,imported_at)
SELECT coalesce(max(id),0)+1,'b2-align-muse-vi-3',
  'B2 alignment v3 — gloss VI theo sense (muse-spark-1.3-contributor, rank 20k-50k)',
  'Nội dung: vi.wiktionary (CC BY-SA 4.0 / GFDL); căn ghép & chọn nghĩa bởi pipeline B2 (máy)',
  'vi.wiktionary kaikki.org dump 2026-10-03 + muse-spark-1.3-contributor (zen/go, effort minimal), B2 v3 2026-10-10',
  'https://kaikki.org/viwiktionary/Ti%E1%BA%BFng%20Anh/','3.0',
  'a2f49fc89fa52e917aedb915ccc7aabcdab7e6255b5d939fdb07a23ec33b1340', now()
FROM public.source
HAVING NOT EXISTS(SELECT 1 FROM public.source WHERE code='b2-align-muse-vi-3');

INSERT INTO core.sense_gloss(sense_id,language_id,text,detail,is_machine,rank,source_id)
SELECT r.sense_id, lang.id, r.gloss_vi,
  'b2-align-v1 (v3) | model=muse-spark-1.3-contributor | effort=minimal | verified=true | batch=2026-10-10-v3',
  true, 1, src.id
FROM staging.tmp_b2_v3_rows r
JOIN public.language lang ON lang.code='vi'
JOIN public.source src ON src.code='b2-align-muse-vi-3';

DO $$
DECLARE n int; expect int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_gloss g
    JOIN public.source src ON src.id=g.source_id AND src.code='b2-align-muse-vi-3';
  SELECT count(*) INTO expect FROM staging.tmp_b2_v3_rows;
  IF n<>expect THEN RAISE EXCEPTION 'inserted % <> expected %', n, expect; END IF;
END $$;
ANALYZE core.sense_gloss;

\echo '--- tổng gloss v3:'
SELECT count(*) FROM core.sense_gloss g JOIN public.source src ON src.id=g.source_id AND src.code='b2-align-muse-vi-3';
COMMIT;
