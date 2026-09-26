-- 001_metadata.sql — bảng metadata & mapping (docs v2, Mục 4)
-- Chạy trên PostgreSQL 16+.

-- ============ ngôn ngữ ============
CREATE TABLE IF NOT EXISTS language (
  id            smallint PRIMARY KEY,
  code          text     UNIQUE NOT NULL,          -- 'en','ja','vi','zh-Hans'
  name_vi       text     NOT NULL,
  script        text,                              -- 'Latn','Jpan','Hans'
  is_target     boolean  NOT NULL DEFAULT true,     -- ngôn ngữ người học (en, ja)
  is_support    boolean  NOT NULL DEFAULT false     -- dùng để giải nghĩa (vi)
);

-- ============ nguồn dữ liệu ============
CREATE TABLE IF NOT EXISTS source (
  id           int     PRIMARY KEY,
  code         text    UNIQUE NOT NULL,             -- 'jmdict','oewn','wiktextract',...
  name         text    NOT NULL,
  license      text    NOT NULL,
  attribution  text    NOT NULL,                    -- chuỗi hiển thị ở /credits
  url          text,
  version      text,
  sha256       text,                                -- từ downloads/manifest.json
  imported_at  timestamptz
);

-- ============ ánh xạ mã gốc -> chuẩn hoá ============
-- Giải quyết 83 mã POS + 266 tag của JMdict (docs v2, Mục 4).
CREATE TABLE IF NOT EXISTS tag (
  code       text PRIMARY KEY,                      -- 'n','v5r','uk','comp','ksb','sK'
  kind       text NOT NULL
             CHECK (kind IN ('pos','misc','field','dialect','kanji','kana')),
  label      text NOT NULL,                         -- mô tả tiếng Anh (từ jmdict.tags)
  pos_norm   text,                                  -- chuẩn hoá POS; NULL nếu không phải POS
  domain_vi  text                                   -- nhãn tiếng Việt cho field/dialect
);
CREATE INDEX IF NOT EXISTS tag_kind ON tag (kind);
