-- DB4-D0.2: Wiktextract EN source projection v1; no data backfill in migration.
-- English-edition extractor appends supergloss before recursive subglosses.
-- Scope: source-owned, contiguous ranks, same batch, unreviewed non-machine EN.
-- JMdict ranked glosses are synonyms/alternatives, not this hierarchy policy.
-- Raw gloss rows remain intact; API adds ordered context to the existing card.
CREATE FUNCTION core.wiktextract_en_projection(target_sense bigint)
RETURNS TABLE(first_gloss text, leaf_gloss text, glosses text[], eligible boolean, en_id smallint)
LANGUAGE sql STABLE PARALLEL SAFE AS $function$
  WITH grouped AS (
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
    WHERE s.id = target_sense
  )
  SELECT texts[1], texts[cardinality(texts)], texts,
         coalesce(grouped.eligible, false), grouped.en_id
  FROM grouped;
$function$;
COMMENT ON FUNCTION core.wiktextract_en_projection(bigint) IS
  'DB4-D0.2 wiktextract-en-leaf-v1: preserve full ordered context; source/batch/rank/review guarded. Not a semantic duplicate classifier.';

CREATE OR REPLACE VIEW serve.sense_card AS
SELECT
  se.id                        AS sense_id,
  se.lexeme_id,
  x.language_id,
  x.lemma,
  x.reading,
  x.romanization,
  x.pos,
  x.frequency_rank,
  x.homograph_no,
  se.sense_no,
  CASE WHEN projection.eligible
        AND (se.definition_language_id IS NULL OR se.definition_language_id = projection.en_id)
        AND (se.definition IS NULL OR se.definition IN (projection.first_gloss, projection.leaf_gloss))
       THEN projection.leaf_gloss ELSE se.definition END AS definition,
  CASE WHEN projection.eligible
        AND (se.definition_language_id IS NULL OR se.definition_language_id = projection.en_id)
        AND (se.definition IS NULL OR se.definition IN (projection.first_gloss, projection.leaf_gloss))
       THEN projection.en_id ELSE se.definition_language_id END AS definition_language_id,
  se.register,
  se.domain,
  se.is_primary,
  vi.text                      AS gloss_vi,
  vi.is_machine                AS gloss_vi_machine,
  (vi.reviewed_by IS NOT NULL) AS gloss_vi_reviewed,
  CASE WHEN projection.eligible THEN projection.leaf_gloss ELSE en.text END AS gloss_en,
  sc.concept_id,
  coalesce(projection.glosses, ARRAY[]::text[]) AS gloss_en_context
FROM core.sense se
JOIN core.lexeme x ON x.id = se.lexeme_id
LEFT JOIN LATERAL core.wiktextract_en_projection(se.id) projection ON true
LEFT JOIN LATERAL (
  SELECT g.text, g.is_machine, g.reviewed_by
  FROM core.sense_gloss g
  JOIN public.language lg ON lg.id = g.language_id
  WHERE g.sense_id = se.id AND lg.code = 'vi'
  ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank, g.id
  LIMIT 1
) vi ON true
LEFT JOIN LATERAL (
  SELECT g.text
  FROM core.sense_gloss g
  JOIN public.language lg ON lg.id = g.language_id
  WHERE g.sense_id = se.id AND lg.code = 'en'
  ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank, g.id
  LIMIT 1
) en ON true
LEFT JOIN LATERAL (
  SELECT sc.concept_id
  FROM core.sense_concept sc
  JOIN core.concept c ON c.id = sc.concept_id
  WHERE sc.sense_id = se.id
  ORDER BY (c.status = 'curated') DESC, sc.confidence DESC, sc.concept_id
  LIMIT 1
) sc ON true;
