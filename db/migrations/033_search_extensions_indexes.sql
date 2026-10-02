-- 033_search_extensions_indexes.sql — DB2: hạ tầng tìm kiếm (pg_trgm + GIN trigram).
--
-- Mục tiêu: tìm chuỗi con (ILIKE '%...%') trên lexeme/lexeme_form dùng index thay
-- vì quét tuần tự 2,38M dòng. `unaccent` được cài sẵn cho DB3 (gloss tiếng Việt
-- tra không dấu) — DB2 chưa dùng trong query/index.
--
-- Lưu ý môi trường: PostgreSQL nhúng dùng cho dev/test local KHÔNG kèm contrib
-- (thiếu file pg_trgm/unaccent) → khối guard bên dưới bỏ qua và chỉ ghi NOTICE;
-- VPS (PG16 có sẵn) và CI (postgres:17) tạo đủ extension + index.

DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_trgm';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'DB2: bỏ qua pg_trgm (%.%) — môi trường thiếu contrib', SQLSTATE, SQLERRM;
  END;

  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS unaccent';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'DB2: bỏ qua unaccent (%.%) — môi trường thiếu contrib', SQLSTATE, SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS lexeme_lemma_trgm
               ON core.lexeme USING gin (lemma gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS lexeme_reading_trgm
               ON core.lexeme USING gin (reading gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS lexeme_romanization_trgm
               ON core.lexeme USING gin (romanization gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS lexeme_form_text_trgm
               ON core.lexeme_form USING gin (form_text gin_trgm_ops)';
    EXECUTE 'COMMENT ON INDEX core.lexeme_lemma_trgm IS
               ''DB2: GIN trigram cho tìm chuỗi con trên mặt chữ (ILIKE %...%).''';
    EXECUTE 'COMMENT ON INDEX core.lexeme_reading_trgm IS
               ''DB2: GIN trigram cho cách đọc (kana).''';
    EXECUTE 'COMMENT ON INDEX core.lexeme_romanization_trgm IS
               ''DB2: GIN trigram cho romaji (dữ liệu thật hiện phần lớn NULL).''';
    EXECUTE 'COMMENT ON INDEX core.lexeme_form_text_trgm IS
               ''DB2: GIN trigram cho biến thể/biến âm (lexeme_form.form_text).''';
  ELSE
    RAISE NOTICE 'DB2: bỏ qua 4 index trigram vì thiếu pg_trgm';
  END IF;
END $$;
