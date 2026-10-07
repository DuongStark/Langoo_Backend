-- M4.5: versioned, reversible JA display metadata. Core identities/glosses unchanged.
CREATE TABLE core.dictionary_priority_run (
  id uuid PRIMARY KEY,
  policy text NOT NULL,
  language_id smallint NOT NULL REFERENCES public.language(id),
  source_code text NOT NULL,
  source_version text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  target_identity text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dictionary_priority_one_active
  ON core.dictionary_priority_run(language_id, policy) WHERE active;

CREATE TABLE core.lexeme_learner_priority (
  run_id uuid NOT NULL REFERENCES core.dictionary_priority_run(id),
  lexeme_id bigint NOT NULL REFERENCES core.lexeme(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  corpus_rank integer CHECK (corpus_rank > 0),
  corpus_count bigint CHECK (corpus_count > 0),
  evidence jsonb NOT NULL,
  PRIMARY KEY (run_id, lexeme_id)
);
CREATE INDEX lexeme_learner_priority_lookup ON core.lexeme_learner_priority(lexeme_id, run_id);

CREATE TABLE core.sense_learner_priority (
  run_id uuid NOT NULL REFERENCES core.dictionary_priority_run(id),
  sense_id bigint NOT NULL REFERENCES core.sense(id) ON DELETE CASCADE,
  lexeme_id bigint NOT NULL REFERENCES core.lexeme(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  display_order smallint NOT NULL CHECK (display_order > 0),
  reason text NOT NULL,
  reviewer_kind text NOT NULL CHECK (reviewer_kind IN ('llm', 'source_rule')),
  PRIMARY KEY (run_id, sense_id),
  UNIQUE (run_id, lexeme_id, display_order)
);
CREATE INDEX sense_learner_priority_lookup ON core.sense_learner_priority(lexeme_id,run_id);

CREATE FUNCTION core.japanese_priority_input_hash(lexeme_id bigint) RETURNS text
LANGUAGE sql STABLE STRICT AS $$
  SELECT md5(jsonb_build_array(l.external_id,l.language_id,l.lemma,l.reading,l.pos,
                              l.attributes,src.code,src.version)::text)
  FROM core.lexeme l JOIN public.source src ON src.id=l.source_id
  JOIN public.language lang ON lang.id=l.language_id
  WHERE l.id=lexeme_id AND lang.code='ja' AND src.code='jmdict'
$$;

CREATE FUNCTION core.japanese_sense_input_hash(sense_id bigint) RETURNS text
LANGUAGE sql STABLE STRICT AS $$
  SELECT md5(jsonb_build_array(s.external_id,s.sense_no,s.attributes,s.definition,
                              s.definition_language_id,
                              core.japanese_priority_input_hash(s.lexeme_id),
                              (SELECT jsonb_agg(jsonb_build_array(g.rank,g.text,g.source_id)
                                                ORDER BY g.rank,g.id)
                               FROM core.sense_gloss g JOIN public.language lg ON lg.id=g.language_id
                               WHERE g.sense_id=s.id AND lg.code='en'))::text)
  FROM core.sense s WHERE s.id=sense_id
$$;

CREATE VIEW serve.japanese_lexeme_priority AS
SELECT p.lexeme_id,p.corpus_rank,p.corpus_count,p.evidence,r.source_code,r.id AS run_id
FROM core.lexeme_learner_priority p
JOIN core.dictionary_priority_run r ON r.id=p.run_id AND r.active
WHERE r.policy='ja-bccwj-v1'
  AND p.input_hash=core.japanese_priority_input_hash(p.lexeme_id);

CREATE VIEW serve.japanese_sense_priority AS
SELECT p.sense_id,p.lexeme_id,p.display_order,p.reason,p.reviewer_kind,r.id AS run_id
FROM core.sense_learner_priority p
JOIN core.dictionary_priority_run r ON r.id=p.run_id AND r.active
WHERE r.policy='ja-bccwj-v1'
  AND p.input_hash=core.japanese_sense_input_hash(p.sense_id);
