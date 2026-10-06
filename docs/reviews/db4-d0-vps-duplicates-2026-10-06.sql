-- DB4-D0: dictionary duplicate inventory. No user content or database writes.
-- psql -X -q -A -t -v ON_ERROR_STOP=1 -d langoo < this file
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';
SET LOCAL work_mem = '16MB';
SET LOCAL max_parallel_workers_per_gather = 0;
SET LOCAL temp_file_limit = '768MB';
SET LOCAL application_name = 'langoo-db4-d0-duplicate-audit';

SELECT json_build_object('metric','environment','rows',json_build_array(json_build_object(
  'observed_at',clock_timestamp(),'database',current_database(),'server_version',current_setting('server_version'),
  'database_bytes',pg_database_size(current_database()),'snapshot',pg_current_snapshot()::text)));

SELECT json_build_object('metric','source_lexeme_sense_counts','rows',coalesce(json_agg(t),'[]'::json))
FROM (
  WITH l AS (SELECT language_id,source_id,count(*)::bigint AS lexemes,
                    count(*) FILTER (WHERE nullif(reading,'') IS NOT NULL)::bigint AS with_reading
             FROM core.lexeme GROUP BY language_id,source_id),
       s AS (SELECT l.language_id,s.source_id,count(*)::bigint AS senses,
                    count(*) FILTER (WHERE nullif(btrim(s.definition),'') IS NOT NULL)::bigint AS with_definition
             FROM core.sense s JOIN core.lexeme l ON l.id=s.lexeme_id GROUP BY l.language_id,s.source_id)
  SELECT lg.code AS language,coalesce(src.code,'unknown') AS source,l.lexemes,l.with_reading,
         coalesce(s.senses,0)::bigint AS senses,coalesce(s.with_definition,0)::bigint AS with_definition
  FROM l JOIN public.language lg ON lg.id=l.language_id LEFT JOIN public.source src ON src.id=l.source_id
  LEFT JOIN s ON s.language_id=l.language_id AND s.source_id IS NOT DISTINCT FROM l.source_id
  ORDER BY lg.code,source
) t;

SELECT json_build_object('metric','staging_availability','rows',json_build_array(json_build_object(
  'wikt_entry',(SELECT count(*)::bigint FROM staging.wikt_entry),
  'wn_synset',(SELECT count(*)::bigint FROM staging.wn_synset),
  'jmdict_entry',(SELECT count(*)::bigint FROM staging.jmdict_entry))));

SELECT json_build_object('metric','lexical_candidate_groups','rows',coalesce(json_agg(t),'[]'::json))
FROM (
  WITH groups AS (
    SELECT language_id,lemma,pos,reading,count(*)::bigint AS n,
           count(DISTINCT coalesce(source_id,-1))::int AS sources
    FROM core.lexeme WHERE language_id IN (1,2)
    GROUP BY language_id,lemma,pos,reading
  )
  SELECT lg.code AS language,count(*)::bigint AS lexical_keys,sum(n)::bigint AS lexemes,
         count(*) FILTER (WHERE n>1)::bigint AS repeated_keys,
         coalesce(sum(n) FILTER (WHERE n>1),0)::bigint AS lexemes_in_repeated_keys,
         coalesce(sum(n-1) FILTER (WHERE n>1),0)::bigint AS extra_lexical_rows,
         count(*) FILTER (WHERE n>1 AND sources>1)::bigint AS cross_source_keys,
         count(*) FILTER (WHERE n>1 AND sources=1)::bigint AS same_source_keys,
         count(*) FILTER (WHERE n>1 AND nullif(reading,'') IS NULL)::bigint AS unknown_reading_repeated_keys
  FROM groups g JOIN public.language lg ON lg.id=g.language_id GROUP BY lg.code ORDER BY lg.code
) t;

SELECT json_build_object('metric','search_face_duplicates','rows',coalesce(json_agg(t),'[]'::json))
FROM (
  WITH forms AS (
    SELECT lexeme_id,form_text,count(*)::bigint AS n FROM core.lexeme_form GROUP BY lexeme_id,form_text
  ), pairs AS (
    SELECT l.language_id, f.n + CASE WHEN f.form_text=l.lemma THEN 1 ELSE 0 END AS face_count
    FROM forms f JOIN core.lexeme l ON l.id=f.lexeme_id
  ), totals AS (
    SELECT language_id,count(*)::bigint AS lexemes FROM core.lexeme GROUP BY language_id
  ), form_totals AS (
    SELECT l.language_id,count(*)::bigint AS forms FROM core.lexeme_form f
    JOIN core.lexeme l ON l.id=f.lexeme_id GROUP BY l.language_id
  ), dup AS (
    SELECT language_id,count(*) FILTER(WHERE face_count>1)::bigint AS repeated_same_id_surface_pairs,
           coalesce(sum(face_count-1) FILTER(WHERE face_count>1),0)::bigint AS extra_search_faces
    FROM pairs GROUP BY language_id
  )
  SELECT lg.code AS language,t.lexemes,coalesce(f.forms,0)::bigint AS forms,
         (t.lexemes+coalesce(f.forms,0))::bigint AS total_search_faces,
         coalesce(d.repeated_same_id_surface_pairs,0)::bigint AS repeated_same_id_surface_pairs,
         coalesce(d.extra_search_faces,0)::bigint AS extra_search_faces
  FROM totals t JOIN public.language lg ON lg.id=t.language_id LEFT JOIN form_totals f ON f.language_id=t.language_id
  LEFT JOIN dup d ON d.language_id=t.language_id ORDER BY lg.code
) t;

SELECT json_build_object('metric','same_lexeme_definition_candidates','rows',coalesce(json_agg(t),'[]'::json))
FROM (
  WITH groups AS (
    SELECT lexeme_id,definition,count(*)::bigint AS n FROM core.sense
    WHERE nullif(btrim(definition),'') IS NOT NULL GROUP BY lexeme_id,definition HAVING count(*)>1
  )
  SELECT lg.code AS language,count(*)::bigint AS repeated_definition_groups,
         count(DISTINCT g.lexeme_id)::bigint AS affected_lexemes,sum(g.n)::bigint AS senses_in_groups,
         sum(g.n-1)::bigint AS extra_same_definition_rows
  FROM groups g JOIN core.lexeme l ON l.id=g.lexeme_id JOIN public.language lg ON lg.id=l.language_id
  GROUP BY lg.code ORDER BY lg.code
) t;

SELECT json_build_object('metric','wiktextract_first_last_projection','rows',coalesce(json_agg(t),'[]'::json))
FROM (
  WITH glosses AS (
    SELECT g.sense_id,array_agg(g.text ORDER BY g.rank,g.id) AS texts
    FROM core.sense_gloss g JOIN public.source src ON src.id=g.source_id
    WHERE src.code='wiktextract' AND g.language_id=1 GROUP BY g.sense_id
  )
  SELECT lg.code AS language,count(*)::bigint AS senses_with_en_group,
         count(*) FILTER(WHERE cardinality(g.texts)>1)::bigint AS multi_gloss_senses,
         count(*) FILTER(WHERE cardinality(g.texts)>1 AND g.texts[1]<>g.texts[cardinality(g.texts)])::bigint AS first_last_differ,
         count(*) FILTER(WHERE cardinality(g.texts)>1 AND g.texts[1]<>g.texts[cardinality(g.texts)] AND s.definition=g.texts[1])::bigint AS definition_equals_parent,
         count(*) FILTER(WHERE cardinality(g.texts)>1 AND g.texts[1]<>g.texts[cardinality(g.texts)] AND s.definition=g.texts[cardinality(g.texts)])::bigint AS definition_equals_leaf
  FROM glosses g JOIN core.sense s ON s.id=g.sense_id JOIN core.lexeme l ON l.id=s.lexeme_id
  JOIN public.language lg ON lg.id=l.language_id GROUP BY lg.code ORDER BY lg.code
) t;

SELECT json_build_object('metric','verified_wordnet_shared_concept_groups','rows',coalesce(json_agg(t),'[]'::json))
FROM (
  WITH groups AS (
    SELECT l.language_id,l.lemma,l.pos,sc.concept_id,count(DISTINCT s.id)::bigint AS senses,
           count(DISTINCT l.id)::bigint AS lexemes,count(DISTINCT coalesce(s.source_id,-1))::int AS sources
    FROM core.sense_concept sc JOIN core.sense s ON s.id=sc.sense_id JOIN core.lexeme l ON l.id=s.lexeme_id
    WHERE sc.verified AND sc.relation='exact' AND sc.method='wordnet_synset'
    GROUP BY l.language_id,l.lemma,l.pos,sc.concept_id HAVING count(DISTINCT s.id)>1
  )
  SELECT lg.code AS language,count(*)::bigint AS groups,sum(senses)::bigint AS sense_memberships,
         sum(senses-1)::bigint AS extra_sense_memberships,
         count(*) FILTER(WHERE lexemes>1)::bigint AS groups_across_lexemes,
         count(*) FILTER(WHERE sources>1)::bigint AS groups_across_sources
  FROM groups g JOIN public.language lg ON lg.id=g.language_id GROUP BY lg.code ORDER BY lg.code
) t;

SELECT json_build_object('metric','core_id_fk_dependencies','rows',coalesce(json_agg(t),'[]'::json))
FROM (
  SELECT n.nspname AS schema,c.relname AS referencing_table,con.conname,
         rn.nspname||'.'||rc.relname AS referenced_table,pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_class rc ON rc.oid=con.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
  WHERE con.contype='f' AND con.confrelid IN ('core.lexeme'::regclass,'core.sense'::regclass)
  ORDER BY referenced_table,n.nspname,c.relname,con.conname
) t;

SELECT json_build_object('metric','end','rows',json_build_array(json_build_object('finished_at',clock_timestamp())));
COMMIT;

-- Follow-up snapshot: scope and source evidence, after inventory transaction.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL work_mem = '16MB';
SET LOCAL max_parallel_workers_per_gather = 0;
SET LOCAL temp_file_limit = '768MB';
SET LOCAL application_name = 'langoo-db4-d0-followup-audit';
SELECT json_build_object('metric','followup_environment','rows',json_build_array(json_build_object(
  'observed_at',clock_timestamp(),'snapshot',pg_current_snapshot()::text)));
SELECT json_build_object('metric','jlpt_scope','rows',coalesce(json_agg(t),'[]'::json)) FROM (
 WITH targets AS (SELECT DISTINCT lexeme_id FROM core.jlpt_link WHERE status='accepted' AND lexeme_id IS NOT NULL)
 SELECT src.code AS source,count(DISTINCT l.id)::bigint AS lexemes,count(s.id)::bigint AS senses,
 count(*) FILTER(WHERE nullif(btrim(s.definition),'') IS NOT NULL)::bigint AS with_definition
 FROM targets t JOIN core.lexeme l ON l.id=t.lexeme_id JOIN core.sense s ON s.lexeme_id=l.id
 JOIN public.source src ON src.id=l.source_id GROUP BY src.code ORDER BY src.code
) t;
SELECT json_build_object('metric','wordnet_identical_definition_evidence','rows',coalesce(json_agg(t),'[]'::json)) FROM (
 WITH groups AS (
 SELECT l.language_id,l.lemma,l.pos,l.reading,sc.concept_id,
 count(DISTINCT s.id)::bigint AS n,count(DISTINCT s.definition) AS definitions,
 count(*) FILTER(WHERE nullif(btrim(s.definition),'') IS NULL) AS empty_definitions,
 count(DISTINCT s.source_id) AS sources
 FROM core.sense_concept sc JOIN core.sense s ON s.id=sc.sense_id JOIN core.lexeme l ON l.id=s.lexeme_id
 WHERE sc.verified AND sc.relation='exact' AND sc.method='wordnet_synset'
 GROUP BY l.language_id,l.lemma,l.pos,l.reading,sc.concept_id HAVING count(DISTINCT s.id)>1)
 SELECT lg.code AS language,count(*)::bigint AS groups_same_key_concept_definition,
 sum(n)::bigint AS sense_memberships,sum(n-1)::bigint AS extra_sense_memberships
 FROM groups g JOIN public.language lg ON lg.id=g.language_id
 WHERE definitions=1 AND empty_definitions=0 AND sources>1 GROUP BY lg.code ORDER BY lg.code
) t;
SELECT json_build_object('metric','projection_examples','rows',coalesce(json_agg(t),'[]'::json)) FROM (
 SELECT s.id AS sense_id,s.lexeme_id,s.sense_no,s.definition,s.attributes,
 (SELECT json_agg(json_build_object('rank',g.rank,'text',g.text,'source_id',g.source_id) ORDER BY g.rank,g.id)
  FROM core.sense_gloss g WHERE g.sense_id=s.id AND g.language_id=1) AS en_glosses
 FROM core.sense s WHERE s.id IN (1810300,1810301,1810302,1417635,1417636) ORDER BY s.id
) t;
SELECT json_build_object('metric','followup_end','rows',json_build_array(json_build_object('finished_at',clock_timestamp())));
COMMIT;

-- Final total cross-check, separate snapshot (content may drift between snapshots).
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT json_build_object('metric','exact_core_totals','rows',json_build_array(json_build_object(
  'observed_at',clock_timestamp(),'snapshot',pg_current_snapshot()::text,
  'lexemes',(SELECT count(*) FROM core.lexeme),'senses',(SELECT count(*) FROM core.sense),
  'sense_glosses',(SELECT count(*) FROM core.sense_gloss),'forms',(SELECT count(*) FROM core.lexeme_form))));
COMMIT;
