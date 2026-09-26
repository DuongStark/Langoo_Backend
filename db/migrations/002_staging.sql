-- 002_staging.sql — tầng staging (docs v2, Mục 9)
-- Giữ nguyên payload gốc + id gốc. Chưa chuẩn hoá gì.

CREATE SCHEMA IF NOT EXISTS staging;

-- mỗi lần import một file = một batch, có sha256 để rollback/truy vết
CREATE TABLE IF NOT EXISTS staging.import_batch (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code  text NOT NULL,
  file_name    text NOT NULL,
  sha256       text NOT NULL,
  row_count    int,
  started_at   timestamptz DEFAULT now(),
  finished_at  timestamptz,
  status       text DEFAULT 'running',
  error        text
);

-- ---------- JMdict (words.item) ----------
CREATE TABLE IF NOT EXISTS staging.jmdict_entry (
  ent_seq  bigint PRIMARY KEY,          -- = words[].id
  payload  jsonb  NOT NULL,             -- nguyên entry JSON
  batch_id uuid   NOT NULL REFERENCES staging.import_batch
);
CREATE INDEX IF NOT EXISTS jmdict_entry_batch ON staging.jmdict_entry (batch_id);

-- ---------- KANJIDIC2 (characters[]) ----------
CREATE TABLE IF NOT EXISTS staging.kanji_entry (
  literal  text  PRIMARY KEY,
  payload  jsonb NOT NULL,
  batch_id uuid  NOT NULL REFERENCES staging.import_batch
);

-- ---------- KRADFILE (kanji map) ----------
CREATE TABLE IF NOT EXISTS staging.krad_entry (
  literal  text  PRIMARY KEY,
  parts    jsonb NOT NULL,              -- ["心","爪","冖","夂"]
  batch_id uuid  NOT NULL REFERENCES staging.import_batch
);

-- ---------- Wiktextract (jsonl, mỗi dòng 1 entry) ----------
CREATE TABLE IF NOT EXISTS staging.wikt_entry (
  id        bigserial PRIMARY KEY,
  lang_code text NOT NULL,
  word      text NOT NULL,
  pos       text,
  payload   jsonb NOT NULL,
  batch_id  uuid NOT NULL REFERENCES staging.import_batch
);
CREATE INDEX IF NOT EXISTS wikt_entry_word ON staging.wikt_entry (lang_code, word, pos);

-- ---------- WordNet (từ wn.db) ----------
-- Nạp phẳng: mỗi synset / mỗi sense một dòng, giữ id gốc.
CREATE TABLE IF NOT EXISTS staging.wn_synset (
  lexicon    text NOT NULL,             -- 'oewn:2024', 'omw-ja:1.4'
  synset_id  text NOT NULL,
  ili        text,
  pos        text,
  lexfile    text,
  definition jsonb DEFAULT '[]',        -- [{lang,text}]
  members    jsonb DEFAULT '[]',        -- [lemma,...]
  batch_id   uuid NOT NULL REFERENCES staging.import_batch,
  PRIMARY KEY (lexicon, synset_id)
);
CREATE INDEX IF NOT EXISTS wn_synset_ili ON staging.wn_synset (ili);

CREATE TABLE IF NOT EXISTS staging.wn_relation (
  lexicon     text NOT NULL,
  source_id   text NOT NULL,
  target_id   text NOT NULL,
  rel_type    text NOT NULL,
  batch_id    uuid NOT NULL REFERENCES staging.import_batch
);
CREATE INDEX IF NOT EXISTS wn_relation_src ON staging.wn_relation (lexicon, source_id);

-- ---------- Tatoeba ----------
CREATE TABLE IF NOT EXISTS staging.tatoeba_sentence (
  id     bigint PRIMARY KEY,
  lang   text NOT NULL,
  text   text NOT NULL,
  batch_id uuid NOT NULL REFERENCES staging.import_batch
);
-- index (lang) nằm trong 003_staging_indexes.sql

CREATE TABLE IF NOT EXISTS staging.tatoeba_link (
  sentence_id    bigint NOT NULL,
  translation_id bigint NOT NULL,
  batch_id       uuid NOT NULL REFERENCES staging.import_batch,
  PRIMARY KEY (sentence_id, translation_id)
);

-- ---------- Nguồn phụ trợ ----------
CREATE TABLE IF NOT EXISTS staging.ili_map_pwn30 (
  ili        text NOT NULL,
  pwn30_offset text NOT NULL,
  batch_id   uuid NOT NULL REFERENCES staging.import_batch,
  PRIMARY KEY (ili, pwn30_offset)
);

CREATE TABLE IF NOT EXISTS staging.omw_wikt_vi (
  pwn30_offset text NOT NULL,
  lemma        text NOT NULL,
  batch_id     uuid NOT NULL REFERENCES staging.import_batch,
  PRIMARY KEY (pwn30_offset, lemma)
);
