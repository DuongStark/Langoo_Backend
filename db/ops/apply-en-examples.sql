-- Gắn ví dụ Tatoeba EN vào sense EN (token-match + biến thể) + bản dịch VI.
-- Requires: staging.tmp_en_links (example_id, sense_id, pattern),
--           staging.tmp_en_tr (example_id, tr jsonb).
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('en-examples-20261011'));
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='600s';

DO $$
DECLARE bad int; dup int;
BEGIN
  SELECT count(*) INTO bad FROM staging.tmp_en_links l
    LEFT JOIN core.example e ON e.id=l.example_id
    LEFT JOIN core.sense s ON s.id=l.sense_id
    WHERE e.id IS NULL OR s.id IS NULL OR e.language_id <> 1;
  IF bad<>0 THEN RAISE EXCEPTION 'links invalid: %', bad; END IF;
  SELECT count(*) INTO dup FROM core.example_sense es
    WHERE es.method='tatoeba_en_token_v1';
  IF dup<>0 THEN RAISE EXCEPTION 'already applied: %', dup; END IF;
  SELECT count(*) INTO bad FROM staging.tmp_en_tr t
    LEFT JOIN core.example e ON e.id=t.example_id
    WHERE e.id IS NULL OR jsonb_typeof(t.tr) <> 'object';
  IF bad<>0 THEN RAISE EXCEPTION 'tr invalid: %', bad; END IF;
END $$;

-- 1) mapping run
INSERT INTO core.mapping_run(run_key, task, algorithm, source_snapshot, parameters, status, finished_at)
VALUES ('tatoeba-en-token-20261011','example_sense_attach','tatoeba_en_token_v1',
        jsonb_build_object('source','tatoeba-en','corpus_sentences',2036986,'target_words',10783),
        jsonb_build_object('match','token+forms','translator','human(tatoeba)+muse'),
        'completed', now())
RETURNING id;

-- 2) links
INSERT INTO core.example_sense(example_id, sense_id, relation, confidence, method, verified, mapping_run_id, evidence)
SELECT l.example_id, l.sense_id, 'illustrates', NULL, 'tatoeba_en_token_v1', false,
       (SELECT id FROM core.mapping_run WHERE run_key='tatoeba-en-token-20261011'),
       jsonb_build_object('pattern', l.pattern, 'kind', 'token', 'source', 'tatoeba-en')
FROM staging.tmp_en_links l
ON CONFLICT (example_id, sense_id) DO NOTHING;

-- 3) bản dịch VI (append; bỏ lang đã có)
UPDATE core.example e
SET translation = jsonb_set(
      e.translation, '{sentences}',
      coalesce(e.translation->'sentences', '[]'::jsonb) ||
      coalesce((
        SELECT jsonb_agg(x)
        FROM jsonb_array_elements(t.tr->'sentences') x
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(e.translation->'sentences','[]'::jsonb)) y
          WHERE y->>'lang' = x->>'lang')
      ), '[]'::jsonb))
FROM staging.tmp_en_tr t
WHERE t.example_id = e.id;

\echo '--- links tatoeba_en_token_v1:'
SELECT count(*) FROM core.example_sense WHERE method='tatoeba_en_token_v1';
\echo '--- câu EN có bản dịch VI (jsonb):'
SELECT count(*) FROM core.example e WHERE e.language_id=1
  AND e.translation @> '{"sentences":[{"lang":"vie"}]}'
  AND e.id IN (SELECT example_id FROM staging.tmp_en_links);
COMMIT;
