-- M10.5: versioned EN sense display metadata (muse ranking). Core identities/glosses unchanged.
-- Mirror of 040_japanese_learner_priority.sql for English senses (policies are language-scoped).
-- Source: muse-native bulk run `common-5000-ready-20261007` (results-merged-20261008.jsonl).
CREATE FUNCTION core.english_priority_input_hash(lexeme_id bigint) RETURNS text
LANGUAGE sql STABLE STRICT AS $$
  SELECT md5(jsonb_build_array(l.external_id,l.language_id,l.lemma,l.reading,l.pos,
                              l.attributes,src.code,src.version)::text)
  FROM core.lexeme l JOIN public.source src ON src.id=l.source_id
  JOIN public.language lang ON lang.id=l.language_id
  WHERE l.id=lexeme_id AND lang.code='en'
$$;

COMMENT ON FUNCTION core.english_priority_input_hash(bigint) IS
  'M10.5 en-m10.5-v1: lexeme snapshot hash (identity + source code/version). NULL for non-EN.';

CREATE FUNCTION core.english_sense_input_hash(sense_id bigint) RETURNS text
LANGUAGE sql STABLE STRICT AS $$
  SELECT md5(jsonb_build_array(s.external_id,s.sense_no,s.attributes,s.definition,
                              s.definition_language_id,
                              core.english_priority_input_hash(s.lexeme_id),
                              (SELECT jsonb_agg(jsonb_build_array(g.rank,g.text,g.source_id)
                                                ORDER BY g.rank,g.id)
                               FROM core.sense_gloss g JOIN public.language lg ON lg.id=g.language_id
                               WHERE g.sense_id=s.id AND lg.code='en'))::text)
  FROM core.sense s WHERE s.id=sense_id
$$;

COMMENT ON FUNCTION core.english_sense_input_hash(bigint) IS
  'M10.5 en-m10.5-v1: sense snapshot hash (EN glosses only; derived VI writes stay outside the hash).';

CREATE OR REPLACE VIEW serve.english_sense_priority AS
SELECT p.sense_id,p.lexeme_id,p.display_order,p.reason,p.reviewer_kind,r.id AS run_id
FROM core.sense_learner_priority p
JOIN core.dictionary_priority_run r ON r.id=p.run_id AND r.active
WHERE r.policy='en-m10.5-v1'
  AND p.input_hash=core.english_sense_input_hash(p.sense_id);

COMMENT ON VIEW serve.english_sense_priority IS
  'M10.5 en-m10.5-v1: curator-ranked EN sense order, dropped automatically on source drift.';
