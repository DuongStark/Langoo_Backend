-- 040: thành phần cấu tạo kanji từ KanjiVG (kvg:element tree).
-- Nguồn: KanjiVG (CC BY-SA 3.0, Ulrich Apel). Fallback hiển thị: core.kanji_radical (KRADFILE).
CREATE TABLE core.kanji_component (
  kanji_literal text NOT NULL,
  ord smallint NOT NULL,
  parent_ord smallint,
  depth smallint NOT NULL,
  component text NOT NULL,
  original text,
  is_variant boolean NOT NULL DEFAULT false,
  is_radical boolean NOT NULL DEFAULT false,
  is_phonetic boolean NOT NULL DEFAULT false,
  "position" text,
  part smallint,
  strokes smallint[] NOT NULL DEFAULT '{}',
  stroke_count smallint NOT NULL DEFAULT 0,
  source_id integer,
  batch_id uuid,
  PRIMARY KEY (kanji_literal, ord),
  CONSTRAINT kanji_component_component_check CHECK (btrim(component) <> ''),
  CONSTRAINT kanji_component_depth_check CHECK (depth >= 0),
  CONSTRAINT kanji_component_ord_check CHECK (ord >= 0)
);

COMMENT ON TABLE core.kanji_component IS
  'Cây thành phần kanji từ KanjiVG (kvg:element/original/variant/position/radical/phon); CC BY-SA 3.0 Ulrich Apel';
COMMENT ON COLUMN core.kanji_component.ord IS 'Thứ tự preorder trong cây (0 = chính chữ)';
COMMENT ON COLUMN core.kanji_component.parent_ord IS 'ord của thành phần cha (null nếu là gốc)';
COMMENT ON COLUMN core.kanji_component.strokes IS 'Số nét (1-based) thuộc thành phần, theo KanjiVG stroke id';
COMMENT ON COLUMN core.kanji_component.original IS 'Dạng gốc của biến thể, vd ⺨→犬, 亻→人';

GRANT SELECT, INSERT, UPDATE, DELETE ON core.kanji_component TO langoo;
