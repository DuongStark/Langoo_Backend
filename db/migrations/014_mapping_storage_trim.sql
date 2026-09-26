-- Crosswalk là bảng khóa tra cứu; không lặp metadata nguồn lớn trên từng dòng.
-- Các dữ liệu chi tiết vẫn lấy từ staging theo staging_row_id và từ lexeme_id.
ALTER TABLE core.source_entry_identity
  DROP COLUMN language_id,
  DROP COLUMN word,
  DROP COLUMN pos,
  DROP COLUMN source_ordinal,
  DROP COLUMN attributes;

COMMENT ON TABLE core.source_entry_identity IS
  'Crosswalk gọn giữa khóa nguồn của snapshot và core.lexeme; metadata chi tiết ở staging.';
