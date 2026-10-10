\set ON_ERROR_STOP on
COPY (
 WITH prio AS (
   SELECT p.lexeme_id FROM core.lexeme_learner_priority p
   JOIN core.dictionary_priority_run r ON r.id=p.run_id AND r.active AND r.policy='ja-bccwj-v1'
 ),
 miss AS (
   SELECT prio.lexeme_id FROM prio WHERE NOT EXISTS (
     SELECT 1 FROM core.sense s0 JOIN core.sense_gloss g0 ON g0.sense_id=s0.id
     JOIN public.language lg0 ON lg0.id=g0.language_id AND lg0.code='vi'
     WHERE s0.lexeme_id=prio.lexeme_id AND NULLIF(btrim(g0.text),'') IS NOT NULL)
 )
 SELECT s.id AS sense_id, l.lemma, coalesce(l.reading,'') AS reading, coalesce(l.pos,'') AS pos,
        s.sense_no,
        coalesce(string_agg(g.text, ' | ' ORDER BY g.rank, g.id), '') AS en_gloss,
        coalesce(s.attributes->'misc','[]'::jsonb)::text AS misc,
        coalesce(s.register,'') AS register, coalesce(s.domain,'') AS domain
 FROM miss m
 JOIN core.lexeme l ON l.id=m.lexeme_id
 JOIN core.sense s ON s.lexeme_id=l.id
 LEFT JOIN core.sense_gloss g ON g.sense_id=s.id AND g.language_id=1
 GROUP BY s.id, l.lemma, l.reading, l.pos, s.sense_no, s.attributes, s.register, s.domain
 ORDER BY l.lemma, s.sense_no, s.id
) TO '/tmp/ja-senses.csv' WITH (FORMAT csv)
