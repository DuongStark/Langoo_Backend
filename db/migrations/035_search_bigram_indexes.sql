-- 035_search_bigram_indexes.sql — DB2 (phần 2): index bigram cho pattern ngắn (1–2 ký tự).
--
-- pg_trgm không có trigram nào trong pattern dưới 3 ký tự nên các truy vấn phổ biến
-- như "走る" vẫn quét tuần tự (đo trên VPS: ~8,7s). Hàm core.bigrams + GIN array có sẵn
-- trong PostgreSQL core (KHÔNG cần extension, chạy được cả bản nhúng thiếu contrib):
--   - Mỗi hàng lưu mảng bigram của text đã lowercase.
--   - Truy vấn dùng `bigrams(cột) @> bigrams(từ khoá)` để lấy ứng viên theo index,
--     rồi `ILIKE '%...%'` kiểm chứng lại — containment là điều kiện CẦN, không đủ
--     (mất thứ tự/khoảng cách), nên bắt buộc phải có recheck.

CREATE OR REPLACE FUNCTION core.bigrams(t text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE STRICT
AS $$
  SELECT coalesce(array_agg(substr(t, i, 2)), ARRAY[]::text[])
  FROM generate_series(1, greatest(length(t) - 1, 0)) AS i
$$;

COMMENT ON FUNCTION core.bigrams(text) IS
  'DB2: mảng bigram của text (gọi cùng lower() khi index) — dùng làm điều kiện cần cho tìm chuỗi con ngắn.';

CREATE INDEX IF NOT EXISTS lexeme_lemma_bigm
  ON core.lexeme USING gin (core.bigrams(lower(lemma)));
CREATE INDEX IF NOT EXISTS lexeme_reading_bigm
  ON core.lexeme USING gin (core.bigrams(lower(reading)));
CREATE INDEX IF NOT EXISTS lexeme_romanization_bigm
  ON core.lexeme USING gin (core.bigrams(lower(romanization)));
CREATE INDEX IF NOT EXISTS lexeme_form_text_bigm
  ON core.lexeme_form USING gin (core.bigrams(lower(form_text)));

COMMENT ON INDEX core.lexeme_lemma_bigm IS
  'DB2: GIN bigram cho mặt chữ — tăng tốc ILIKE pattern 1–2 ký tự.';
COMMENT ON INDEX core.lexeme_reading_bigm IS
  'DB2: GIN bigram cho cách đọc (kana).';
COMMENT ON INDEX core.lexeme_romanization_bigm IS
  'DB2: GIN bigram cho romaji.';
COMMENT ON INDEX core.lexeme_form_text_bigm IS
  'DB2: GIN bigram cho biến thể/biến âm.';
