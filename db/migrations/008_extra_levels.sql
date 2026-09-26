-- Nguồn phụ JLPT và kanji-data được giữ riêng để truy vết dữ liệu bổ sung.
CREATE TABLE staging.jlpt_entry (
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
  expression text NOT NULL,
  reading text,
  meaning text,
  tags text,
  row_number integer NOT NULL,
  batch_id uuid NOT NULL REFERENCES staging.import_batch(id),
  PRIMARY KEY (level,row_number)
);
CREATE INDEX jlpt_entry_match ON staging.jlpt_entry (expression,reading);

CREATE TABLE staging.kanji_data_entry (
  literal text PRIMARY KEY,
  payload jsonb NOT NULL,
  batch_id uuid NOT NULL REFERENCES staging.import_batch(id)
);

CREATE TABLE core.lexeme_level (
  lexeme_id bigint NOT NULL REFERENCES core.lexeme(id),
  scheme text NOT NULL CHECK (scheme='JLPT'),
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
  match_method text NOT NULL CHECK (match_method IN ('form_reading','lemma_reading')),
  source_id integer NOT NULL REFERENCES public.source(id),
  batch_id uuid NOT NULL REFERENCES staging.import_batch(id),
  PRIMARY KEY (lexeme_id,scheme)
);
CREATE INDEX lexeme_level_lookup ON core.lexeme_level (scheme,level,lexeme_id);

ALTER TABLE core.kanji ADD COLUMN jlpt_new smallint CHECK (jlpt_new BETWEEN 1 AND 5);
ALTER TABLE core.kanji ADD COLUMN jlpt_new_source_id integer REFERENCES public.source(id);
