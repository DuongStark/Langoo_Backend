-- M2.3 B — Password recovery challenges (additive; apply after 051).
-- Raw reset token is only sent by email; PostgreSQL stores SHA-256 hex only.
CREATE TABLE app.password_reset_challenge (
  id             uuid PRIMARY KEY,
  identity_id    bigint NOT NULL REFERENCES app.user_identity(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  email_at_issue text NOT NULL CHECK (btrim(email_at_issue) <> ''),
  created_at     timestamptz(6) NOT NULL DEFAULT now(),
  expires_at     timestamptz(6) NOT NULL,
  consumed_at    timestamptz(6)
);

CREATE INDEX password_reset_challenge_identity_created_idx
  ON app.password_reset_challenge (identity_id, created_at DESC);
