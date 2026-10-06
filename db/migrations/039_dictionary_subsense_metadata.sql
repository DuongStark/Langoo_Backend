-- M4.3: presentation grouping is allowed only for source-owned Wiktextract hierarchy.
-- Reuse migration 038 policy; preserve every original view column and core ID.
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
  coalesce(projection.glosses, ARRAY[]::text[]) AS gloss_en_context,
  (projection.eligible
    AND (se.definition_language_id IS NULL OR se.definition_language_id = projection.en_id)
    AND (se.definition IS NULL OR se.definition IN (projection.first_gloss, projection.leaf_gloss))
    AND cardinality(projection.glosses) > 1) AS gloss_en_is_hierarchy
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
