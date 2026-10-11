-- B2-recover: gloss VI bổ sung cho các từ curated bị thiếu (def lấy đúng từ sense_card).
-- Requires: staging.tmp_recover_rows loaded from recover-accepted.tsv (p1+p2, dedupe sense_id).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('b2-vi-recover-1'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; conflict int; n int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_recover_rows r
    LEFT JOIN core.sense s ON s.id=r.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id
    LEFT JOIN public.language lg ON lg.id=l.language_id
    WHERE s.id IS NULL OR lg.code<>'en';
  IF bad<>0 THEN RAISE EXCEPTION 'recover rows invalid: %', bad; END IF;
  SELECT count(*) INTO conflict FROM staging.tmp_recover_rows r
    JOIN core.sense_gloss g ON g.sense_id=r.sense_id
    JOIN public.language lg ON lg.id=g.language_id AND lg.code='vi';
  IF conflict<>0 THEN RAISE EXCEPTION 'recover vi gloss conflict: %', conflict; END IF;
  SELECT count(*) INTO n FROM staging.tmp_recover_rows r
    JOIN core.sense_gloss g ON g.sense_id=r.sense_id
    JOIN public.source src ON src.id=g.source_id AND src.code='b2-align-muse-vi-recover-1';
  IF n<>0 THEN RAISE EXCEPTION 'recover already applied: %', n; END IF;
END $$;

LOCK TABLE public.source IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.source(id,code,name,license,attribution,url,version,sha256,imported_at)
SELECT coalesce(max(id),0)+1,'b2-align-muse-vi-recover-1',
  'B2 recovery — gloss VI cho từ curated thiếu nghĩa (muse-spark-1.3-contributor)',
  'Nội dung: vi.wiktionary (CC BY-SA 4.0 / GFDL); căn ghép & chọn nghĩa bởi pipeline B2 (máy)',
  'vi.wiktionary kaikki.org dump + muse-spark-1.3-contributor (zen/go, effort minimal), recovery 2026-10-10',
  'https://kaikki.org/dictionary/Vietnamese/','1.0',
  'e3bf4c824b9e2628495010bcaad90371d97241b1cfc3f69b7ad8a402d5055f50', now()
FROM public.source
HAVING NOT EXISTS(SELECT 1 FROM public.source WHERE code='b2-align-muse-vi-recover-1');

INSERT INTO core.sense_gloss(sense_id,language_id,text,detail,is_machine,rank,source_id)
SELECT r.sense_id, lang.id, r.gloss_vi,
  'b2-align-v1 (recover) | model=muse-spark-1.3-contributor | effort=minimal | verified=true | batch=2026-10-10-recover',
  true, 1, src.id
FROM staging.tmp_recover_rows r
JOIN public.language lang ON lang.code='vi'
JOIN public.source src ON src.code='b2-align-muse-vi-recover-1';

DO $$
DECLARE n int; expect int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_gloss g
    JOIN public.source src ON src.id=g.source_id AND src.code='b2-align-muse-vi-recover-1';
  SELECT count(*) INTO expect FROM staging.tmp_recover_rows;
  IF n<>expect THEN RAISE EXCEPTION 'inserted % <> expected %', n, expect; END IF;
END $$;
ANALYZE core.sense_gloss;

\echo '--- tổng gloss recover:'
SELECT count(*) FROM core.sense_gloss g JOIN public.source src ON src.id=g.source_id AND src.code='b2-align-muse-vi-recover-1';
COMMIT;
