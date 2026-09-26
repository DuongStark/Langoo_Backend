-- Các sense Wiktextract không có mảng gloss nhưng còn definition cache cũ
-- vẫn lấy từ Wiktionary tiếng Anh; đánh dấu rõ ngôn ngữ để UI không suy diễn.
UPDATE core.sense
SET definition_language_id = 1
WHERE source_id=(SELECT id FROM public.source WHERE code='wiktextract')
  AND definition IS NOT NULL
  AND definition_language_id IS NULL;
