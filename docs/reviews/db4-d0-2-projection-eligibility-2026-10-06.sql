-- DB4-D0.2: read-only exact count from the trusted policy in migration 038.
-- No need to install a function or migrate production to run this audit.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL work_mem='16MB';
SET LOCAL max_parallel_workers_per_gather=0;
SET LOCAL temp_file_limit='768MB';
WITH candidates AS MATERIALIZED (
    SELECT DISTINCT g.sense_id FROM core.sense_gloss g JOIN public.language lg ON lg.id=g.language_id AND lg.code='en'
    JOIN core.sense s ON s.id=g.sense_id JOIN public.source src ON src.id=s.source_id AND src.code='wiktextract' WHERE g.rank>1)
    SELECT lg.code AS language,count(*)::int AS first_last_differ,
    count(*) FILTER(WHERE p.eligible AND (target.definition_language_id IS NULL OR target.definition_language_id=p.en_id) AND (target.definition IS NULL OR target.definition IN (p.first_gloss,p.leaf_gloss)) AND (target.definition IS DISTINCT FROM p.leaf_gloss OR target.definition_language_id IS DISTINCT FROM p.en_id))::int AS eligible,
    count(*) FILTER(WHERE p.eligible AND target.definition=p.leaf_gloss AND target.definition_language_id=p.en_id)::int AS already_projected,
    count(*) FILTER(WHERE NOT p.eligible OR NOT ((target.definition_language_id IS NULL OR target.definition_language_id=p.en_id) AND (target.definition IS NULL OR target.definition IN (p.first_gloss,p.leaf_gloss))))::int AS blocked
    FROM candidates c JOIN core.sense target ON target.id=c.sense_id JOIN core.lexeme l ON l.id=target.lexeme_id JOIN public.language lg ON lg.id=l.language_id
    CROSS JOIN LATERAL (WITH grouped AS (
    SELECT array_agg(g.text ORDER BY g.rank, g.id) AS texts,
           min(lg.id)::smallint AS en_id,
           coalesce(bool_and(coalesce(
             src.code = 'wiktextract'
             AND g.source_id = s.source_id
             AND g.batch_id IS NOT DISTINCT FROM s.batch_id
             AND NOT g.is_machine AND g.reviewed_by IS NULL, false)), false)
             AND min(g.rank) = 1 AND max(g.rank) = count(*) AS eligible
    FROM core.sense s
    JOIN core.sense_gloss g ON g.sense_id = s.id
    JOIN public.language lg ON lg.id = g.language_id AND lg.code = 'en'
    LEFT JOIN public.source src ON src.id = s.source_id
    WHERE s.id = target.id
  )
  SELECT texts[1], texts[cardinality(texts)], texts,
         coalesce(grouped.eligible, false), grouped.en_id
  FROM grouped) p(first_gloss,leaf_gloss,glosses,eligible,en_id)
    WHERE p.first_gloss IS DISTINCT FROM p.leaf_gloss GROUP BY lg.code ORDER BY lg.code;
COMMIT;
