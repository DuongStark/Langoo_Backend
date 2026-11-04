-- M12.1: terms acceptance is separate from optional privacy grants.
CREATE TABLE app.terms_acceptance (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    terms_version text NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 80),
    accepted_at timestamptz(6) NOT NULL DEFAULT now(),
    CONSTRAINT terms_acceptance_user_request_key UNIQUE (user_id, request_id)
);
CREATE INDEX terms_acceptance_user_latest_idx
    ON app.terms_acceptance (user_id, id DESC);
