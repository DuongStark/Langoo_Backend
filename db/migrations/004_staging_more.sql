-- 004_staging_more.sql — bảng staging còn lại

-- câu ví dụ của WordNet (synset_examples trong wn.db)
CREATE TABLE IF NOT EXISTS staging.wn_example (
  lexicon    text NOT NULL,
  synset_id  text NOT NULL,
  example    text NOT NULL,
  language   text,
  batch_id   uuid NOT NULL REFERENCES staging.import_batch
);
CREATE INDEX IF NOT EXISTS wn_example_synset ON staging.wn_example (lexicon, synset_id);
