-- DB3-B JA bulk: dịch vi gloss cho 59.636 lexeme JA phổ thông (BCCWJ) thiếu VI.
-- Requires: staging.tmp_ja_gloss_rows loaded from ja-gloss-rows.tsv; hash fill khi chạy.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('db3b-ja-bulk-20261010'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; conflict int; n int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_ja_gloss_rows r
    LEFT JOIN core.sense s ON s.id=r.sense_id
    LEFT JOIN core.lexeme l ON l.id=s.lexeme_id
    LEFT JOIN public.language lg ON lg.id=l.language_id
    WHERE s.id IS NULL OR lg.code<>'ja';
  IF bad<>0 THEN RAISE EXCEPTION 'ja rows invalid: %', bad; END IF;
  SELECT count(*) INTO conflict FROM staging.tmp_ja_gloss_rows r
    JOIN core.sense_gloss g ON g.sense_id=r.sense_id
    JOIN public.language lg ON lg.id=g.language_id AND lg.code='vi';
  IF conflict<>0 THEN RAISE EXCEPTION 'ja vi gloss conflict: %', conflict; END IF;
  SELECT count(*) INTO n FROM staging.tmp_ja_gloss_rows r
    JOIN core.sense_gloss g ON g.sense_id=r.sense_id
    JOIN public.source src ON src.id=g.source_id AND src.code='db3b-ai-4de209e81cf3af484aed69c1b39f67ab89274a655140daf18a7727e43adafc18';
  IF n<>0 THEN RAISE EXCEPTION 'already applied: %', n; END IF;
END $$;

LOCK TABLE public.source IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.source(id,code,name,license,attribution,url,version,sha256,imported_at)
SELECT coalesce(max(id),0)+1,'db3b-ai-4de209e81cf3af484aed69c1b39f67ab89274a655140daf18a7727e43adafc18',
  'DB3-B Vietnamese machine gloss',
  'CC BY-SA 4.0',
  'Machine translation; original sources and licenses are recorded in job 4de209e81cf3af484aed69c1b39f67ab89274a655140daf18a7727e43adafc18; opencode-go/muse-spark-1.3-contributor; bulk JA BCCWJ 2026-10-10',
  'https://opencode.ai/zen/go/v1','gloss-vi-bulk-1',
  '4de209e81cf3af484aed69c1b39f67ab89274a655140daf18a7727e43adafc18', now()
FROM public.source
HAVING NOT EXISTS(SELECT 1 FROM public.source WHERE code='db3b-ai-4de209e81cf3af484aed69c1b39f67ab89274a655140daf18a7727e43adafc18');

INSERT INTO core.sense_gloss(sense_id,language_id,text,detail,is_machine,rank,source_id)
SELECT r.sense_id, lang.id, r.gloss_vi,
  'db3b-ai | model=muse-spark-1.3-contributor | effort=minimal | batch=2026-10-10-ja-bulk | policy=direct-no-recheck',
  true, 1, src.id
FROM staging.tmp_ja_gloss_rows r
JOIN public.language lang ON lang.code='vi'
JOIN public.source src ON src.code='db3b-ai-4de209e81cf3af484aed69c1b39f67ab89274a655140daf18a7727e43adafc18';

DO $$
DECLARE n int; expect int;
BEGIN
  SELECT count(*) INTO n FROM core.sense_gloss g
    JOIN public.source src ON src.id=g.source_id AND src.code='db3b-ai-4de209e81cf3af484aed69c1b39f67ab89274a655140daf18a7727e43adafc18';
  SELECT count(*) INTO expect FROM staging.tmp_ja_gloss_rows;
  IF n<>expect THEN RAISE EXCEPTION 'inserted % <> expected %', n, expect; END IF;
END $$;
ANALYZE core.sense_gloss;

\echo '--- tổng gloss ja bulk:'
SELECT count(*) FROM core.sense_gloss g JOIN public.source src ON src.id=g.source_id AND src.code='db3b-ai-4de209e81cf3af484aed69c1b39f67ab89274a655140daf18a7727e43adafc18';
COMMIT;
