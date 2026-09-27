-- 027_srs_review_integrity.sql — M6.1 scheduler/transaction invariants.
-- Do not edit 026 after it has been applied. This migration only changes app.*.

-- real cannot represent the decimal floor 1.3 exactly; double precision lets the
-- application and database enforce the same numeric boundary.
ALTER TABLE app.srs_state
  DROP CONSTRAINT srs_state_ease_factor_check;

ALTER TABLE app.srs_state
  ALTER COLUMN ease_factor TYPE double precision
  USING ease_factor::double precision,
  ADD CONSTRAINT srs_state_ease_factor_check
    CHECK (ease_factor >= 1.3::double precision);

ALTER TABLE app.srs_state
  ADD COLUMN learning_is_interday boolean NOT NULL DEFAULT false;

-- Snapshot review scope/classification at the moment of review. Historical rows
-- remain nullable because their original profile/queue cannot always be inferred.
ALTER TABLE app.review_log
  ADD COLUMN profile_id uuid REFERENCES app.study_profile(id) ON DELETE SET NULL,
  ADD COLUMN queue_kind_before text;

ALTER TABLE app.review_log
  ADD CONSTRAINT review_log_queue_kind_check
    CHECK (
      queue_kind_before IS NULL OR
      queue_kind_before IN ('new', 'intraday_learning', 'interday_learning', 'review')
    );

CREATE INDEX review_log_user_profile_time
  ON app.review_log (user_id, profile_id, reviewed_at DESC);

-- A partitioned review_log cannot own a unique key that omits its partition key.
-- Receipts provide a durable, user-scoped idempotency boundary and store the
-- exact response rather than reconstructing it from mutable srs_state later.
CREATE TABLE app.srs_review_receipt (
  user_id          bigint NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  client_review_id uuid NOT NULL,
  request_payload  jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  response_payload jsonb NOT NULL CHECK (jsonb_typeof(response_payload) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_review_id)
);

