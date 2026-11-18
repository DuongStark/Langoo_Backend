-- M11.5 — Shared Quiz Question Bank, user reports, and deduplicated pre-warm queue.
-- Apply only after owner approval for production; safe for local test DB reset/migration.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE app.quiz_question_bank (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sense_id bigint NOT NULL REFERENCES core.sense(id) ON DELETE RESTRICT,
  language_id smallint NOT NULL REFERENCES public.language(id),
  skill text NOT NULL CHECK (
    skill IN (
      'kanji_reading',
      'kanji_orthography',
      'context_cloze',
      'context_meaning',
      'usage',
      'paraphrase'
    )
  ),
  variant_no smallint NOT NULL CHECK (variant_no BETWEEN 1 AND 10),
  rubric_version text NOT NULL CHECK (btrim(rubric_version) <> ''),
  sentence_before text NOT NULL,
  target_surface text NOT NULL CHECK (btrim(target_surface) <> ''),
  sentence_after text NOT NULL,
  sentence_hash text NOT NULL CHECK (char_length(sentence_hash) = 64),
  canonical_answer text NOT NULL CHECK (btrim(canonical_answer) <> ''),
  fixed_distractors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fixed_distractors) = 'array'),
  pos_bucket text,
  excluded_words jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(excluded_words) = 'array'),
  origin text NOT NULL DEFAULT 'generated' CHECK (origin IN ('generated', 'dictionary')),
  verification text NOT NULL DEFAULT 'machine_reviewed' CHECK (verification IN ('machine_reviewed', 'human_reviewed')),
  generator_model text,
  validator_model text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quarantined', 'retired')),
  report_count integer NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  quarantined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sense_id, skill, rubric_version, variant_no)
);

CREATE INDEX quiz_question_bank_lookup_idx
  ON app.quiz_question_bank (language_id, sense_id, skill, variant_no)
  WHERE status = 'active';

CREATE INDEX quiz_question_bank_quarantined_idx
  ON app.quiz_question_bank (status, quarantined_at DESC)
  WHERE status = 'quarantined';

CREATE TABLE app.quiz_question_bank_report (
  id uuid PRIMARY KEY,
  bank_question_id bigint NOT NULL REFERENCES app.quiz_question_bank(id) ON DELETE CASCADE,
  user_id bigint REFERENCES app.users(id) ON DELETE SET NULL,
  reporter_hash text NOT NULL CHECK (char_length(reporter_hash) = 64),
  quiz_id uuid REFERENCES app.quiz(id) ON DELETE SET NULL,
  ordinal smallint,
  reason text NOT NULL CHECK (
    reason IN ('ambiguous', 'wrong_meaning', 'wrong_reading', 'unnatural', 'other')
  ),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  idempotency_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'confirmed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_question_id, reporter_hash)
);

CREATE UNIQUE INDEX quiz_bank_report_idempotency_idx
  ON app.quiz_question_bank_report (user_id, idempotency_key)
  WHERE user_id IS NOT NULL;

CREATE INDEX quiz_bank_report_user_idx
  ON app.quiz_question_bank_report (user_id, bank_question_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE app.quiz_bank_generation_job (
  sense_id bigint PRIMARY KEY REFERENCES core.sense(id) ON DELETE RESTRICT,
  language_id smallint NOT NULL REFERENCES public.language(id),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'done', 'failed', 'ineligible')
  ),
  priority smallint NOT NULL DEFAULT 10,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  replenish_cycles smallint NOT NULL DEFAULT 0 CHECK (replenish_cycles >= 0),
  lease_owner text,
  lease_until timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quiz_bank_gen_job_claim_idx
  ON app.quiz_bank_generation_job (status, priority ASC, next_run_at ASC)
  WHERE status IN ('queued', 'running');
