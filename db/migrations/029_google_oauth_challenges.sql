-- 029_google_oauth_challenges.sql — M2.3/C one-time Google OAuth challenges.
-- Raw nonce/binding values are returned once and are never persisted.

CREATE TABLE app.google_oauth_challenge (
  id           uuid PRIMARY KEY,
  purpose      text NOT NULL CHECK (purpose IN ('login', 'link')),
  user_id      bigint REFERENCES app.users(id) ON DELETE CASCADE,
  session_id   uuid REFERENCES app.user_session(id) ON DELETE CASCADE,
  nonce_hash   text NOT NULL CHECK (btrim(nonce_hash) <> ''),
  binding_hash text NOT NULL CHECK (btrim(binding_hash) <> ''),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_oauth_challenge_link_context CHECK (
    (purpose = 'login' AND user_id IS NULL AND session_id IS NULL) OR
    (purpose = 'link' AND user_id IS NOT NULL AND session_id IS NOT NULL)
  )
);

CREATE INDEX google_oauth_challenge_live
  ON app.google_oauth_challenge (purpose, expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX google_oauth_challenge_user_live
  ON app.google_oauth_challenge (user_id, expires_at)
  WHERE consumed_at IS NULL AND user_id IS NOT NULL;
