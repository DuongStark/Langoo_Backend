-- M14 (15/10/2026): admin curation ghi core — sửa gloss VI + sửa/xoá/thêm nối nghĩa.
-- Chính sách chủ dự án: máy dịch/mapping máy MẶC ĐỊNH OK (default-accept),
-- admin sửa sau theo report người dùng (M13 feedback/gloss_report đã có).
--
-- Thay đổi:
--   1) core.sense_concept thêm reviewed_by/reviewed_at (dấu admin đã sửa/thêm nối nghĩa).
--   2) public.source thêm 'admin-curation' — nguồn provenance cho nội dung admin tạo.

ALTER TABLE core.sense_concept ADD COLUMN IF NOT EXISTS reviewed_by bigint;
ALTER TABLE core.sense_concept ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sense_concept_review_pair'
  ) THEN
    ALTER TABLE core.sense_concept
      ADD CONSTRAINT sense_concept_review_pair
      CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
  END IF;
END $$;

INSERT INTO public.source(id, code, name, license, attribution, version)
SELECT COALESCE(MAX(id), 0) + 1,
       'admin-curation',
       'Langoo admin curation (M14)',
       'nội bộ',
       'Admin Langoo nhập/sửa thủ công theo báo cáo người dùng',
       'v1'
FROM public.source
WHERE NOT EXISTS (SELECT 1 FROM public.source WHERE code = 'admin-curation');
