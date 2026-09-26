-- Giữ danh tính synset nguồn và các quan hệ gốc. ILI có thể dùng chung giữa
-- nhiều lexicon, nên quan hệ WordNet không thể chỉ nối qua core.concept.
CREATE TABLE core.wordnet_synset (
  lexicon text NOT NULL,
  synset_id text NOT NULL,
  concept_id bigint NOT NULL REFERENCES core.concept(id),
  source_id integer NOT NULL REFERENCES public.source(id),
  batch_id uuid NOT NULL REFERENCES staging.import_batch(id),
  PRIMARY KEY (lexicon, synset_id)
);
CREATE INDEX wordnet_synset_concept ON core.wordnet_synset (concept_id);

CREATE TABLE core.wordnet_relation (
  lexicon text NOT NULL,
  source_synset_id text NOT NULL,
  target_synset_id text NOT NULL,
  rel_type text NOT NULL,
  batch_id uuid NOT NULL REFERENCES staging.import_batch(id),
  PRIMARY KEY (lexicon, source_synset_id, target_synset_id, rel_type),
  FOREIGN KEY (lexicon, source_synset_id)
    REFERENCES core.wordnet_synset(lexicon, synset_id),
  FOREIGN KEY (lexicon, target_synset_id)
    REFERENCES core.wordnet_synset(lexicon, synset_id)
);
CREATE INDEX wordnet_relation_target
  ON core.wordnet_relation (lexicon, target_synset_id, rel_type);

-- Câu dịch Tatoeba là một cạnh có hướng giữa hai câu có ID riêng.
CREATE TABLE core.example_translation (
  example_id bigint NOT NULL REFERENCES core.example(id),
  translation_id bigint NOT NULL REFERENCES core.example(id),
  batch_id uuid NOT NULL REFERENCES staging.import_batch(id),
  PRIMARY KEY (example_id, translation_id),
  CHECK (example_id <> translation_id)
);
CREATE INDEX example_translation_target
  ON core.example_translation (translation_id, example_id);
