-- ============================================================================
-- Ẩn ví dụ EN "rác" khỏi API từ điển (sense detail — getExamples)
-- ============================================================================
-- Nạp danh sách md5(text) của 44.359 câu ví dụ EN đã được model chấm là junk
-- (quote văn học cổ, mảnh câu, không tự nhiên) vào bảng staging, để API không
-- trả các example đó nữa (xem src/dictionary/repositories/sense-content.repository.ts).
-- KHÔNG xoá/sửa dữ liệu `core.example` — chỉ lọc ở tầng đọc, rollback = DROP bảng.
--
-- Artifact nguồn (mỗi dòng 1 md5 hex của text UTF-8, không trùng):
--   /tmp/opencode/en-junk-hashes.txt  (44.359 dòng)
-- Đường dẫn chuẩn trên VPS (scp lên trước khi apply):
--   /opt/langoo/storage/dictionary/en-junk-hashes-2026-10-13.txt
--
-- APPLY (chạy trên VPS):
--   scp /tmp/opencode/en-junk-hashes.txt \
--     langoo@<vps>:/opt/langoo/storage/dictionary/en-junk-hashes-2026-10-13.txt
--   sudo -u postgres psql -d langoo -v ON_ERROR_STOP=1 \
--     -f /opt/langoo/app/db/ops/apply-en-junk-filter.sql
--   # COPY đọc file phía server PostgreSQL nên user postgres (superuser /
--   # pg_read_server_files) phải đọc được file. Nếu /opt bị chặn quyền (bài học
--   # 2026-10-08), copy sang /tmp rồi truyền đường dẫn khác:
--   #   cp .../en-junk-hashes-2026-10-13.txt /tmp/
--   #   sudo -u postgres psql -d langoo -v ON_ERROR_STOP=1 \
--   #     -v hash_file=/tmp/en-junk-hashes-2026-10-13.txt \
--   #     -f /opt/langoo/app/db/ops/apply-en-junk-filter.sql
--   # Không dùng được vai trò app (langoo) nếu role đó không có quyền tạo bảng /
--   # đọc file server; fallback không cần superuser (chạy tay từng bước):
--   #   CREATE TABLE IF NOT EXISTS staging.junk_en_example_text(hash text PRIMARY KEY);
--   #   \copy staging.junk_en_example_text (hash) FROM '/duong/dan/file'
--
-- ROLLBACK:
--   DROP TABLE staging.junk_en_example_text;
--   (code tự bỏ điều kiện lọc khi bảng vắng — không cần deploy lại code)
-- ============================================================================
\set ON_ERROR_STOP on

-- Cho phép override đường dẫn file hash khi apply (mặc định là path chuẩn VPS).
-- Lưu ý: \copy KHÔNG nội suy biến psql nên file này dùng COPY (server-side).
\if :{?hash_file}
\else
\set hash_file '/opt/langoo/storage/dictionary/en-junk-hashes-2026-10-13.txt'
\endif

BEGIN;
SELECT pg_advisory_xact_lock(hashtext('en-junk-filter-20261013'));
SET LOCAL lock_timeout = '10s';
-- Bước đối chiếu cuối file quét md5 toàn bộ example EN — cho thời gian rộng.
SET LOCAL statement_timeout = '600s';

DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'server_encoding=% nhưng hash tính trên UTF-8 — không nạp',
      current_setting('server_encoding');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS staging.junk_en_example_text (
  hash text PRIMARY KEY
);

TRUNCATE staging.junk_en_example_text;

-- COPY server-side: cần user chạy psql là superuser hoặc pg_read_server_files.
COPY staging.junk_en_example_text (hash) FROM :'hash_file';

DO $$
DECLARE n bigint; bad bigint;
BEGIN
  SELECT count(*) INTO n FROM staging.junk_en_example_text;
  SELECT count(*) INTO bad
  FROM staging.junk_en_example_text
  WHERE hash !~ '^[0-9a-f]{32}$';
  IF bad <> 0 THEN
    RAISE EXCEPTION '% dòng hash sai định dạng (cần md5 hex 32 ký tự)', bad;
  END IF;
  IF n = 0 THEN
    RAISE EXCEPTION 'không nạp được hash nào — kiểm tra đường dẫn file';
  END IF;
  RAISE NOTICE 'junk_en_example_text: % hash', n;
END $$;

ANALYZE staging.junk_en_example_text;

-- Cấp quyền cho role app. Code đọc bảng bằng DATABASE_URL của app (`langoo`),
-- và đây là chỗ đọc `staging.*` đầu tiên trong code → cần USAGE + SELECT.
-- Bỏ qua khi chính user `langoo` chạy file (tự sở hữu bảng thì không cần grant).
DO $$
BEGIN
  IF current_user <> 'langoo'
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'langoo') THEN
    GRANT USAGE ON SCHEMA staging TO langoo;
    GRANT SELECT ON staging.junk_en_example_text TO langoo;
  END IF;
END $$;

-- Đối chiếu: có bao nhiêu ví dụ EN trong DB thực sự khớp danh sách junk.
-- Kỳ vọng > 0 và xấp xỉ số câu junk còn gắn sense (nếu = 0 → sai encoding/hash).
\echo '--- ví dụ EN khớp danh sách junk:'
SELECT count(*) AS matched_en_examples
FROM core.example e
WHERE e.language_id = 1
  AND EXISTS (
    SELECT 1 FROM staging.junk_en_example_text j WHERE j.hash = md5(e.text)
  );

\echo '--- tổng hash đã nạp:'
SELECT count(*) AS hashes FROM staging.junk_en_example_text;

COMMIT;
