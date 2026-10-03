-- Lưu response gốc cho retry answer để không dựng lại từ SRS/session đã thay đổi.
ALTER TABLE app.study_session_item
  ADD COLUMN answer_receipt jsonb;

ALTER TABLE app.study_session_item
  ADD CONSTRAINT study_session_item_answer_receipt_check
  CHECK (
    answer_receipt IS NULL OR jsonb_typeof(answer_receipt) = 'object'
  );
