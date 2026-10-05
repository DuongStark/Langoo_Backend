-- M10: one in-flight provider request per chat session across API processes.
-- Expiration recovers abandoned requests after a process crash. A unique token
-- fences a late provider response after the lease has been replaced or archived.
ALTER TABLE app.chat_session
  ADD COLUMN pending_request_id uuid,
  ADD COLUMN pending_request_expires_at timestamptz,
  ADD CONSTRAINT chat_session_request_lease_pair CHECK (
    (pending_request_id IS NULL) = (pending_request_expires_at IS NULL)
  );
