-- 003_staging_indexes.sql — index phụ trợ cho staging

-- tra câu dịch ngược: "câu tiếng Việt này được dịch từ câu nào"
CREATE INDEX IF NOT EXISTS tatoeba_link_trans
  ON staging.tatoeba_link (translation_id);

-- lọc nhanh câu theo ngôn ngữ + độ dài
CREATE INDEX IF NOT EXISTS tatoeba_sentence_lang
  ON staging.tatoeba_sentence (lang);
