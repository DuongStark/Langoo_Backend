-- 026_srs_scheduler.sql — bổ sung cột cho scheduler SRS theo mô hình Anki (M6).
-- Chỉ ADD COLUMN / ADD CONSTRAINT / CREATE INDEX — không sửa/xoá dữ liệu cũ.
-- Chạy qua `npm run db:migrate` (local trước, cloud chỉ sau khi được duyệt).

-- ------------------------------------------------------------------ srs_state
ALTER TABLE app.srs_state
  ADD COLUMN ease_factor   real NOT NULL DEFAULT 2.5,
  ADD COLUMN learning_step smallint,
  ADD COLUMN introduced_at timestamptz,
  ADD COLUMN buried_until  timestamptz;

ALTER TABLE app.srs_state
  ADD CONSTRAINT srs_state_ease_factor_check CHECK (ease_factor >= 1.3),
  ADD CONSTRAINT srs_state_learning_step_check
    CHECK (learning_step IS NULL OR learning_step >= 0);

-- ------------------------------------------------------------------ review_log
-- Idempotency: bảng là PARTITION theo reviewed_at nên không thể unique
-- (user_id, client_review_id) — chống trùng bằng row lock trên srs_state +
-- tra cứu index dưới đây (xem docs/srs.md §1/§5).
ALTER TABLE app.review_log
  ADD COLUMN client_review_id uuid,
  ADD COLUMN prev_state text;

ALTER TABLE app.review_log
  ADD CONSTRAINT review_log_prev_state_check
    CHECK (prev_state IS NULL OR prev_state IN ('new', 'learning', 'review', 'relearning'));

CREATE INDEX review_log_client_review
  ON app.review_log (user_id, client_review_id)
  WHERE client_review_id IS NOT NULL;

-- ------------------------------------------------------------------ user_settings
ALTER TABLE app.user_settings
  ADD COLUMN srs_new_per_day    smallint NOT NULL DEFAULT 20,
  ADD COLUMN srs_review_per_day smallint NOT NULL DEFAULT 200;

ALTER TABLE app.user_settings
  ADD CONSTRAINT user_settings_srs_new_per_day_check
    CHECK (srs_new_per_day BETWEEN 1 AND 9999),
  ADD CONSTRAINT user_settings_srs_review_per_day_check
    CHECK (srs_review_per_day BETWEEN 1 AND 9999);
