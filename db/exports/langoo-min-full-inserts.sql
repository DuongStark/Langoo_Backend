--
-- PostgreSQL database dump
--

-- Dumped from database version 16.2
-- Dumped by pg_dump version 16.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- Name: core; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA core;


--
-- Name: serve; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA serve;


--
-- Name: staging; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging;


--
-- Name: ensure_month_partition(date); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.ensure_month_partition(p_month date) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (v_start + interval '1 month')::date;
  v_name  text := 'review_log_' || to_char(v_start, 'YYYY_MM');
BEGIN
  IF to_regclass('app.' || v_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE app.%I PARTITION OF app.review_log FOR VALUES FROM (%L) TO (%L)',
      v_name, v_start, v_end);
  END IF;
  RETURN v_name;
END;
$$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: audit_concept_gloss(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.audit_concept_gloss() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO core.concept_gloss_history
      (concept_id, language_id, rank, event, old_data)
    VALUES (OLD.concept_id, OLD.language_id, OLD.rank, 'delete', to_jsonb(OLD));
    RETURN OLD;
  END IF;

  IF (to_jsonb(OLD) - 'batch_id') IS DISTINCT FROM
     (to_jsonb(NEW) - 'batch_id') THEN
    INSERT INTO core.concept_gloss_history
      (concept_id, language_id, rank, event, old_data, new_data)
    VALUES (OLD.concept_id, OLD.language_id, OLD.rank,
            'update', to_jsonb(OLD), to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: audit_sense_gloss(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.audit_sense_gloss() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO core.sense_gloss_history (gloss_id, event, old_data)
    VALUES (OLD.id, 'delete', to_jsonb(OLD));
    RETURN OLD;
  END IF;

  IF (to_jsonb(OLD) - 'batch_id') IS DISTINCT FROM
     (to_jsonb(NEW) - 'batch_id') THEN
    INSERT INTO core.sense_gloss_history (gloss_id, event, old_data, new_data)
    VALUES (OLD.id, 'update', to_jsonb(OLD), to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: achievement; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.achievement (
    code text NOT NULL,
    name_vi text NOT NULL,
    description text,
    icon text,
    category text NOT NULL,
    rule jsonb NOT NULL,
    xp_reward integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT achievement_category_check CHECK ((category = ANY (ARRAY['milestone'::text, 'streak'::text, 'quiz'::text, 'social'::text]))),
    CONSTRAINT achievement_rule_check CHECK ((jsonb_typeof(rule) = 'object'::text)),
    CONSTRAINT achievement_xp_reward_check CHECK ((xp_reward >= 0))
);


--
-- Name: ai_usage; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.ai_usage (
    user_id bigint NOT NULL,
    period date NOT NULL,
    feature text NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    tokens_in bigint DEFAULT 0 NOT NULL,
    tokens_out bigint DEFAULT 0 NOT NULL,
    cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
    CONSTRAINT ai_usage_cost_usd_check CHECK ((cost_usd >= (0)::numeric)),
    CONSTRAINT ai_usage_feature_check CHECK ((feature = ANY (ARRAY['chat'::text, 'quiz'::text, 'embedding'::text, 'other'::text]))),
    CONSTRAINT ai_usage_request_count_check CHECK ((request_count >= 0)),
    CONSTRAINT ai_usage_tokens_in_check CHECK ((tokens_in >= 0)),
    CONSTRAINT ai_usage_tokens_out_check CHECK ((tokens_out >= 0))
);


--
-- Name: chat_message; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.chat_message (
    id bigint NOT NULL,
    session_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    ref_sense_id bigint,
    tokens_in integer,
    tokens_out integer,
    cost_usd numeric(10,6),
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_message_content_check CHECK ((btrim(content) <> ''::text)),
    CONSTRAINT chat_message_content_json_check CHECK ((jsonb_typeof(content_json) = 'object'::text)),
    CONSTRAINT chat_message_cost_usd_check CHECK ((cost_usd >= (0)::numeric)),
    CONSTRAINT chat_message_role_check CHECK ((role = ANY (ARRAY['system'::text, 'user'::text, 'assistant'::text, 'tool'::text]))),
    CONSTRAINT chat_message_tokens_in_check CHECK ((tokens_in >= 0)),
    CONSTRAINT chat_message_tokens_out_check CHECK ((tokens_out >= 0))
);


--
-- Name: chat_message_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.chat_message ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.chat_message_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: chat_session; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.chat_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    profile_id uuid,
    language_id smallint NOT NULL,
    scenario text,
    title text,
    model text,
    prompt_version text,
    summary text,
    message_count integer DEFAULT 0 NOT NULL,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT chat_session_message_count_check CHECK ((message_count >= 0))
);


--
-- Name: collection; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.collection (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    owner_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    kind text DEFAULT 'personal'::text NOT NULL,
    cloned_from_deck_id bigint,
    cloned_from_collection_id uuid,
    is_public boolean DEFAULT false NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT collection_item_count_check CHECK ((item_count >= 0)),
    CONSTRAINT collection_kind_check CHECK ((kind = ANY (ARRAY['personal'::text, 'cloned'::text, 'shared'::text]))),
    CONSTRAINT collection_name_check CHECK ((btrim(name) <> ''::text))
);


--
-- Name: collection_item; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.collection_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    collection_id uuid NOT NULL,
    concept_id bigint,
    anchor_sense_id bigint NOT NULL,
    meaning_vi text NOT NULL,
    meaning_source text DEFAULT 'user'::text NOT NULL,
    note text,
    status text DEFAULT 'learning'::text NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    added_from_deck_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collection_item_meaning_source_check CHECK ((meaning_source = ANY (ARRAY['user'::text, 'source'::text, 'machine'::text, 'llm'::text]))),
    CONSTRAINT collection_item_meaning_vi_check CHECK ((btrim(meaning_vi) <> ''::text)),
    CONSTRAINT collection_item_position_check CHECK (("position" > 0)),
    CONSTRAINT collection_item_status_check CHECK ((status = ANY (ARRAY['learning'::text, 'paused'::text, 'known'::text])))
);


--
-- Name: collection_item_face; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.collection_item_face (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    sense_id bigint NOT NULL,
    language_id smallint NOT NULL,
    role text DEFAULT 'primary'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collection_item_face_role_check CHECK ((role = ANY (ARRAY['primary'::text, 'secondary'::text])))
);


--
-- Name: collection_item_tag; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.collection_item_tag (
    item_id uuid NOT NULL,
    tag_id bigint NOT NULL
);


--
-- Name: collection_share; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.collection_share (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    collection_id uuid NOT NULL,
    token text NOT NULL,
    permission text DEFAULT 'view'::text NOT NULL,
    created_by bigint NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collection_share_permission_check CHECK ((permission = ANY (ARRAY['view'::text, 'clone'::text]))),
    CONSTRAINT collection_share_token_check CHECK ((btrim(token) <> ''::text))
);


--
-- Name: device; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.device (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    platform text NOT NULL,
    push_provider text,
    push_token text,
    app_version text,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT device_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text]))),
    CONSTRAINT device_push_pair CHECK ((((push_provider IS NULL) AND (push_token IS NULL)) OR ((push_provider IS NOT NULL) AND (push_token IS NOT NULL)))),
    CONSTRAINT device_push_provider_check CHECK ((push_provider = ANY (ARRAY['fcm'::text, 'apns'::text, 'webpush'::text])))
);


--
-- Name: gloss_report; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.gloss_report (
    id bigint NOT NULL,
    user_id bigint,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    language_id smallint,
    issue text NOT NULL,
    comment text,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT gloss_report_issue_check CHECK ((issue = ANY (ARRAY['wrong'::text, 'missing'::text, 'offensive'::text, 'other'::text]))),
    CONSTRAINT gloss_report_resolved_pair CHECK (((status = ANY (ARRAY['fixed'::text, 'rejected'::text])) = (resolved_at IS NOT NULL))),
    CONSTRAINT gloss_report_status_check CHECK ((status = ANY (ARRAY['open'::text, 'triaged'::text, 'fixed'::text, 'rejected'::text]))),
    CONSTRAINT gloss_report_target_id_check CHECK ((btrim(target_id) <> ''::text)),
    CONSTRAINT gloss_report_target_kind_check CHECK ((target_kind = ANY (ARRAY['sense_gloss'::text, 'concept_gloss'::text, 'example'::text, 'translation'::text])))
);


--
-- Name: gloss_report_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.gloss_report ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.gloss_report_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: leaderboard_snapshot; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.leaderboard_snapshot (
    period_start date NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    user_id bigint NOT NULL,
    xp integer NOT NULL,
    rank integer NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leaderboard_snapshot_rank_check CHECK ((rank > 0))
);


--
-- Name: notification_log; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.notification_log (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    reminder_id uuid,
    channel text NOT NULL,
    title text,
    body text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    provider_message_id text,
    status text DEFAULT 'queued'::text NOT NULL,
    error text,
    idempotency_key text,
    sent_at timestamp with time zone,
    opened_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_log_channel_check CHECK ((channel = ANY (ARRAY['push'::text, 'email'::text]))),
    CONSTRAINT notification_log_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT notification_log_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'opened'::text, 'clicked'::text]))),
    CONSTRAINT notification_queued_has_no_sent_at CHECK (((sent_at IS NULL) OR (status <> 'queued'::text)))
);


--
-- Name: notification_log_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.notification_log ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.notification_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: quiz; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.quiz (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    profile_id uuid NOT NULL,
    collection_id uuid,
    quiz_type text NOT NULL,
    difficulty text NOT NULL,
    question_count smallint NOT NULL,
    generator jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'ready'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT quiz_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text]))),
    CONSTRAINT quiz_generator_check CHECK ((jsonb_typeof(generator) = 'object'::text)),
    CONSTRAINT quiz_question_count_check CHECK (((question_count >= 1) AND (question_count <= 50))),
    CONSTRAINT quiz_quiz_type_check CHECK ((quiz_type = ANY (ARRAY['multiple_choice'::text, 'fill_blank'::text, 'matching'::text, 'mixed'::text]))),
    CONSTRAINT quiz_status_check CHECK ((status = ANY (ARRAY['generating'::text, 'ready'::text, 'failed'::text, 'expired'::text])))
);


--
-- Name: quiz_question; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.quiz_question (
    id bigint NOT NULL,
    quiz_id uuid NOT NULL,
    ordinal smallint NOT NULL,
    question_type text NOT NULL,
    prompt text NOT NULL,
    options jsonb DEFAULT '[]'::jsonb NOT NULL,
    correct_answer jsonb NOT NULL,
    explanation text,
    language_id smallint,
    concept_id bigint,
    item_id uuid,
    CONSTRAINT quiz_question_options_check CHECK ((jsonb_typeof(options) = 'array'::text)),
    CONSTRAINT quiz_question_ordinal_check CHECK ((ordinal > 0)),
    CONSTRAINT quiz_question_prompt_check CHECK ((btrim(prompt) <> ''::text)),
    CONSTRAINT quiz_question_question_type_check CHECK ((question_type = ANY (ARRAY['multiple_choice'::text, 'fill_blank'::text, 'matching'::text])))
);


--
-- Name: quiz_question_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.quiz_question ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.quiz_question_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reminder; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.reminder (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    label text,
    time_of_day time without time zone NOT NULL,
    timezone text NOT NULL,
    weekdays smallint[] DEFAULT '{1,2,3,4,5,6,7}'::smallint[] NOT NULL,
    channels text[] DEFAULT '{push}'::text[] NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    smart_reminder boolean DEFAULT false NOT NULL,
    missed_days_threshold smallint DEFAULT 2 NOT NULL,
    next_fire_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reminder_channels_check CHECK ((channels <@ ARRAY['push'::text, 'email'::text])),
    CONSTRAINT reminder_missed_days_threshold_check CHECK (((missed_days_threshold >= 1) AND (missed_days_threshold <= 30))),
    CONSTRAINT reminder_weekdays_check CHECK ((weekdays <@ ARRAY[(1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint, (7)::smallint]))
);


--
-- Name: review_log; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
)
PARTITION BY RANGE (reviewed_at);


--
-- Name: review_log_2026_09; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2026_09 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2026_10; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2026_10 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2026_11; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2026_11 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2026_12; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2026_12 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_01; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_01 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_02; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_02 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_03; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_03 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_04; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_04 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_05; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_05 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_06; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_06 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_07; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_07 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_08; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_08 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_09; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_09 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_10; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_10 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_11; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_11 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2027_12; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2027_12 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_01; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_01 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_02; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_02 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_03; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_03 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_04; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_04 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_05; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_05 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_06; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_06 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_07; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_07 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_08; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_08 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_09; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_09 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_10; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_10 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_11; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_11 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2028_12; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2028_12 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2029_01; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2029_01 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2029_02; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2029_02 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2029_03; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2029_03 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2029_04; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2029_04 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2029_05; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2029_05 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2029_06; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2029_06 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2029_07; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2029_07 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_2029_08; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.review_log_2029_08 (
    id bigint NOT NULL,
    srs_id bigint,
    user_id bigint NOT NULL,
    face_id uuid NOT NULL,
    rating smallint NOT NULL,
    mode text DEFAULT 'flashcard'::text NOT NULL,
    elapsed_ms integer,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_log_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT review_log_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT review_log_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: review_log_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.review_log ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.review_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: search_history; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.search_history (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    raw_query text NOT NULL,
    normalized text,
    language_id smallint,
    matched_sense_id bigint,
    result_count integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT search_history_raw_query_check CHECK ((btrim(raw_query) <> ''::text)),
    CONSTRAINT search_history_result_count_check CHECK ((result_count >= 0))
);


--
-- Name: search_history_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.search_history ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.search_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: srs_state; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.srs_state (
    id bigint NOT NULL,
    face_id uuid NOT NULL,
    user_id bigint NOT NULL,
    profile_id uuid NOT NULL,
    direction text NOT NULL,
    state text DEFAULT 'new'::text NOT NULL,
    due_at timestamp with time zone DEFAULT now() NOT NULL,
    stability real,
    difficulty real,
    reps integer DEFAULT 0 NOT NULL,
    lapses integer DEFAULT 0 NOT NULL,
    scheduled_days integer,
    elapsed_days integer,
    last_review_at timestamp with time zone,
    suspended boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT srs_state_difficulty_check CHECK ((difficulty > (0)::double precision)),
    CONSTRAINT srs_state_direction_check CHECK ((direction = ANY (ARRAY['recognize'::text, 'recall'::text]))),
    CONSTRAINT srs_state_elapsed_days_check CHECK ((elapsed_days >= 0)),
    CONSTRAINT srs_state_lapses_check CHECK ((lapses >= 0)),
    CONSTRAINT srs_state_reps_check CHECK ((reps >= 0)),
    CONSTRAINT srs_state_scheduled_days_check CHECK ((scheduled_days >= 0)),
    CONSTRAINT srs_state_stability_check CHECK ((stability > (0)::double precision)),
    CONSTRAINT srs_state_state_check CHECK ((state = ANY (ARRAY['new'::text, 'learning'::text, 'review'::text, 'relearning'::text])))
);


--
-- Name: srs_state_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.srs_state ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.srs_state_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: streak_day; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.streak_day (
    user_id bigint NOT NULL,
    day date NOT NULL,
    review_count integer DEFAULT 0 NOT NULL,
    xp integer DEFAULT 0 NOT NULL,
    met_goal boolean DEFAULT false NOT NULL,
    CONSTRAINT streak_day_review_count_check CHECK ((review_count >= 0))
);


--
-- Name: study_profile; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.study_profile (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    name text NOT NULL,
    primary_language_id smallint NOT NULL,
    secondary_language_id smallint,
    support_language_id smallint NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT study_profile_languages_differ CHECK ((((secondary_language_id IS NULL) OR (secondary_language_id <> primary_language_id)) AND (support_language_id <> primary_language_id) AND ((secondary_language_id IS NULL) OR (support_language_id <> secondary_language_id)))),
    CONSTRAINT study_profile_name_check CHECK ((btrim(name) <> ''::text))
);


--
-- Name: study_session; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.study_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    profile_id uuid NOT NULL,
    kind text NOT NULL,
    mode text NOT NULL,
    collection_id uuid,
    quiz_id uuid,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    correct_count integer DEFAULT 0 NOT NULL,
    score integer,
    xp_awarded integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT study_session_correct_count_check CHECK ((correct_count >= 0)),
    CONSTRAINT study_session_correct_le_items CHECK ((correct_count <= item_count)),
    CONSTRAINT study_session_item_count_check CHECK ((item_count >= 0)),
    CONSTRAINT study_session_kind_check CHECK ((kind = ANY (ARRAY['review'::text, 'practice'::text, 'quiz'::text]))),
    CONSTRAINT study_session_mode_check CHECK ((mode = ANY (ARRAY['flashcard'::text, 'multiple_choice'::text, 'matching'::text, 'typing'::text, 'listening'::text]))),
    CONSTRAINT study_session_quiz_needs_quiz CHECK (((kind <> 'quiz'::text) OR (quiz_id IS NOT NULL))),
    CONSTRAINT study_session_score_check CHECK (((score >= 0) AND (score <= 100))),
    CONSTRAINT study_session_settings_check CHECK ((jsonb_typeof(settings) = 'object'::text)),
    CONSTRAINT study_session_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: study_session_item; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.study_session_item (
    id bigint NOT NULL,
    session_id uuid NOT NULL,
    ordinal smallint NOT NULL,
    srs_id bigint,
    face_id uuid,
    quiz_question_id bigint,
    prompt jsonb DEFAULT '{}'::jsonb NOT NULL,
    correct_answer jsonb,
    user_answer jsonb,
    is_correct boolean,
    rating smallint,
    elapsed_ms integer,
    answered_at timestamp with time zone,
    CONSTRAINT session_item_has_source CHECK (((srs_id IS NOT NULL) OR (quiz_question_id IS NOT NULL) OR (prompt <> '{}'::jsonb))),
    CONSTRAINT study_session_item_elapsed_ms_check CHECK ((elapsed_ms >= 0)),
    CONSTRAINT study_session_item_ordinal_check CHECK ((ordinal > 0)),
    CONSTRAINT study_session_item_prompt_check CHECK ((jsonb_typeof(prompt) = 'object'::text)),
    CONSTRAINT study_session_item_rating_check CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: study_session_item_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.study_session_item ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.study_session_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tag; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.tag (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    name text NOT NULL,
    color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_name_check CHECK ((btrim(name) <> ''::text))
);


--
-- Name: tag_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.tag ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.tag_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_achievement; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.user_achievement (
    user_id bigint NOT NULL,
    achievement_code text NOT NULL,
    progress numeric(10,2) DEFAULT 0 NOT NULL,
    unlocked_at timestamp with time zone,
    seen_at timestamp with time zone,
    CONSTRAINT user_achievement_progress_check CHECK ((progress >= (0)::numeric))
);


--
-- Name: user_identity; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.user_identity (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    provider text NOT NULL,
    provider_uid text NOT NULL,
    password_hash text,
    email_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_identity_password_shape CHECK ((((provider = 'password'::text) AND (password_hash IS NOT NULL)) OR ((provider <> 'password'::text) AND (password_hash IS NULL)))),
    CONSTRAINT user_identity_provider_check CHECK ((provider = ANY (ARRAY['password'::text, 'google'::text, 'apple'::text]))),
    CONSTRAINT user_identity_provider_uid_check CHECK ((btrim(provider_uid) <> ''::text))
);


--
-- Name: user_identity_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.user_identity ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.user_identity_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_session; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.user_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    device_id uuid,
    refresh_token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT user_session_refresh_token_hash_check CHECK ((btrim(refresh_token_hash) <> ''::text))
);


--
-- Name: user_settings; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.user_settings (
    user_id bigint NOT NULL,
    timezone text DEFAULT 'Asia/Ho_Chi_Minh'::text NOT NULL,
    ui_language_id smallint,
    daily_goal smallint DEFAULT 20 NOT NULL,
    notify jsonb DEFAULT '{}'::jsonb NOT NULL,
    active_profile_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_settings_daily_goal_check CHECK (((daily_goal >= 1) AND (daily_goal <= 500))),
    CONSTRAINT user_settings_notify_check CHECK ((jsonb_typeof(notify) = 'object'::text))
);


--
-- Name: user_stats; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.user_stats (
    user_id bigint NOT NULL,
    xp_total bigint DEFAULT 0 NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    streak_current integer DEFAULT 0 NOT NULL,
    streak_longest integer DEFAULT 0 NOT NULL,
    last_study_date date,
    items_learned integer DEFAULT 0 NOT NULL,
    reviews_total integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_stats_items_learned_check CHECK ((items_learned >= 0)),
    CONSTRAINT user_stats_level_check CHECK ((level > 0)),
    CONSTRAINT user_stats_reviews_total_check CHECK ((reviews_total >= 0)),
    CONSTRAINT user_stats_streak_current_check CHECK ((streak_current >= 0)),
    CONSTRAINT user_stats_streak_longest_check CHECK ((streak_longest >= 0)),
    CONSTRAINT user_stats_xp_total_check CHECK ((xp_total >= 0))
);


--
-- Name: users; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.users (
    id bigint NOT NULL,
    email text NOT NULL,
    display_name text,
    avatar_url text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT users_email_check CHECK ((btrim(email) <> ''::text)),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'locked'::text, 'deleted'::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.users ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: xp_event; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.xp_event (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    amount integer NOT NULL,
    source text NOT NULL,
    ref_kind text,
    ref_id text,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT xp_event_amount_check CHECK ((amount <> 0)),
    CONSTRAINT xp_event_source_check CHECK ((source = ANY (ARRAY['review'::text, 'quiz'::text, 'streak'::text, 'achievement'::text, 'correction'::text, 'manual'::text])))
);


--
-- Name: xp_event_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.xp_event ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME app.xp_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: xp_rule; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.xp_rule (
    code text NOT NULL,
    description text NOT NULL,
    amount integer NOT NULL,
    daily_cap integer,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT xp_rule_amount_check CHECK ((amount <> 0)),
    CONSTRAINT xp_rule_daily_cap_check CHECK (((daily_cap IS NULL) OR (daily_cap > 0)))
);


--
-- Name: concept; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.concept (
    id bigint NOT NULL,
    ili text,
    pos text,
    gloss_en text,
    gloss_vi text,
    cefr text,
    status text DEFAULT 'draft'::text NOT NULL,
    source_id integer,
    batch_id uuid,
    CONSTRAINT concept_ili_check CHECK (((ili IS NULL) OR (btrim(ili) <> ''::text))),
    CONSTRAINT concept_pos_check CHECK ((pos = ANY (ARRAY['noun'::text, 'verb'::text, 'adjective'::text, 'adverb'::text, 'pronoun'::text, 'determiner'::text, 'particle'::text, 'auxiliary'::text, 'conjunction'::text, 'interjection'::text, 'expression'::text, 'counter'::text, 'prefix'::text, 'suffix'::text, 'unknown'::text]))),
    CONSTRAINT concept_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'curated'::text, 'rejected'::text])))
);


--
-- Name: concept_gloss; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.concept_gloss (
    concept_id bigint NOT NULL,
    language_id smallint NOT NULL,
    rank smallint DEFAULT 1 NOT NULL,
    text text NOT NULL,
    is_machine boolean DEFAULT false NOT NULL,
    quality smallint,
    reviewed_by bigint,
    reviewed_at timestamp with time zone,
    source_id integer,
    batch_id uuid,
    CONSTRAINT concept_gloss_quality_check CHECK (((quality >= 0) AND (quality <= 100))),
    CONSTRAINT concept_gloss_rank_check CHECK ((rank > 0)),
    CONSTRAINT concept_gloss_review_pair CHECK (((reviewed_by IS NULL) = (reviewed_at IS NULL))),
    CONSTRAINT concept_gloss_text_check CHECK ((btrim(text) <> ''::text))
);


--
-- Name: concept_gloss_history; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.concept_gloss_history (
    id bigint NOT NULL,
    concept_id bigint NOT NULL,
    language_id smallint NOT NULL,
    rank smallint NOT NULL,
    event text NOT NULL,
    old_data jsonb NOT NULL,
    new_data jsonb,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT concept_gloss_history_event_check CHECK ((event = ANY (ARRAY['update'::text, 'delete'::text]))),
    CONSTRAINT concept_gloss_history_shape CHECK ((((event = 'update'::text) AND (new_data IS NOT NULL)) OR ((event = 'delete'::text) AND (new_data IS NULL))))
);


--
-- Name: concept_gloss_history_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.concept_gloss_history ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.concept_gloss_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: concept_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.concept ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.concept_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: concept_label; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.concept_label (
    id bigint NOT NULL,
    concept_id bigint NOT NULL,
    language_id smallint NOT NULL,
    rank smallint DEFAULT 1 NOT NULL,
    text text NOT NULL,
    label_kind text DEFAULT 'lemma'::text NOT NULL,
    is_machine boolean DEFAULT false NOT NULL,
    quality smallint,
    source_id integer,
    batch_id uuid,
    CONSTRAINT concept_label_label_kind_check CHECK ((label_kind = ANY (ARRAY['lemma'::text, 'synonym'::text, 'definition'::text, 'translation'::text]))),
    CONSTRAINT concept_label_quality_check CHECK (((quality >= 0) AND (quality <= 100))),
    CONSTRAINT concept_label_rank_check CHECK ((rank > 0)),
    CONSTRAINT concept_label_text_check CHECK ((btrim(text) <> ''::text))
);


--
-- Name: concept_label_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.concept_label ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.concept_label_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: deck; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.deck (
    id bigint NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text,
    language_id smallint NOT NULL,
    level_label text,
    is_published boolean DEFAULT false NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deck_item_count_check CHECK ((item_count >= 0)),
    CONSTRAINT deck_slug_check CHECK ((btrim(slug) <> ''::text)),
    CONSTRAINT deck_title_check CHECK ((btrim(title) <> ''::text))
);


--
-- Name: deck_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.deck ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.deck_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: deck_item; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.deck_item (
    deck_id bigint NOT NULL,
    anchor_sense_id bigint NOT NULL,
    concept_id bigint,
    "position" integer NOT NULL,
    CONSTRAINT deck_item_position_check CHECK (("position" > 0))
);


--
-- Name: example; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.example (
    id bigint NOT NULL,
    sense_id bigint,
    language_id smallint NOT NULL,
    text text NOT NULL,
    translation jsonb DEFAULT '{}'::jsonb NOT NULL,
    external_id text,
    difficulty smallint,
    source_id integer,
    batch_id uuid,
    CONSTRAINT example_difficulty_check CHECK ((difficulty >= 0)),
    CONSTRAINT example_external_id_check CHECK (((external_id IS NULL) OR (btrim(external_id) <> ''::text))),
    CONSTRAINT example_external_source CHECK (((external_id IS NULL) OR (source_id IS NOT NULL))),
    CONSTRAINT example_text_check CHECK ((btrim(text) <> ''::text)),
    CONSTRAINT example_translation_check CHECK ((jsonb_typeof(translation) = 'object'::text))
);


--
-- Name: example_annotation; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.example_annotation (
    id bigint NOT NULL,
    source_example_id bigint NOT NULL,
    canonical_example_id bigint,
    source_sentence_id bigint,
    match_text text,
    embedded_sentence text,
    embedded_translation text,
    match_status text DEFAULT 'pending'::text NOT NULL,
    match_reason text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    mapping_run_id bigint,
    source_id integer,
    batch_id uuid,
    CONSTRAINT example_annotation_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT example_annotation_match_status_check CHECK ((match_status = ANY (ARRAY['matched'::text, 'missing_snapshot'::text, 'text_mismatch'::text, 'pending'::text, 'rejected'::text]))),
    CONSTRAINT example_annotation_not_self CHECK (((canonical_example_id IS NULL) OR (canonical_example_id <> source_example_id)))
);


--
-- Name: example_annotation_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.example_annotation ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.example_annotation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: example_concept; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.example_concept (
    example_id bigint NOT NULL,
    concept_id bigint NOT NULL,
    confidence real,
    method text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    mapping_run_id bigint,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT example_concept_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT example_concept_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT example_concept_method_check CHECK ((btrim(method) <> ''::text))
);


--
-- Name: example_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.example ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.example_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: example_sense; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.example_sense (
    example_id bigint NOT NULL,
    sense_id bigint NOT NULL,
    relation text DEFAULT 'illustrates'::text NOT NULL,
    confidence real,
    method text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    mapping_run_id bigint,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT example_sense_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT example_sense_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT example_sense_method_check CHECK ((btrim(method) <> ''::text)),
    CONSTRAINT example_sense_relation_check CHECK ((relation = ANY (ARRAY['illustrates'::text, 'candidate'::text, 'rejected'::text])))
);


--
-- Name: example_translation; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.example_translation (
    example_id bigint NOT NULL,
    translation_id bigint NOT NULL,
    batch_id uuid NOT NULL,
    CONSTRAINT example_translation_check1 CHECK ((example_id <> translation_id))
);


--
-- Name: jlpt_link; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.jlpt_link (
    id bigint NOT NULL,
    source_level smallint NOT NULL,
    source_row_number integer NOT NULL,
    variant_index smallint DEFAULT 1 NOT NULL,
    expression text NOT NULL,
    reading text,
    lexeme_id bigint,
    status text DEFAULT 'unresolved'::text NOT NULL,
    match_method text,
    score real,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    mapping_run_id bigint,
    source_id integer NOT NULL,
    batch_id uuid NOT NULL,
    CONSTRAINT jlpt_link_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT jlpt_link_score_check CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision))),
    CONSTRAINT jlpt_link_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'ambiguous'::text, 'unmatched'::text, 'pattern'::text, 'unresolved'::text, 'rejected'::text]))),
    CONSTRAINT jlpt_link_variant_index_check CHECK ((variant_index > 0))
);


--
-- Name: jlpt_link_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.jlpt_link ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.jlpt_link_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: kanji; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.kanji (
    literal text NOT NULL,
    codepoint_ucs integer,
    grade smallint,
    stroke_count smallint,
    frequency_rank integer,
    jlpt_old smallint,
    radical_classical smallint,
    readings jsonb DEFAULT '{}'::jsonb NOT NULL,
    meanings jsonb DEFAULT '{}'::jsonb NOT NULL,
    nanori jsonb DEFAULT '[]'::jsonb NOT NULL,
    query_codes jsonb DEFAULT '{}'::jsonb NOT NULL,
    dict_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_id integer,
    batch_id uuid,
    jlpt_new smallint,
    jlpt_new_source_id integer,
    CONSTRAINT kanji_codepoint_ucs_check CHECK (((codepoint_ucs >= 0) AND (codepoint_ucs <= 1114111))),
    CONSTRAINT kanji_dict_refs_check CHECK ((jsonb_typeof(dict_refs) = 'array'::text)),
    CONSTRAINT kanji_frequency_rank_check CHECK ((frequency_rank > 0)),
    CONSTRAINT kanji_grade_check CHECK ((grade > 0)),
    CONSTRAINT kanji_jlpt_new_check CHECK (((jlpt_new >= 1) AND (jlpt_new <= 5))),
    CONSTRAINT kanji_jlpt_old_check CHECK (((jlpt_old >= 1) AND (jlpt_old <= 4))),
    CONSTRAINT kanji_literal_check CHECK ((char_length(literal) = 1)),
    CONSTRAINT kanji_meanings_check CHECK ((jsonb_typeof(meanings) = 'object'::text)),
    CONSTRAINT kanji_nanori_check CHECK ((jsonb_typeof(nanori) = 'array'::text)),
    CONSTRAINT kanji_query_codes_check CHECK ((jsonb_typeof(query_codes) = 'object'::text)),
    CONSTRAINT kanji_radical_classical_check CHECK (((radical_classical >= 1) AND (radical_classical <= 214))),
    CONSTRAINT kanji_readings_check CHECK ((jsonb_typeof(readings) = 'object'::text)),
    CONSTRAINT kanji_stroke_count_check CHECK ((stroke_count > 0))
);


--
-- Name: kanji_media; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.kanji_media (
    kanji_literal text NOT NULL,
    asset_id bigint NOT NULL,
    kind text NOT NULL,
    frame_count smallint,
    CONSTRAINT kanji_media_frame_count_check CHECK ((frame_count > 0)),
    CONSTRAINT kanji_media_kind_check CHECK ((kind = ANY (ARRAY['stroke_svg'::text, 'stroke_gif'::text])))
);


--
-- Name: kanji_radical; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.kanji_radical (
    kanji_literal text NOT NULL,
    part text NOT NULL,
    "position" smallint,
    source_id integer,
    batch_id uuid,
    CONSTRAINT kanji_radical_part_check CHECK ((btrim(part) <> ''::text)),
    CONSTRAINT kanji_radical_position_check CHECK (("position" > 0))
);


--
-- Name: COLUMN kanji_radical."position"; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.kanji_radical."position" IS 'Thứ tự trong KRADFILE; không phải thứ tự viết nét.';


--
-- Name: lexeme; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.lexeme (
    id bigint NOT NULL,
    language_id smallint NOT NULL,
    lemma text NOT NULL,
    pos text DEFAULT 'unknown'::text NOT NULL,
    reading text,
    romanization text,
    homograph_no smallint DEFAULT 1 NOT NULL,
    frequency_rank integer,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    external_id text,
    source_id integer,
    batch_id uuid,
    content_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lexeme_attributes_check CHECK ((jsonb_typeof(attributes) = 'object'::text)),
    CONSTRAINT lexeme_external_id_check CHECK (((external_id IS NULL) OR (btrim(external_id) <> ''::text))),
    CONSTRAINT lexeme_external_source CHECK (((external_id IS NULL) OR (source_id IS NOT NULL))),
    CONSTRAINT lexeme_frequency_rank_check CHECK ((frequency_rank > 0)),
    CONSTRAINT lexeme_homograph_no_check CHECK ((homograph_no > 0)),
    CONSTRAINT lexeme_lemma_check CHECK ((btrim(lemma) <> ''::text)),
    CONSTRAINT lexeme_pos_check CHECK ((pos = ANY (ARRAY['noun'::text, 'verb'::text, 'adjective'::text, 'adverb'::text, 'pronoun'::text, 'determiner'::text, 'particle'::text, 'auxiliary'::text, 'conjunction'::text, 'interjection'::text, 'expression'::text, 'counter'::text, 'prefix'::text, 'suffix'::text, 'unknown'::text])))
);


--
-- Name: lexeme_form; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.lexeme_form (
    id bigint NOT NULL,
    lexeme_id bigint NOT NULL,
    kind text NOT NULL,
    form_text text NOT NULL,
    form_order smallint NOT NULL,
    is_common boolean DEFAULT false NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_id integer,
    batch_id uuid,
    CONSTRAINT lexeme_form_attributes_check CHECK ((jsonb_typeof(attributes) = 'object'::text)),
    CONSTRAINT lexeme_form_form_order_check CHECK ((form_order > 0)),
    CONSTRAINT lexeme_form_form_text_check CHECK ((btrim(form_text) <> ''::text)),
    CONSTRAINT lexeme_form_kind_check CHECK ((kind = ANY (ARRAY['kanji'::text, 'kana'::text])))
);


--
-- Name: lexeme_form_applies_to; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.lexeme_form_applies_to (
    form_id bigint NOT NULL,
    target_form_id bigint NOT NULL,
    CONSTRAINT form_applies_to_different_kind CHECK ((form_id <> target_form_id))
);


--
-- Name: lexeme_form_char; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.lexeme_form_char (
    form_id bigint NOT NULL,
    char_position integer NOT NULL,
    literal text NOT NULL,
    codepoint_ucs integer NOT NULL,
    character_kind text NOT NULL,
    kanji_literal text,
    CONSTRAINT lexeme_form_char_char_position_check CHECK ((char_position > 0)),
    CONSTRAINT lexeme_form_char_character_kind_check CHECK ((character_kind = ANY (ARRAY['kanji'::text, 'kana'::text, 'latin'::text, 'digit'::text, 'punctuation'::text, 'symbol'::text, 'other'::text]))),
    CONSTRAINT lexeme_form_char_codepoint_ucs_check CHECK (((codepoint_ucs >= 0) AND (codepoint_ucs <= 1114111))),
    CONSTRAINT lexeme_form_char_literal_check CHECK ((char_length(literal) = 1))
);


--
-- Name: lexeme_form_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.lexeme_form ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.lexeme_form_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lexeme_form_kanji_char; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.lexeme_form_kanji_char (
    form_id bigint NOT NULL,
    char_position integer NOT NULL,
    kanji_literal text NOT NULL,
    CONSTRAINT kanji_char_is_single_codepoint CHECK ((char_length(kanji_literal) = 1)),
    CONSTRAINT lexeme_form_kanji_char_char_position_check CHECK ((char_position > 0))
);


--
-- Name: lexeme_form_tag; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.lexeme_form_tag (
    form_id bigint NOT NULL,
    tag_code text NOT NULL
);


--
-- Name: lexeme_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.lexeme ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.lexeme_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lexeme_level; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.lexeme_level (
    lexeme_id bigint NOT NULL,
    scheme text NOT NULL,
    level smallint NOT NULL,
    match_method text NOT NULL,
    source_id integer NOT NULL,
    batch_id uuid NOT NULL,
    CONSTRAINT lexeme_level_level_check CHECK (((level >= 1) AND (level <= 5))),
    CONSTRAINT lexeme_level_match_method_check CHECK ((match_method = ANY (ARRAY['form_reading'::text, 'lemma_reading'::text]))),
    CONSTRAINT lexeme_level_scheme_check CHECK ((scheme = 'JLPT'::text))
);


--
-- Name: mapping_run; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.mapping_run (
    id bigint NOT NULL,
    run_key text NOT NULL,
    task text NOT NULL,
    algorithm text NOT NULL,
    model text,
    prompt_version text,
    source_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    rows_seen bigint,
    rows_accepted bigint,
    rows_rejected bigint,
    rows_unresolved bigint,
    error text,
    CONSTRAINT mapping_run_algorithm_check CHECK ((btrim(algorithm) <> ''::text)),
    CONSTRAINT mapping_run_parameters_check CHECK ((jsonb_typeof(parameters) = 'object'::text)),
    CONSTRAINT mapping_run_source_snapshot_check CHECK ((jsonb_typeof(source_snapshot) = 'object'::text)),
    CONSTRAINT mapping_run_status_check CHECK ((status = ANY (ARRAY['running'::text, 'dry_run'::text, 'completed'::text, 'failed'::text, 'rolled_back'::text]))),
    CONSTRAINT mapping_run_task_check CHECK ((btrim(task) <> ''::text))
);


--
-- Name: mapping_run_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.mapping_run ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.mapping_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: media_asset; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.media_asset (
    id bigint NOT NULL,
    kind text NOT NULL,
    object_key text NOT NULL,
    mime text NOT NULL,
    bytes integer,
    sha256 text,
    provider text,
    source_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT media_asset_bytes_check CHECK ((bytes > 0)),
    CONSTRAINT media_asset_kind_check CHECK ((kind = ANY (ARRAY['stroke_svg'::text, 'stroke_gif'::text, 'audio_tts'::text]))),
    CONSTRAINT media_asset_object_key_check CHECK ((btrim(object_key) <> ''::text))
);


--
-- Name: media_asset_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.media_asset ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.media_asset_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pronunciation; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.pronunciation (
    id bigint NOT NULL,
    lexeme_id bigint NOT NULL,
    ipa text,
    audio_key text,
    dialect text,
    source_id integer,
    batch_id uuid,
    CONSTRAINT pronunciation_has_content CHECK ((((ipa IS NOT NULL) AND (btrim(ipa) <> ''::text)) OR ((audio_key IS NOT NULL) AND (btrim(audio_key) <> ''::text))))
);


--
-- Name: pronunciation_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.pronunciation ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.pronunciation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sense; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense (
    id bigint NOT NULL,
    lexeme_id bigint NOT NULL,
    sense_no smallint NOT NULL,
    definition text,
    register text,
    domain text,
    is_primary boolean DEFAULT false NOT NULL,
    external_id text,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_id integer,
    batch_id uuid,
    definition_language_id smallint,
    CONSTRAINT sense_attributes_check CHECK ((jsonb_typeof(attributes) = 'object'::text)),
    CONSTRAINT sense_external_id_check CHECK (((external_id IS NULL) OR (btrim(external_id) <> ''::text))),
    CONSTRAINT sense_external_source CHECK (((external_id IS NULL) OR (source_id IS NOT NULL))),
    CONSTRAINT sense_register_check CHECK ((register = ANY (ARRAY['formal'::text, 'colloquial'::text, 'archaic'::text, 'slang'::text]))),
    CONSTRAINT sense_sense_no_check CHECK ((sense_no > 0))
);


--
-- Name: COLUMN sense.definition_language_id; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.sense.definition_language_id IS 'Ngôn ngữ của definition cache; có thể khác ngôn ngữ của lexeme.';


--
-- Name: sense_concept; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense_concept (
    sense_id bigint NOT NULL,
    concept_id bigint NOT NULL,
    relation text DEFAULT 'exact'::text NOT NULL,
    confidence real DEFAULT 1.0 NOT NULL,
    method text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    source_id integer,
    batch_id uuid,
    mapping_run_id bigint,
    decided_at timestamp with time zone,
    CONSTRAINT sense_concept_confidence_check CHECK (((confidence >= (0.0)::double precision) AND (confidence <= (1.0)::double precision))),
    CONSTRAINT sense_concept_method_check CHECK ((btrim(method) <> ''::text)),
    CONSTRAINT sense_concept_relation_check CHECK ((relation = ANY (ARRAY['exact'::text, 'broader'::text, 'narrower'::text, 'related'::text])))
);


--
-- Name: sense_concept_candidate; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense_concept_candidate (
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    sense_id bigint NOT NULL,
    concept_id bigint NOT NULL,
    relation text DEFAULT 'exact'::text NOT NULL,
    score real,
    calibrated_score real,
    decision text DEFAULT 'pending'::text NOT NULL,
    method text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    llm_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    artifact_hash text,
    decided_at timestamp with time zone,
    CONSTRAINT sense_concept_candidate_calibrated_score_check CHECK (((calibrated_score >= (0)::double precision) AND (calibrated_score <= (1)::double precision))),
    CONSTRAINT sense_concept_candidate_decision_check CHECK ((decision = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'stale'::text, 'uncertain'::text]))),
    CONSTRAINT sense_concept_candidate_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT sense_concept_candidate_llm_result_check CHECK ((jsonb_typeof(llm_result) = 'object'::text)),
    CONSTRAINT sense_concept_candidate_method_check CHECK ((btrim(method) <> ''::text)),
    CONSTRAINT sense_concept_candidate_relation_check CHECK ((relation = ANY (ARRAY['exact'::text, 'broader'::text, 'narrower'::text, 'related'::text]))),
    CONSTRAINT sense_concept_candidate_score_check CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
);


--
-- Name: sense_concept_candidate_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.sense_concept_candidate ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.sense_concept_candidate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sense_concept_candidate_review; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense_concept_candidate_review (
    id bigint NOT NULL,
    candidate_id bigint NOT NULL,
    mapping_run_id bigint NOT NULL,
    reviewer_kind text NOT NULL,
    reviewer text NOT NULL,
    question_type text NOT NULL,
    prompt_version text,
    relation text,
    score real,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    artifact_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sense_concept_candidate_review_question_type_check CHECK ((btrim(question_type) <> ''::text)),
    CONSTRAINT sense_concept_candidate_review_relation_check CHECK (((relation IS NULL) OR (relation = ANY (ARRAY['exact'::text, 'broader'::text, 'narrower'::text, 'related'::text, 'none'::text, 'uncertain'::text])))),
    CONSTRAINT sense_concept_candidate_review_result_check CHECK ((jsonb_typeof(result) = 'object'::text)),
    CONSTRAINT sense_concept_candidate_review_reviewer_check CHECK ((btrim(reviewer) <> ''::text)),
    CONSTRAINT sense_concept_candidate_review_reviewer_kind_check CHECK ((reviewer_kind = ANY (ARRAY['llm'::text, 'human'::text, 'rule'::text]))),
    CONSTRAINT sense_concept_candidate_review_score_check CHECK (((score IS NULL) OR ((score >= (0)::double precision) AND (score <= (1)::double precision))))
);


--
-- Name: TABLE sense_concept_candidate_review; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.sense_concept_candidate_review IS 'Các lượt LLM/người/quy tắc đánh giá candidate; không thay thế quyết định cuối ở candidate.';


--
-- Name: sense_concept_candidate_review_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.sense_concept_candidate_review ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.sense_concept_candidate_review_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sense_form; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense_form (
    sense_id bigint NOT NULL,
    form_id bigint NOT NULL
);


--
-- Name: sense_gloss; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense_gloss (
    id bigint NOT NULL,
    sense_id bigint NOT NULL,
    language_id smallint NOT NULL,
    text text NOT NULL,
    detail text,
    is_machine boolean DEFAULT false NOT NULL,
    reviewed_by bigint,
    reviewed_at timestamp with time zone,
    quality smallint,
    rank smallint DEFAULT 1 NOT NULL,
    source_id integer,
    batch_id uuid,
    CONSTRAINT sense_gloss_quality_check CHECK (((quality >= 0) AND (quality <= 100))),
    CONSTRAINT sense_gloss_rank_check CHECK ((rank > 0)),
    CONSTRAINT sense_gloss_review_pair CHECK (((reviewed_by IS NULL) = (reviewed_at IS NULL))),
    CONSTRAINT sense_gloss_text_check CHECK ((btrim(text) <> ''::text))
);


--
-- Name: sense_gloss_history; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense_gloss_history (
    id bigint NOT NULL,
    gloss_id bigint NOT NULL,
    event text NOT NULL,
    old_data jsonb NOT NULL,
    new_data jsonb,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sense_gloss_history_event_check CHECK ((event = ANY (ARRAY['update'::text, 'delete'::text]))),
    CONSTRAINT sense_gloss_history_shape CHECK ((((event = 'update'::text) AND (new_data IS NOT NULL)) OR ((event = 'delete'::text) AND (new_data IS NULL))))
);


--
-- Name: sense_gloss_history_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.sense_gloss_history ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.sense_gloss_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sense_gloss_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.sense_gloss ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.sense_gloss_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sense_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.sense ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.sense_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sense_relation; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense_relation (
    source_sense_id bigint NOT NULL,
    target_sense_id bigint NOT NULL,
    relation text NOT NULL,
    confidence real,
    method text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    mapping_run_id bigint,
    source_id integer,
    batch_id uuid,
    CONSTRAINT sense_relation_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT sense_relation_relation_check CHECK ((relation = ANY (ARRAY['equivalent'::text, 'related'::text, 'antonym'::text, 'broader'::text, 'narrower'::text])))
);


--
-- Name: sense_relation_candidate; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense_relation_candidate (
    id bigint NOT NULL,
    source_sense_id bigint NOT NULL,
    target_sense_id bigint,
    target_lexeme_text text,
    target_reading text,
    relation text NOT NULL,
    source_key text NOT NULL,
    decision text DEFAULT 'pending'::text NOT NULL,
    score real,
    method text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    mapping_run_id bigint,
    CONSTRAINT sense_relation_candidate_decision_check CHECK ((decision = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'uncertain'::text]))),
    CONSTRAINT sense_relation_candidate_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT sense_relation_candidate_relation_check CHECK ((relation = ANY (ARRAY['equivalent'::text, 'related'::text, 'antonym'::text, 'broader'::text, 'narrower'::text]))),
    CONSTRAINT sense_relation_candidate_score_check CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
);


--
-- Name: sense_relation_candidate_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.sense_relation_candidate ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.sense_relation_candidate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sense_tag; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sense_tag (
    sense_id bigint NOT NULL,
    tag_code text NOT NULL
);


--
-- Name: source_entry_identity; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.source_entry_identity (
    id bigint NOT NULL,
    source_id integer NOT NULL,
    source_snapshot text NOT NULL,
    source_external_id text NOT NULL,
    logical_key text NOT NULL,
    content_hash text,
    staging_row_id bigint,
    lexeme_id bigint,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT source_entry_identity_status_check CHECK ((status = ANY (ARRAY['active'::text, 'changed'::text, 'removed'::text, 'ambiguous'::text, 'unresolved'::text])))
);


--
-- Name: TABLE source_entry_identity; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.source_entry_identity IS 'Crosswalk gọn giữa khóa nguồn của snapshot và core.lexeme; metadata chi tiết ở staging.';


--
-- Name: source_entry_identity_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.source_entry_identity ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.source_entry_identity_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: source_form; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.source_form (
    id bigint NOT NULL,
    lexeme_id bigint NOT NULL,
    form_text text NOT NULL,
    form_kind text DEFAULT 'source'::text NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_ordinal smallint NOT NULL,
    source_id integer,
    batch_id uuid,
    CONSTRAINT source_form_attributes_check CHECK ((jsonb_typeof(attributes) = 'object'::text)),
    CONSTRAINT source_form_form_kind_check CHECK ((btrim(form_kind) <> ''::text)),
    CONSTRAINT source_form_form_text_check CHECK ((btrim(form_text) <> ''::text)),
    CONSTRAINT source_form_source_ordinal_check CHECK ((source_ordinal > 0)),
    CONSTRAINT source_form_tags_check CHECK ((jsonb_typeof(tags) = 'array'::text))
);


--
-- Name: source_form_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.source_form ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.source_form_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: translation_assertion; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.translation_assertion (
    id bigint NOT NULL,
    source_lexeme_id bigint NOT NULL,
    source_sense_id bigint,
    target_language_id smallint NOT NULL,
    target_text text NOT NULL,
    romanization text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    sense_hint text,
    scope text NOT NULL,
    source_ordinal smallint NOT NULL,
    source_key text NOT NULL,
    source_id integer,
    batch_id uuid,
    mapping_run_id bigint,
    CONSTRAINT translation_assertion_scope_check CHECK ((scope = ANY (ARRAY['entry'::text, 'sense'::text]))),
    CONSTRAINT translation_assertion_source_ordinal_check CHECK ((source_ordinal > 0)),
    CONSTRAINT translation_assertion_tags_check CHECK ((jsonb_typeof(tags) = 'array'::text)),
    CONSTRAINT translation_assertion_target_text_check CHECK ((btrim(target_text) <> ''::text))
);


--
-- Name: translation_assertion_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.translation_assertion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.translation_assertion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: translation_target_candidate; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.translation_target_candidate (
    id bigint NOT NULL,
    assertion_id bigint NOT NULL,
    target_lexeme_id bigint,
    target_sense_id bigint,
    score real,
    match_method text NOT NULL,
    decision text DEFAULT 'pending'::text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    mapping_run_id bigint,
    CONSTRAINT translation_target_candidate_decision_check CHECK ((decision = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'uncertain'::text]))),
    CONSTRAINT translation_target_candidate_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT translation_target_candidate_score_check CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
);


--
-- Name: translation_target_candidate_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.translation_target_candidate ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.translation_target_candidate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: wordnet_relation; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.wordnet_relation (
    lexicon text NOT NULL,
    source_synset_id text NOT NULL,
    target_synset_id text NOT NULL,
    rel_type text NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: wordnet_synset; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.wordnet_synset (
    lexicon text NOT NULL,
    synset_id text NOT NULL,
    concept_id bigint NOT NULL,
    source_id integer NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: language; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.language (
    id smallint NOT NULL,
    code text NOT NULL,
    name_vi text NOT NULL,
    script text,
    is_target boolean DEFAULT true NOT NULL,
    is_support boolean DEFAULT false NOT NULL
);


--
-- Name: radical; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.radical (
    number smallint NOT NULL,
    "character" text NOT NULL,
    name_en text,
    name_vi text,
    meaning_vi text,
    stroke_count smallint,
    variants text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT radical_character_check CHECK ((char_length("character") = 1)),
    CONSTRAINT radical_number_check CHECK (((number >= 1) AND (number <= 214))),
    CONSTRAINT radical_stroke_count_check CHECK ((stroke_count > 0))
);


--
-- Name: COLUMN radical.variants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.radical.variants IS 'Biến thể đồ họa của bộ (ví dụ 心 → 忄, 㣺) để join với kanji_radical.part.';


--
-- Name: schema_migration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migration (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: source; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source (
    id integer NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    license text NOT NULL,
    attribution text NOT NULL,
    url text,
    version text,
    sha256 text,
    imported_at timestamp with time zone
);


--
-- Name: tag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag (
    code text NOT NULL,
    kind text NOT NULL,
    label text NOT NULL,
    pos_norm text,
    domain_vi text,
    CONSTRAINT tag_kind_check CHECK ((kind = ANY (ARRAY['pos'::text, 'misc'::text, 'field'::text, 'dialect'::text, 'kanji'::text, 'kana'::text]))),
    CONSTRAINT tag_pos_norm_valid CHECK ((((kind = 'pos'::text) AND (pos_norm IS NOT NULL) AND (pos_norm = ANY (ARRAY['noun'::text, 'verb'::text, 'adjective'::text, 'adverb'::text, 'pronoun'::text, 'determiner'::text, 'particle'::text, 'auxiliary'::text, 'conjunction'::text, 'interjection'::text, 'expression'::text, 'counter'::text, 'prefix'::text, 'suffix'::text, 'unknown'::text]))) OR ((kind <> 'pos'::text) AND (pos_norm IS NULL))))
);


--
-- Name: dictionary_search; Type: VIEW; Schema: serve; Owner: -
--

CREATE VIEW serve.dictionary_search AS
 SELECT x.id AS lexeme_id,
    x.language_id,
    l.code AS lang_code,
    x.lemma AS surface,
    x.reading,
    x.pos,
    x.frequency_rank,
    x.homograph_no,
    'lemma'::text AS surface_kind
   FROM (core.lexeme x
     JOIN public.language l ON ((l.id = x.language_id)))
UNION ALL
 SELECT x.id AS lexeme_id,
    x.language_id,
    l.code AS lang_code,
    f.form_text AS surface,
    x.reading,
    x.pos,
    x.frequency_rank,
    x.homograph_no,
    f.kind AS surface_kind
   FROM ((core.lexeme_form f
     JOIN core.lexeme x ON ((x.id = f.lexeme_id)))
     JOIN public.language l ON ((l.id = x.language_id)));


--
-- Name: kanji_card; Type: VIEW; Schema: serve; Owner: -
--

CREATE VIEW serve.kanji_card AS
 SELECT k.literal,
    k.codepoint_ucs,
    k.grade,
    k.stroke_count,
    k.frequency_rank,
    k.jlpt_old,
    k.jlpt_new,
    k.radical_classical,
    r."character" AS radical_char,
    r.name_vi AS radical_name_vi,
    r.meaning_vi AS radical_meaning_vi,
    k.readings,
    k.meanings,
    k.nanori,
    k.query_codes,
    ( SELECT count(*) AS count
           FROM core.lexeme_form_kanji_char fc
          WHERE (fc.kanji_literal = k.literal)) AS used_in_forms,
    ( SELECT array_agg(m.kind ORDER BY m.kind) AS array_agg
           FROM core.kanji_media m
          WHERE (m.kanji_literal = k.literal)) AS media_kinds
   FROM (core.kanji k
     LEFT JOIN public.radical r ON ((r.number = k.radical_classical)));


--
-- Name: sense_card; Type: VIEW; Schema: serve; Owner: -
--

CREATE VIEW serve.sense_card AS
 SELECT se.id AS sense_id,
    se.lexeme_id,
    x.language_id,
    x.lemma,
    x.reading,
    x.romanization,
    x.pos,
    x.frequency_rank,
    x.homograph_no,
    se.sense_no,
    se.definition,
    se.definition_language_id,
    se.register,
    se.domain,
    se.is_primary,
    vi.text AS gloss_vi,
    vi.is_machine AS gloss_vi_machine,
    (vi.reviewed_by IS NOT NULL) AS gloss_vi_reviewed,
    en.text AS gloss_en,
    sc.concept_id
   FROM ((((core.sense se
     JOIN core.lexeme x ON ((x.id = se.lexeme_id)))
     LEFT JOIN LATERAL ( SELECT g.text,
            g.is_machine,
            g.reviewed_by
           FROM (core.sense_gloss g
             JOIN public.language lg ON ((lg.id = g.language_id)))
          WHERE ((g.sense_id = se.id) AND (lg.code = 'vi'::text))
          ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
         LIMIT 1) vi ON (true))
     LEFT JOIN LATERAL ( SELECT g.text
           FROM (core.sense_gloss g
             JOIN public.language lg ON ((lg.id = g.language_id)))
          WHERE ((g.sense_id = se.id) AND (lg.code = 'en'::text))
          ORDER BY (g.reviewed_by IS NOT NULL) DESC, g.is_machine, g.rank
         LIMIT 1) en ON (true))
     LEFT JOIN LATERAL ( SELECT sc_1.concept_id
           FROM (core.sense_concept sc_1
             JOIN core.concept c ON ((c.id = sc_1.concept_id)))
          WHERE (sc_1.sense_id = se.id)
          ORDER BY (c.status = 'curated'::text) DESC, sc_1.confidence DESC
         LIMIT 1) sc ON (true));


--
-- Name: sense_pair; Type: MATERIALIZED VIEW; Schema: serve; Owner: -
--

CREATE MATERIALIZED VIEW serve.sense_pair AS
 SELECT sa.id AS sense_a,
    la.language_id AS lang_a,
    sb.id AS sense_b,
    lb.language_id AS lang_b,
    ca.concept_id,
    LEAST(ca.confidence, cb.confidence) AS confidence
   FROM ((((((core.sense_concept ca
     JOIN core.sense_concept cb ON (((cb.concept_id = ca.concept_id) AND (cb.sense_id <> ca.sense_id))))
     JOIN core.concept c ON (((c.id = ca.concept_id) AND (c.status = 'curated'::text))))
     JOIN core.sense sa ON ((sa.id = ca.sense_id)))
     JOIN core.sense sb ON ((sb.id = cb.sense_id)))
     JOIN core.lexeme la ON ((la.id = sa.lexeme_id)))
     JOIN core.lexeme lb ON ((lb.id = sb.lexeme_id)))
  WHERE ((la.language_id <> lb.language_id) AND (LEAST(ca.confidence, cb.confidence) >= (0.7)::double precision))
  WITH NO DATA;


--
-- Name: ili_map_pwn30; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ili_map_pwn30 (
    ili text NOT NULL,
    pwn30_offset text NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: import_batch; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.import_batch (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_code text NOT NULL,
    file_name text NOT NULL,
    sha256 text NOT NULL,
    row_count integer,
    started_at timestamp with time zone DEFAULT now(),
    finished_at timestamp with time zone,
    status text DEFAULT 'running'::text,
    error text
);


--
-- Name: jlpt_entry; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.jlpt_entry (
    level smallint NOT NULL,
    expression text NOT NULL,
    reading text,
    meaning text,
    tags text,
    row_number integer NOT NULL,
    batch_id uuid NOT NULL,
    CONSTRAINT jlpt_entry_level_check CHECK (((level >= 1) AND (level <= 5)))
);


--
-- Name: jmdict_entry; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.jmdict_entry (
    ent_seq bigint NOT NULL,
    payload jsonb NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: kanji_data_entry; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.kanji_data_entry (
    literal text NOT NULL,
    payload jsonb NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: kanji_entry; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.kanji_entry (
    literal text NOT NULL,
    payload jsonb NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: krad_entry; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.krad_entry (
    literal text NOT NULL,
    parts jsonb NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: omw_wikt_vi; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.omw_wikt_vi (
    pwn30_offset text NOT NULL,
    lemma text NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: tatoeba_link; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.tatoeba_link (
    sentence_id bigint NOT NULL,
    translation_id bigint NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: tatoeba_sentence; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.tatoeba_sentence (
    id bigint NOT NULL,
    lang text NOT NULL,
    text text NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: wikt_entry; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.wikt_entry (
    id bigint NOT NULL,
    lang_code text NOT NULL,
    word text NOT NULL,
    pos text,
    payload jsonb NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: wikt_entry_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.wikt_entry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wikt_entry_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.wikt_entry_id_seq OWNED BY staging.wikt_entry.id;


--
-- Name: wn_example; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.wn_example (
    lexicon text NOT NULL,
    synset_id text NOT NULL,
    example text NOT NULL,
    language text,
    batch_id uuid NOT NULL
);


--
-- Name: wn_relation; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.wn_relation (
    lexicon text NOT NULL,
    source_id text NOT NULL,
    target_id text NOT NULL,
    rel_type text NOT NULL,
    batch_id uuid NOT NULL
);


--
-- Name: wn_synset; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.wn_synset (
    lexicon text NOT NULL,
    synset_id text NOT NULL,
    ili text,
    pos text,
    lexfile text,
    definition jsonb DEFAULT '[]'::jsonb,
    members jsonb DEFAULT '[]'::jsonb,
    batch_id uuid NOT NULL
);


--
-- Name: review_log_2026_09; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2026_09 FOR VALUES FROM ('2026-09-01 00:00:00+07') TO ('2026-10-01 00:00:00+07');


--
-- Name: review_log_2026_10; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2026_10 FOR VALUES FROM ('2026-10-01 00:00:00+07') TO ('2026-11-01 00:00:00+07');


--
-- Name: review_log_2026_11; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2026_11 FOR VALUES FROM ('2026-11-01 00:00:00+07') TO ('2026-12-01 00:00:00+07');


--
-- Name: review_log_2026_12; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2026_12 FOR VALUES FROM ('2026-12-01 00:00:00+07') TO ('2027-01-01 00:00:00+07');


--
-- Name: review_log_2027_01; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_01 FOR VALUES FROM ('2027-01-01 00:00:00+07') TO ('2027-02-01 00:00:00+07');


--
-- Name: review_log_2027_02; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_02 FOR VALUES FROM ('2027-02-01 00:00:00+07') TO ('2027-03-01 00:00:00+07');


--
-- Name: review_log_2027_03; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_03 FOR VALUES FROM ('2027-03-01 00:00:00+07') TO ('2027-04-01 00:00:00+07');


--
-- Name: review_log_2027_04; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_04 FOR VALUES FROM ('2027-04-01 00:00:00+07') TO ('2027-05-01 00:00:00+07');


--
-- Name: review_log_2027_05; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_05 FOR VALUES FROM ('2027-05-01 00:00:00+07') TO ('2027-06-01 00:00:00+07');


--
-- Name: review_log_2027_06; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_06 FOR VALUES FROM ('2027-06-01 00:00:00+07') TO ('2027-07-01 00:00:00+07');


--
-- Name: review_log_2027_07; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_07 FOR VALUES FROM ('2027-07-01 00:00:00+07') TO ('2027-08-01 00:00:00+07');


--
-- Name: review_log_2027_08; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_08 FOR VALUES FROM ('2027-08-01 00:00:00+07') TO ('2027-09-01 00:00:00+07');


--
-- Name: review_log_2027_09; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_09 FOR VALUES FROM ('2027-09-01 00:00:00+07') TO ('2027-10-01 00:00:00+07');


--
-- Name: review_log_2027_10; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_10 FOR VALUES FROM ('2027-10-01 00:00:00+07') TO ('2027-11-01 00:00:00+07');


--
-- Name: review_log_2027_11; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_11 FOR VALUES FROM ('2027-11-01 00:00:00+07') TO ('2027-12-01 00:00:00+07');


--
-- Name: review_log_2027_12; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2027_12 FOR VALUES FROM ('2027-12-01 00:00:00+07') TO ('2028-01-01 00:00:00+07');


--
-- Name: review_log_2028_01; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_01 FOR VALUES FROM ('2028-01-01 00:00:00+07') TO ('2028-02-01 00:00:00+07');


--
-- Name: review_log_2028_02; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_02 FOR VALUES FROM ('2028-02-01 00:00:00+07') TO ('2028-03-01 00:00:00+07');


--
-- Name: review_log_2028_03; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_03 FOR VALUES FROM ('2028-03-01 00:00:00+07') TO ('2028-04-01 00:00:00+07');


--
-- Name: review_log_2028_04; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_04 FOR VALUES FROM ('2028-04-01 00:00:00+07') TO ('2028-05-01 00:00:00+07');


--
-- Name: review_log_2028_05; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_05 FOR VALUES FROM ('2028-05-01 00:00:00+07') TO ('2028-06-01 00:00:00+07');


--
-- Name: review_log_2028_06; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_06 FOR VALUES FROM ('2028-06-01 00:00:00+07') TO ('2028-07-01 00:00:00+07');


--
-- Name: review_log_2028_07; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_07 FOR VALUES FROM ('2028-07-01 00:00:00+07') TO ('2028-08-01 00:00:00+07');


--
-- Name: review_log_2028_08; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_08 FOR VALUES FROM ('2028-08-01 00:00:00+07') TO ('2028-09-01 00:00:00+07');


--
-- Name: review_log_2028_09; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_09 FOR VALUES FROM ('2028-09-01 00:00:00+07') TO ('2028-10-01 00:00:00+07');


--
-- Name: review_log_2028_10; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_10 FOR VALUES FROM ('2028-10-01 00:00:00+07') TO ('2028-11-01 00:00:00+07');


--
-- Name: review_log_2028_11; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_11 FOR VALUES FROM ('2028-11-01 00:00:00+07') TO ('2028-12-01 00:00:00+07');


--
-- Name: review_log_2028_12; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2028_12 FOR VALUES FROM ('2028-12-01 00:00:00+07') TO ('2029-01-01 00:00:00+07');


--
-- Name: review_log_2029_01; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2029_01 FOR VALUES FROM ('2029-01-01 00:00:00+07') TO ('2029-02-01 00:00:00+07');


--
-- Name: review_log_2029_02; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2029_02 FOR VALUES FROM ('2029-02-01 00:00:00+07') TO ('2029-03-01 00:00:00+07');


--
-- Name: review_log_2029_03; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2029_03 FOR VALUES FROM ('2029-03-01 00:00:00+07') TO ('2029-04-01 00:00:00+07');


--
-- Name: review_log_2029_04; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2029_04 FOR VALUES FROM ('2029-04-01 00:00:00+07') TO ('2029-05-01 00:00:00+07');


--
-- Name: review_log_2029_05; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2029_05 FOR VALUES FROM ('2029-05-01 00:00:00+07') TO ('2029-06-01 00:00:00+07');


--
-- Name: review_log_2029_06; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2029_06 FOR VALUES FROM ('2029-06-01 00:00:00+07') TO ('2029-07-01 00:00:00+07');


--
-- Name: review_log_2029_07; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2029_07 FOR VALUES FROM ('2029-07-01 00:00:00+07') TO ('2029-08-01 00:00:00+07');


--
-- Name: review_log_2029_08; Type: TABLE ATTACH; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log ATTACH PARTITION app.review_log_2029_08 FOR VALUES FROM ('2029-08-01 00:00:00+07') TO ('2029-09-01 00:00:00+07');


--
-- Name: wikt_entry id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.wikt_entry ALTER COLUMN id SET DEFAULT nextval('staging.wikt_entry_id_seq'::regclass);


--
-- Data for Name: achievement; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.achievement VALUES ('words_100', 'Học 100 từ', 'Học tới 100 từ vựng', '🏅', 'milestone', '{"gte": 100, "metric": "items_learned"}', 50, true);
INSERT INTO app.achievement VALUES ('reviews_1000', 'Bền bỉ 1000 lượt', 'Hoàn thành 1000 lượt ôn', '💪', 'milestone', '{"gte": 1000, "metric": "reviews_total"}', 80, true);
INSERT INTO app.achievement VALUES ('streak_7', 'Chuỗi 7 ngày', 'Học 7 ngày liên tiếp', '🔥', 'streak', '{"gte": 7, "metric": "streak_current"}', 30, true);
INSERT INTO app.achievement VALUES ('streak_30', 'Chuỗi 30 ngày', 'Học 30 ngày liên tiếp', '🔥', 'streak', '{"gte": 30, "metric": "streak_current"}', 200, true);
INSERT INTO app.achievement VALUES ('quiz_100', '100 câu đúng', 'Trả lời đúng 100 câu quiz', '🎯', 'quiz', '{"gte": 100, "metric": "quiz_correct"}', 100, true);


--
-- Data for Name: ai_usage; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.ai_usage VALUES (4, '2026-09-26', 'chat', 4, 11, 22, 0.000026);


--
-- Data for Name: chat_message; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.chat_message VALUES (1, '01a0dc8a-71cf-7f93-a846-e75ee25ede44', 'user', '注文をお願いします。', '{}', NULL, 6, 0, 0.000002, 'demo-model', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.chat_message VALUES (2, '01a0dc8a-71cf-7f93-a846-e75ee25ede44', 'assistant', 'はい、ご注文をどうぞ。何になさいますか？', '{}', NULL, 0, 12, 0.000012, 'demo-model', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.chat_message VALUES (3, '01a0dc8a-71cf-7f93-a846-e75ee25ede44', 'user', 'ラーメンをお願いします。', '{}', NULL, 5, 0, 0.000002, 'demo-model', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.chat_message VALUES (4, '01a0dc8a-71cf-7f93-a846-e75ee25ede44', 'assistant', 'ラーメンですね。少々お待ちください。', '{}', NULL, 0, 10, 0.000010, 'demo-model', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: chat_session; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.chat_session VALUES ('01a0dc8a-71cf-7f93-a846-e75ee25ede44', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 2, 'restaurant', 'Luyện hội thoại nhà hàng', 'demo-model', NULL, NULL, 4, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07', NULL);


--
-- Data for Name: collection; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.collection VALUES ('01a0dc8a-718f-7acd-a588-2cf077898399', '01a0dc8a-718a-7acf-bd0c-90114c061f04', 4, 'JLPT N5 — bộ mẫu', 'Dữ liệu demo lấy từ core', 'personal', NULL, NULL, false, 11, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07', NULL);


--
-- Data for Name: collection_item; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.collection_item VALUES ('01a0dc8a-7191-7e18-93b0-32e8378986fe', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 1, 'to run', 'source', NULL, 'learning', 1, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-7197-7f76-92c3-d759a6a4e110', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 5, 'to eat', 'source', NULL, 'learning', 2, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-7199-7161-8e40-c23bc389953d', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 7, 'to go', 'source', NULL, 'learning', 3, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-719a-7350-8df1-60ed71873a00', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 9, 'water', 'source', NULL, 'learning', 4, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-719b-70a2-a85a-afff115acb2f', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 11, 'day; sun', 'source', NULL, 'learning', 5, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-719b-77a7-b011-ef4664c92e21', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 13, 'book', 'source', NULL, 'learning', 6, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-719c-7e32-b722-ec3e3d9d2ecd', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 15, 'student', 'source', NULL, 'learning', 7, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-719d-7aa6-bd37-5b4df23df4a8', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 17, 'school', 'source', NULL, 'learning', 8, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-719d-7b45-92cc-b08147529e15', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 19, 'teacher', 'source', NULL, 'learning', 9, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-719e-7ed1-8a7c-97b3a888b354', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 21, 'big; large', 'source', NULL, 'learning', 10, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item VALUES ('01a0dc8a-719e-702b-8f4f-9fa56d414598', '01a0dc8a-718f-7acd-a588-2cf077898399', NULL, 25, 'study', 'source', NULL, 'learning', 11, NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: collection_item_face; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.collection_item_face VALUES ('01a0dc8a-7191-70cc-9856-670bfbaa0b76', '01a0dc8a-7191-7e18-93b0-32e8378986fe', 1, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-7197-777d-b5fb-275bbf8d6c22', '01a0dc8a-7197-7f76-92c3-d759a6a4e110', 5, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-7199-7d68-9d6b-b8727e3d677d', '01a0dc8a-7199-7161-8e40-c23bc389953d', 7, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-719a-77e4-844f-ea2816ddbe79', '01a0dc8a-719a-7350-8df1-60ed71873a00', 9, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-719b-779f-9d03-fd99ea156059', '01a0dc8a-719b-70a2-a85a-afff115acb2f', 11, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-719c-7bb9-918e-74af8ee5a83e', '01a0dc8a-719b-77a7-b011-ef4664c92e21', 13, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-719c-7c60-bb40-c1c135704ec2', '01a0dc8a-719c-7e32-b722-ec3e3d9d2ecd', 15, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-719d-7aae-96b7-5a3b46bca5a4', '01a0dc8a-719d-7aa6-bd37-5b4df23df4a8', 17, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-719d-7d89-8a00-5fff713acacd', '01a0dc8a-719d-7b45-92cc-b08147529e15', 19, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-719e-7a4a-af7b-ed5e5cc88388', '01a0dc8a-719e-7ed1-8a7c-97b3a888b354', 21, 2, 'primary', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.collection_item_face VALUES ('01a0dc8a-719e-7c6c-b98f-f7fd9ee0d79a', '01a0dc8a-719e-702b-8f4f-9fa56d414598', 25, 2, 'primary', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: collection_item_tag; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.collection_item_tag VALUES ('01a0dc8a-7191-7e18-93b0-32e8378986fe', 5);
INSERT INTO app.collection_item_tag VALUES ('01a0dc8a-7197-7f76-92c3-d759a6a4e110', 5);
INSERT INTO app.collection_item_tag VALUES ('01a0dc8a-7199-7161-8e40-c23bc389953d', 5);
INSERT INTO app.collection_item_tag VALUES ('01a0dc8a-719a-7350-8df1-60ed71873a00', 5);
INSERT INTO app.collection_item_tag VALUES ('01a0dc8a-719b-70a2-a85a-afff115acb2f', 5);


--
-- Data for Name: collection_share; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.collection_share VALUES ('01a0dc8a-71d6-7c8e-b79f-f114b0d513dd', '01a0dc8a-718f-7acd-a588-2cf077898399', 'demo-2affe0f2b5dc', 'clone', 4, NULL, NULL, '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: device; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.device VALUES ('993a53c1-ab6f-484c-99fe-26289c97d8b5', 4, 'android', 'fcm', 'demo-token-android', NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07', NULL);
INSERT INTO app.device VALUES ('8a5636d8-2296-43e7-bffc-8ea42083f532', 4, 'web', 'webpush', 'demo-token-web', NULL, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07', NULL);


--
-- Data for Name: gloss_report; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: leaderboard_snapshot; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: notification_log; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: quiz; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.quiz VALUES ('01a0dc8a-71cc-710d-bea4-61d090693a67', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', '01a0dc8a-718f-7acd-a588-2cf077898399', 'multiple_choice', 'easy', 3, '{"model": "seed", "prompt_version": "v1"}', 'ready', '2026-09-26 14:07:35.660843+07', NULL);


--
-- Data for Name: quiz_question; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.quiz_question VALUES (1, '01a0dc8a-71cc-710d-bea4-61d090693a67', 1, 'multiple_choice', 'Nghĩa của 「学生」 là gì?', '[{"key": "A", "text": "big; large"}, {"key": "B", "text": "student"}, {"key": "C", "text": "to go"}, {"key": "D", "text": "to eat"}]', '{"key": "B"}', 'Dữ liệu demo — chưa có giải thích từ AI.', 2, NULL, '01a0dc8a-719c-7e32-b722-ec3e3d9d2ecd');
INSERT INTO app.quiz_question VALUES (2, '01a0dc8a-71cc-710d-bea4-61d090693a67', 2, 'multiple_choice', 'Nghĩa của 「水」 là gì?', '[{"key": "A", "text": "to go"}, {"key": "B", "text": "water"}, {"key": "C", "text": "to run"}, {"key": "D", "text": "teacher"}]', '{"key": "B"}', 'Dữ liệu demo — chưa có giải thích từ AI.', 2, NULL, '01a0dc8a-719a-7350-8df1-60ed71873a00');
INSERT INTO app.quiz_question VALUES (3, '01a0dc8a-71cc-710d-bea4-61d090693a67', 3, 'multiple_choice', 'Nghĩa của 「行く」 là gì?', '[{"key": "A", "text": "water"}, {"key": "B", "text": "student"}, {"key": "C", "text": "to go"}, {"key": "D", "text": "school"}]', '{"key": "C"}', 'Dữ liệu demo — chưa có giải thích từ AI.', 2, NULL, '01a0dc8a-7199-7161-8e40-c23bc389953d');


--
-- Data for Name: reminder; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.reminder VALUES ('01a0dc8a-71d2-78aa-9d9d-909e92c898e3', 4, 'Học buổi tối', '20:00:00', 'Asia/Ho_Chi_Minh', '{1,2,3,4,5,6,7}', '{push}', true, false, 2, '2026-09-26 20:07:35.660843+07', '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: review_log_2026_09; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.review_log_2026_09 VALUES (1, 5, 4, '01a0dc8a-719c-7c60-bb40-c1c135704ec2', 2, 'flashcard', 1393, '2026-09-22 21:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (2, 18, 4, '01a0dc8a-7197-777d-b5fb-275bbf8d6c22', 3, 'flashcard', 1275, '2026-09-22 16:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (3, 7, 4, '01a0dc8a-7191-70cc-9856-670bfbaa0b76', 2, 'flashcard', 4352, '2026-09-22 14:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (4, 3, 4, '01a0dc8a-719a-77e4-844f-ea2816ddbe79', 2, 'flashcard', 4277, '2026-09-22 08:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (5, 19, 4, '01a0dc8a-7197-777d-b5fb-275bbf8d6c22', 3, 'flashcard', 1306, '2026-09-22 17:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (6, 13, 4, '01a0dc8a-7191-70cc-9856-670bfbaa0b76', 3, 'flashcard', 1181, '2026-09-23 16:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (7, 5, 4, '01a0dc8a-719b-779f-9d03-fd99ea156059', 4, 'flashcard', 1981, '2026-09-23 16:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (8, 4, 4, '01a0dc8a-719e-7a4a-af7b-ed5e5cc88388', 3, 'flashcard', 2280, '2026-09-23 09:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (9, 19, 4, '01a0dc8a-719e-7a4a-af7b-ed5e5cc88388', 3, 'flashcard', 3850, '2026-09-23 09:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (10, 18, 4, '01a0dc8a-7197-777d-b5fb-275bbf8d6c22', 2, 'flashcard', 2487, '2026-09-23 15:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (11, 22, 4, '01a0dc8a-719d-7d89-8a00-5fff713acacd', 4, 'flashcard', 3373, '2026-09-23 15:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (12, 19, 4, '01a0dc8a-719d-7aae-96b7-5a3b46bca5a4', 3, 'flashcard', 3255, '2026-09-23 11:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (13, 8, 4, '01a0dc8a-7197-777d-b5fb-275bbf8d6c22', 3, 'flashcard', 4855, '2026-09-24 13:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (14, 15, 4, '01a0dc8a-719b-779f-9d03-fd99ea156059', 2, 'flashcard', 1767, '2026-09-24 16:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (15, 14, 4, '01a0dc8a-7199-7d68-9d6b-b8727e3d677d', 3, 'flashcard', 2045, '2026-09-24 15:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (16, 14, 4, '01a0dc8a-7191-70cc-9856-670bfbaa0b76', 2, 'flashcard', 3370, '2026-09-24 13:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (17, 20, 4, '01a0dc8a-719d-7aae-96b7-5a3b46bca5a4', 4, 'flashcard', 1363, '2026-09-25 21:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (18, 3, 4, '01a0dc8a-719b-779f-9d03-fd99ea156059', 4, 'flashcard', 1332, '2026-09-25 08:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (19, 10, 4, '01a0dc8a-719e-7c6c-b98f-f7fd9ee0d79a', 4, 'flashcard', 3131, '2026-09-25 19:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (20, 13, 4, '01a0dc8a-719e-7c6c-b98f-f7fd9ee0d79a', 3, 'flashcard', 984, '2026-09-25 15:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (21, 12, 4, '01a0dc8a-7199-7d68-9d6b-b8727e3d677d', 2, 'flashcard', 4844, '2026-09-25 08:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (22, 10, 4, '01a0dc8a-7199-7d68-9d6b-b8727e3d677d', 3, 'flashcard', 4059, '2026-09-26 14:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (23, 16, 4, '01a0dc8a-7197-777d-b5fb-275bbf8d6c22', 3, 'flashcard', 4479, '2026-09-26 14:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (24, 18, 4, '01a0dc8a-719b-779f-9d03-fd99ea156059', 3, 'flashcard', 4326, '2026-09-26 21:00:00+07');
INSERT INTO app.review_log_2026_09 VALUES (25, 18, 4, '01a0dc8a-719b-779f-9d03-fd99ea156059', 4, 'flashcard', 3739, '2026-09-26 18:00:00+07');


--
-- Data for Name: review_log_2026_10; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2026_11; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2026_12; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_01; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_02; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_03; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_04; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_05; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_06; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_07; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_08; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_09; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_10; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_11; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2027_12; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_01; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_02; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_03; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_04; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_05; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_06; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_07; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_08; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_09; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_10; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_11; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2028_12; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2029_01; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2029_02; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2029_03; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2029_04; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2029_05; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2029_06; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2029_07; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: review_log_2029_08; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: search_history; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.search_history VALUES (1, 4, '走る', NULL, 2, 1, 15, '2026-09-26 14:07:35.660843+07');
INSERT INTO app.search_history VALUES (2, 4, 'たべる', NULL, 2, 5, 18, '2026-09-26 14:07:35.660843+07');
INSERT INTO app.search_history VALUES (3, 4, 'JLPT N5', NULL, 2, NULL, 13, '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: srs_state; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.srs_state VALUES (1, '01a0dc8a-7191-70cc-9856-670bfbaa0b76', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'learning', '2026-09-26 14:07:35.660843+07', 1.5, 5, 0, 0, 0, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (2, '01a0dc8a-7191-70cc-9856-670bfbaa0b76', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'learning', '2026-09-26 14:07:35.660843+07', 1.5, 5, 0, 0, 0, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (3, '01a0dc8a-7197-777d-b5fb-275bbf8d6c22', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'learning', '2026-09-26 11:07:35.660843+07', 1.5, 5, 1, 0, 1, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (4, '01a0dc8a-7197-777d-b5fb-275bbf8d6c22', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'learning', '2026-09-26 11:07:35.660843+07', 1.5, 5, 1, 0, 1, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (5, '01a0dc8a-7199-7d68-9d6b-b8727e3d677d', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'learning', '2026-09-26 08:07:35.660843+07', 1.5, 5, 2, 0, 2, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (6, '01a0dc8a-7199-7d68-9d6b-b8727e3d677d', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'learning', '2026-09-26 08:07:35.660843+07', 1.5, 5, 2, 0, 2, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (7, '01a0dc8a-719a-77e4-844f-ea2816ddbe79', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'learning', '2026-09-26 05:07:35.660843+07', 1.5, 5, 3, 0, 3, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (8, '01a0dc8a-719a-77e4-844f-ea2816ddbe79', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'learning', '2026-09-26 05:07:35.660843+07', 1.5, 5, 3, 0, 3, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (9, '01a0dc8a-719b-779f-9d03-fd99ea156059', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'new', '2026-10-01 14:07:35.660843+07', 1.5, 5, 4, 0, 4, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (10, '01a0dc8a-719b-779f-9d03-fd99ea156059', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'new', '2026-10-01 14:07:35.660843+07', 1.5, 5, 4, 0, 4, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (11, '01a0dc8a-719c-7bb9-918e-74af8ee5a83e', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'new', '2026-10-02 14:07:35.660843+07', 1.5, 5, 5, 0, 5, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (12, '01a0dc8a-719c-7bb9-918e-74af8ee5a83e', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'new', '2026-10-02 14:07:35.660843+07', 1.5, 5, 5, 0, 5, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (13, '01a0dc8a-719c-7c60-bb40-c1c135704ec2', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'new', '2026-10-03 14:07:35.660843+07', 1.5, 5, 6, 0, 6, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (14, '01a0dc8a-719c-7c60-bb40-c1c135704ec2', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'new', '2026-10-03 14:07:35.660843+07', 1.5, 5, 6, 0, 6, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (15, '01a0dc8a-719d-7aae-96b7-5a3b46bca5a4', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'new', '2026-10-04 14:07:35.660843+07', 1.5, 5, 7, 0, 7, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (16, '01a0dc8a-719d-7aae-96b7-5a3b46bca5a4', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'new', '2026-10-04 14:07:35.660843+07', 1.5, 5, 7, 0, 7, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (17, '01a0dc8a-719d-7d89-8a00-5fff713acacd', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'new', '2026-10-05 14:07:35.660843+07', 1.5, 5, 8, 0, 8, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (18, '01a0dc8a-719d-7d89-8a00-5fff713acacd', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'new', '2026-10-05 14:07:35.660843+07', 1.5, 5, 8, 0, 8, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (19, '01a0dc8a-719e-7a4a-af7b-ed5e5cc88388', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'new', '2026-10-06 14:07:35.660843+07', 1.5, 5, 9, 0, 9, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (20, '01a0dc8a-719e-7a4a-af7b-ed5e5cc88388', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'new', '2026-10-06 14:07:35.660843+07', 1.5, 5, 9, 0, 9, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (21, '01a0dc8a-719e-7c6c-b98f-f7fd9ee0d79a', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recognize', 'new', '2026-10-07 14:07:35.660843+07', 1.5, 5, 10, 0, 10, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.srs_state VALUES (22, '01a0dc8a-719e-7c6c-b98f-f7fd9ee0d79a', 4, '01a0dc8a-718a-7acf-bd0c-90114c061f04', 'recall', 'new', '2026-10-07 14:07:35.660843+07', 1.5, 5, 10, 0, 10, NULL, '2026-09-25 14:07:35.660843+07', false, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: streak_day; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.streak_day VALUES (4, '2026-09-22', 5, 5, true);
INSERT INTO app.streak_day VALUES (4, '2026-09-23', 7, 7, true);
INSERT INTO app.streak_day VALUES (4, '2026-09-24', 4, 4, false);
INSERT INTO app.streak_day VALUES (4, '2026-09-25', 5, 5, true);
INSERT INTO app.streak_day VALUES (4, '2026-09-26', 4, 4, false);


--
-- Data for Name: study_profile; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.study_profile VALUES ('01a0dc8a-718a-7acf-bd0c-90114c061f04', 4, 'Nhật–Việt', 2, 1, 3, true, '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: study_session; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: study_session_item; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: tag; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.tag VALUES (5, 4, '#n5', '#4f46e5', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.tag VALUES (6, 4, '#cần-ôn', '#dc2626', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: user_achievement; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.user_achievement VALUES (4, 'words_100', 11.00, NULL, NULL);
INSERT INTO app.user_achievement VALUES (4, 'streak_7', 5.00, NULL, NULL);
INSERT INTO app.user_achievement VALUES (4, 'reviews_1000', 30.00, NULL, NULL);


--
-- Data for Name: user_identity; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.user_identity VALUES (4, 4, 'password', 'demo@langoo.local', 'demo-placeholder-hash', '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: user_session; Type: TABLE DATA; Schema: app; Owner: -
--



--
-- Data for Name: user_settings; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.user_settings VALUES (4, 'Asia/Ho_Chi_Minh', NULL, 15, '{}', '01a0dc8a-718a-7acf-bd0c-90114c061f04', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: user_stats; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.user_stats VALUES (4, 27, 3, 5, 5, '2026-09-26', 11, 30, '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: users; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.users VALUES (4, 'demo@langoo.local', 'Demo Langoo', NULL, 'active', '2026-09-26 14:07:35.660843+07', '2026-09-26 14:07:35.660843+07', NULL);


--
-- Data for Name: xp_event; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.xp_event VALUES (9, 4, 5, 'review', 'seed', NULL, 'seed:2026-09-22', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.xp_event VALUES (10, 4, 7, 'review', 'seed', NULL, 'seed:2026-09-23', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.xp_event VALUES (11, 4, 4, 'review', 'seed', NULL, 'seed:2026-09-24', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.xp_event VALUES (12, 4, 5, 'review', 'seed', NULL, 'seed:2026-09-25', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.xp_event VALUES (13, 4, 4, 'review', 'seed', NULL, 'seed:2026-09-26', '2026-09-26 14:07:35.660843+07');
INSERT INTO app.xp_event VALUES (14, 4, 2, 'streak', 'seed', NULL, 'seed:streak-bonus', '2026-09-26 14:07:35.660843+07');


--
-- Data for Name: xp_rule; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.xp_rule VALUES ('review', 'Ôn 1 thẻ đạt', 1, 200, true, '2026-09-26 14:02:01.312127+07');
INSERT INTO app.xp_rule VALUES ('quiz_correct', 'Trả lời đúng 1 câu quiz', 5, 200, true, '2026-09-26 14:02:01.312127+07');
INSERT INTO app.xp_rule VALUES ('streak_day', 'Duy trì ngày học có ôn tập', 2, 2, true, '2026-09-26 14:02:01.312127+07');


--
-- Data for Name: concept; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.concept VALUES (1, NULL, 'verb', 'move fast on foot', 'di chuyển nhanh bằng chân', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (2, NULL, 'verb', 'be in charge of a business', 'điều hành tổ chức', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (3, NULL, 'verb', 'take food', 'ăn uống', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (4, NULL, 'verb', 'move to a place', 'di chuyển tới một nơi', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (5, NULL, 'noun', 'liquid essential to life', 'chất lỏng thiết yếu', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (6, NULL, 'noun', 'daytime or the sun', 'ban ngày hoặc mặt trời', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (7, NULL, 'noun', 'written work', 'tác phẩm viết', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (8, NULL, 'noun', 'person who studies', 'người đi học', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (9, NULL, 'noun', 'place for learning', 'nơi học tập', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (10, NULL, 'noun', 'person who teaches', 'người dạy học', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (11, NULL, 'adjective', 'of great size', 'kích thước lớn', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (12, NULL, 'noun', 'small domestic animal', 'động vật nuôi nhỏ', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept VALUES (13, NULL, 'noun', 'act of learning', 'hoạt động học', NULL, 'curated', 100, '662e11af-93ae-4262-8c0b-6cf103033702');


--
-- Data for Name: concept_gloss; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.concept_gloss VALUES (1, 1, 1, 'move fast on foot', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (1, 3, 1, 'di chuyển nhanh bằng chân', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (2, 1, 1, 'be in charge of a business', false, 100, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (2, 3, 1, 'điều hành tổ chức', true, 100, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (3, 1, 1, 'take food', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (3, 3, 1, 'ăn uống', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (4, 1, 1, 'move to a place', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (4, 3, 1, 'di chuyển tới một nơi', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (5, 1, 1, 'liquid essential to life', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (5, 3, 1, 'chất lỏng thiết yếu', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (6, 1, 1, 'daytime or the sun', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (6, 3, 1, 'ban ngày hoặc mặt trời', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (7, 1, 1, 'written work', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (7, 3, 1, 'tác phẩm viết', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (8, 1, 1, 'person who studies', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (8, 3, 1, 'người đi học', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (9, 1, 1, 'place for learning', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (9, 3, 1, 'nơi học tập', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (10, 1, 1, 'person who teaches', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (10, 3, 1, 'người dạy học', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (11, 1, 1, 'of great size', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (11, 3, 1, 'kích thước lớn', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (12, 1, 1, 'small domestic animal', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (12, 3, 1, 'động vật nuôi nhỏ', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (13, 1, 1, 'act of learning', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.concept_gloss VALUES (13, 3, 1, 'hoạt động học', false, NULL, NULL, NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');


--
-- Data for Name: concept_gloss_history; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: concept_label; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: deck; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.deck VALUES (1, 'jlpt-n5-demo', 'JLPT N5 (demo)', 'Bộ mẫu để code API', 2, 'N5', true, 11, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.deck VALUES (2, 'en-core-demo', 'English A1 (demo)', 'Bộ mẫu để code API', 1, 'A1', true, 6, '2026-09-26 14:07:33.199548+07');


--
-- Data for Name: deck_item; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.deck_item VALUES (1, 1, 1, 1);
INSERT INTO core.deck_item VALUES (1, 5, 3, 2);
INSERT INTO core.deck_item VALUES (1, 7, 4, 3);
INSERT INTO core.deck_item VALUES (1, 9, 5, 4);
INSERT INTO core.deck_item VALUES (1, 11, 6, 5);
INSERT INTO core.deck_item VALUES (1, 13, 7, 6);
INSERT INTO core.deck_item VALUES (1, 15, 8, 7);
INSERT INTO core.deck_item VALUES (1, 17, 9, 8);
INSERT INTO core.deck_item VALUES (1, 19, 10, 9);
INSERT INTO core.deck_item VALUES (1, 21, 11, 10);
INSERT INTO core.deck_item VALUES (1, 25, 13, 11);
INSERT INTO core.deck_item VALUES (2, 2, 1, 1);
INSERT INTO core.deck_item VALUES (2, 6, 3, 2);
INSERT INTO core.deck_item VALUES (2, 8, 4, 3);
INSERT INTO core.deck_item VALUES (2, 10, 5, 4);
INSERT INTO core.deck_item VALUES (2, 12, 6, 5);
INSERT INTO core.deck_item VALUES (2, 14, 7, 6);


--
-- Data for Name: example; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.example VALUES (1, 1, 2, '毎朝、公園を走ります。', '{"en": "I run in the park every morning.", "vi": "Tôi chạy trong công viên mỗi sáng."}', 'demo:ex:ja:走る', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (2, 2, 1, 'I run in the park every morning.', '{"ja": "毎朝、公園を走ります。", "vi": "Tôi chạy trong công viên mỗi sáng."}', 'demo:ex:en:run', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (3, 5, 2, 'りんごを食べます。', '{"en": "I eat an apple.", "vi": "Tôi ăn một quả táo."}', 'demo:ex:ja:食べる', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (4, 6, 1, 'I eat an apple.', '{"ja": "りんごを食べます。", "vi": "Tôi ăn một quả táo."}', 'demo:ex:en:eat', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (5, 7, 2, '学校へ行きます。', '{"en": "I go to school.", "vi": "Tôi đi đến trường."}', 'demo:ex:ja:行く', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (6, 8, 1, 'I go to school.', '{"ja": "学校へ行きます。", "vi": "Tôi đi đến trường."}', 'demo:ex:en:go', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (7, 9, 2, '水を飲みます。', '{"en": "I drink water.", "vi": "Tôi uống nước."}', 'demo:ex:ja:水', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (8, 10, 1, 'I drink water.', '{"ja": "水を飲みます。", "vi": "Tôi uống nước."}', 'demo:ex:en:water', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (9, 11, 2, '今日はいい日です。', '{"en": "Today is a good day.", "vi": "Hôm nay là một ngày tốt."}', 'demo:ex:ja:日', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (10, 12, 1, 'Today is a good day.', '{"ja": "今日はいい日です。", "vi": "Hôm nay là một ngày tốt."}', 'demo:ex:en:day', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (11, 13, 2, '本を読みます。', '{"en": "I read a book.", "vi": "Tôi đọc sách."}', 'demo:ex:ja:本', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (12, 14, 1, 'I read a book.', '{"ja": "本を読みます。", "vi": "Tôi đọc sách."}', 'demo:ex:en:book', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (13, 15, 2, '私は学生です。', '{"en": "I am a student.", "vi": "Tôi là học sinh."}', 'demo:ex:ja:学生', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (14, 16, 1, 'I am a student.', '{"ja": "私は学生です。", "vi": "Tôi là học sinh."}', 'demo:ex:en:student', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (15, 17, 2, '学校は駅の近くです。', '{"en": "The school is near the station.", "vi": "Trường học ở gần nhà ga."}', 'demo:ex:ja:学校', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (16, 18, 1, 'The school is near the station.', '{"ja": "学校は駅の近くです。", "vi": "Trường học ở gần nhà ga."}', 'demo:ex:en:school', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (17, 19, 2, '先生は親切です。', '{"en": "The teacher is kind.", "vi": "Giáo viên rất tốt bụng."}', 'demo:ex:ja:先生', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (18, 20, 1, 'The teacher is kind.', '{"ja": "先生は親切です。", "vi": "Giáo viên rất tốt bụng."}', 'demo:ex:en:teacher', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (19, 21, 2, 'この犬は大きいです。', '{"en": "This dog is big.", "vi": "Con chó này to."}', 'demo:ex:ja:大きい', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (20, 22, 1, 'This dog is big.', '{"ja": "この犬は大きいです。", "vi": "Con chó này to."}', 'demo:ex:en:big', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (21, 23, 2, '猫が好きです。', '{"en": "I like cats.", "vi": "Tôi thích mèo."}', 'demo:ex:ja:猫', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (22, 24, 1, 'I like cats.', '{"ja": "猫が好きです。", "vi": "Tôi thích mèo."}', 'demo:ex:en:cat', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (23, 25, 2, '毎日日本語を勉強します。', '{"en": "I study Japanese every day.", "vi": "Tôi học tiếng Nhật mỗi ngày."}', 'demo:ex:ja:勉強', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example VALUES (24, 26, 1, 'I study Japanese every day.', '{"ja": "毎日日本語を勉強します。", "vi": "Tôi học tiếng Nhật mỗi ngày."}', 'demo:ex:en:study', NULL, 100, '662e11af-93ae-4262-8c0b-6cf103033702');


--
-- Data for Name: example_annotation; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: example_concept; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: example_sense; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: example_translation; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.example_translation VALUES (1, 2, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (2, 1, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (3, 4, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (4, 3, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (5, 6, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (6, 5, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (7, 8, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (8, 7, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (9, 10, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (10, 9, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (11, 12, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (12, 11, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (13, 14, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (14, 13, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (15, 16, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (16, 15, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (17, 18, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (18, 17, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (19, 20, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (20, 19, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (21, 22, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (22, 21, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (23, 24, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.example_translation VALUES (24, 23, '662e11af-93ae-4262-8c0b-6cf103033702');


--
-- Data for Name: jlpt_link; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: kanji; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.kanji VALUES ('走', 36208, 2, 7, NULL, 3, 156, '{"ja_on": ["ソウ"], "ja_kun": ["はし.る"], "vietnam": ["Tẩu"]}', '{"en": ["run"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 4, NULL);
INSERT INTO core.kanji VALUES ('食', 39135, 2, 9, NULL, 3, 184, '{"ja_on": ["ショク", "ジキ"], "ja_kun": ["た.べる", "く.う"], "vietnam": ["Thực"]}', '{"en": ["eat", "food"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('行', 34892, 2, 6, NULL, 3, 144, '{"ja_on": ["コウ", "ギョウ"], "ja_kun": ["い.く", "おこな.う"], "vietnam": ["Hành"]}', '{"en": ["go", "carry out"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('水', 27700, 1, 4, NULL, 4, 85, '{"ja_on": ["スイ"], "ja_kun": ["みず"], "vietnam": ["Thuỷ"]}', '{"en": ["water"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('日', 26085, 1, 4, NULL, 4, 72, '{"ja_on": ["ニチ", "ジツ"], "ja_kun": ["ひ", "か"], "vietnam": ["Nhật"]}', '{"en": ["day", "sun"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('本', 26412, 1, 5, NULL, 4, 75, '{"ja_on": ["ホン"], "ja_kun": ["もと"], "vietnam": ["Bản"]}', '{"en": ["book", "origin"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('学', 23398, 1, 8, NULL, 4, 39, '{"ja_on": ["ガク"], "ja_kun": ["まな.ぶ"], "vietnam": ["Học"]}', '{"en": ["study", "learning"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('生', 29983, 1, 5, NULL, 4, 100, '{"ja_on": ["セイ", "ショウ"], "ja_kun": ["い.きる", "なま"], "vietnam": ["Sinh"]}', '{"en": ["life", "birth", "raw"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('校', 26657, 1, 10, NULL, 4, 75, '{"ja_on": ["コウ"], "ja_kun": [], "vietnam": ["Hiệu"]}', '{"en": ["school"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('先', 20808, 1, 6, NULL, 4, 10, '{"ja_on": ["セン"], "ja_kun": ["さき"], "vietnam": ["Tiên"]}', '{"en": ["previous", "ahead"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('大', 22823, 1, 3, NULL, 4, 37, '{"ja_on": ["ダイ", "タイ"], "ja_kun": ["おお.きい"], "vietnam": ["Đại"]}', '{"en": ["big", "large"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 5, NULL);
INSERT INTO core.kanji VALUES ('猫', 29483, 8, 11, NULL, NULL, 94, '{"ja_on": ["ビョウ"], "ja_kun": ["ねこ"], "vietnam": ["Miêu"]}', '{"en": ["cat"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.kanji VALUES ('勉', 21193, 3, 10, NULL, 2, 19, '{"ja_on": ["ベン"], "ja_kun": ["つと.める"], "vietnam": ["Miễn"]}', '{"en": ["diligence", "effort"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.kanji VALUES ('強', 24375, 2, 11, NULL, 3, 57, '{"ja_on": ["キョウ"], "ja_kun": ["つよ.い"], "vietnam": ["Cường"]}', '{"en": ["strong"]}', '[]', '{}', '[]', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 4, NULL);


--
-- Data for Name: kanji_media; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: kanji_radical; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.kanji_radical VALUES ('走', '走', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('食', '食', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('行', '行', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('水', '水', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('日', '日', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('本', '木', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('本', '一', 2, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('学', '子', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('学', '冖', 2, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('学', 'ツ', 3, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('生', '生', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('校', '木', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('校', '交', 2, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('先', '儿', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('先', '土', 2, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('先', 'ノ', 3, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('大', '大', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('猫', '犭', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('猫', '艹', 2, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('猫', '田', 3, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('勉', '免', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('勉', '力', 2, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('強', '弓', 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('強', '虫', 2, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.kanji_radical VALUES ('強', '厶', 3, 100, '662e11af-93ae-4262-8c0b-6cf103033702');


--
-- Data for Name: lexeme; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.lexeme VALUES (1, 2, '走る', 'verb', 'はしる', NULL, 1, 100, '{"common": true}', 'demo:ja:走る', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (2, 1, 'run', 'verb', NULL, NULL, 1, 110, '{"common": true}', 'demo:en:run', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (3, 2, '食べる', 'verb', 'たべる', NULL, 1, 110, '{"common": true}', 'demo:ja:食べる', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (4, 1, 'eat', 'verb', NULL, NULL, 1, 120, '{"common": true}', 'demo:en:eat', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (5, 2, '行く', 'verb', 'いく', NULL, 1, 120, '{"common": true}', 'demo:ja:行く', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (6, 1, 'go', 'verb', NULL, NULL, 1, 130, '{"common": true}', 'demo:en:go', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (7, 2, '水', 'noun', 'みず', NULL, 1, 130, '{"common": true}', 'demo:ja:水', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (8, 1, 'water', 'noun', NULL, NULL, 1, 140, '{"common": true}', 'demo:en:water', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (9, 2, '日', 'noun', 'ひ', NULL, 1, 140, '{"common": true}', 'demo:ja:日', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (10, 1, 'day', 'noun', NULL, NULL, 1, 150, '{"common": true}', 'demo:en:day', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (11, 2, '本', 'noun', 'ほん', NULL, 1, 150, '{"common": true}', 'demo:ja:本', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (12, 1, 'book', 'noun', NULL, NULL, 1, 160, '{"common": true}', 'demo:en:book', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (13, 2, '学生', 'noun', 'がくせい', NULL, 1, 160, '{"common": true}', 'demo:ja:学生', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (14, 1, 'student', 'noun', NULL, NULL, 1, 170, '{"common": true}', 'demo:en:student', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (15, 2, '学校', 'noun', 'がっこう', NULL, 1, 170, '{"common": true}', 'demo:ja:学校', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (16, 1, 'school', 'noun', NULL, NULL, 1, 180, '{"common": true}', 'demo:en:school', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (17, 2, '先生', 'noun', 'せんせい', NULL, 1, 180, '{"common": true}', 'demo:ja:先生', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (18, 1, 'teacher', 'noun', NULL, NULL, 1, 190, '{"common": true}', 'demo:en:teacher', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (19, 2, '大きい', 'adjective', 'おおきい', NULL, 1, 190, '{"common": true}', 'demo:ja:大きい', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (20, 1, 'big', 'adjective', NULL, NULL, 1, 200, '{"common": true}', 'demo:en:big', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (21, 2, '猫', 'noun', 'ねこ', NULL, 1, 200, '{"common": true}', 'demo:ja:猫', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (22, 1, 'cat', 'noun', NULL, NULL, 1, 210, '{"common": true}', 'demo:en:cat', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (23, 2, '勉強', 'noun', 'べんきょう', NULL, 1, 210, '{"common": true}', 'demo:ja:勉強', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');
INSERT INTO core.lexeme VALUES (24, 1, 'study', 'noun', NULL, NULL, 1, 220, '{"common": true}', 'demo:en:study', 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, '2026-09-26 14:07:33.199548+07');


--
-- Data for Name: lexeme_form; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.lexeme_form VALUES (1, 1, 'kanji', '走る', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (2, 1, 'kana', 'はしる', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (3, 3, 'kanji', '食べる', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (4, 3, 'kana', 'たべる', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (5, 5, 'kanji', '行く', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (6, 5, 'kana', 'いく', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (7, 7, 'kanji', '水', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (8, 7, 'kana', 'みず', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (9, 9, 'kanji', '日', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (10, 9, 'kana', 'ひ', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (11, 11, 'kanji', '本', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (12, 11, 'kana', 'ほん', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (13, 13, 'kanji', '学生', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (14, 13, 'kana', 'がくせい', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (15, 15, 'kanji', '学校', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (16, 15, 'kana', 'がっこう', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (17, 17, 'kanji', '先生', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (18, 17, 'kana', 'せんせい', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (19, 19, 'kanji', '大きい', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (20, 19, 'kana', 'おおきい', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (21, 21, 'kanji', '猫', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (22, 21, 'kana', 'ねこ', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (23, 23, 'kanji', '勉強', 1, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_form VALUES (24, 23, 'kana', 'べんきょう', 2, true, '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702');


--
-- Data for Name: lexeme_form_applies_to; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: lexeme_form_char; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.lexeme_form_char VALUES (1, 1, '走', 36208, 'kanji', '走');
INSERT INTO core.lexeme_form_char VALUES (1, 2, 'る', 12427, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (2, 1, '走', 36208, 'kanji', '走');
INSERT INTO core.lexeme_form_char VALUES (2, 2, 'る', 12427, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (3, 1, '食', 39135, 'kanji', '食');
INSERT INTO core.lexeme_form_char VALUES (3, 2, 'べ', 12409, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (3, 3, 'る', 12427, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (4, 1, '食', 39135, 'kanji', '食');
INSERT INTO core.lexeme_form_char VALUES (4, 2, 'べ', 12409, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (4, 3, 'る', 12427, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (5, 1, '行', 34892, 'kanji', '行');
INSERT INTO core.lexeme_form_char VALUES (5, 2, 'く', 12367, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (6, 1, '行', 34892, 'kanji', '行');
INSERT INTO core.lexeme_form_char VALUES (6, 2, 'く', 12367, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (7, 1, '水', 27700, 'kanji', '水');
INSERT INTO core.lexeme_form_char VALUES (8, 1, '水', 27700, 'kanji', '水');
INSERT INTO core.lexeme_form_char VALUES (9, 1, '日', 26085, 'kanji', '日');
INSERT INTO core.lexeme_form_char VALUES (10, 1, '日', 26085, 'kanji', '日');
INSERT INTO core.lexeme_form_char VALUES (11, 1, '本', 26412, 'kanji', '本');
INSERT INTO core.lexeme_form_char VALUES (12, 1, '本', 26412, 'kanji', '本');
INSERT INTO core.lexeme_form_char VALUES (13, 1, '学', 23398, 'kanji', '学');
INSERT INTO core.lexeme_form_char VALUES (13, 2, '生', 29983, 'kanji', '生');
INSERT INTO core.lexeme_form_char VALUES (14, 1, '学', 23398, 'kanji', '学');
INSERT INTO core.lexeme_form_char VALUES (14, 2, '生', 29983, 'kanji', '生');
INSERT INTO core.lexeme_form_char VALUES (15, 1, '学', 23398, 'kanji', '学');
INSERT INTO core.lexeme_form_char VALUES (15, 2, '校', 26657, 'kanji', '校');
INSERT INTO core.lexeme_form_char VALUES (16, 1, '学', 23398, 'kanji', '学');
INSERT INTO core.lexeme_form_char VALUES (16, 2, '校', 26657, 'kanji', '校');
INSERT INTO core.lexeme_form_char VALUES (17, 1, '先', 20808, 'kanji', '先');
INSERT INTO core.lexeme_form_char VALUES (17, 2, '生', 29983, 'kanji', '生');
INSERT INTO core.lexeme_form_char VALUES (18, 1, '先', 20808, 'kanji', '先');
INSERT INTO core.lexeme_form_char VALUES (18, 2, '生', 29983, 'kanji', '生');
INSERT INTO core.lexeme_form_char VALUES (19, 1, '大', 22823, 'kanji', '大');
INSERT INTO core.lexeme_form_char VALUES (19, 2, 'き', 12365, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (19, 3, 'い', 12356, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (20, 1, '大', 22823, 'kanji', '大');
INSERT INTO core.lexeme_form_char VALUES (20, 2, 'き', 12365, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (20, 3, 'い', 12356, 'kana', NULL);
INSERT INTO core.lexeme_form_char VALUES (21, 1, '猫', 29483, 'kanji', '猫');
INSERT INTO core.lexeme_form_char VALUES (22, 1, '猫', 29483, 'kanji', '猫');
INSERT INTO core.lexeme_form_char VALUES (23, 1, '勉', 21193, 'kanji', '勉');
INSERT INTO core.lexeme_form_char VALUES (23, 2, '強', 24375, 'kanji', '強');
INSERT INTO core.lexeme_form_char VALUES (24, 1, '勉', 21193, 'kanji', '勉');
INSERT INTO core.lexeme_form_char VALUES (24, 2, '強', 24375, 'kanji', '強');


--
-- Data for Name: lexeme_form_kanji_char; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.lexeme_form_kanji_char VALUES (1, 1, '走');
INSERT INTO core.lexeme_form_kanji_char VALUES (2, 1, '走');
INSERT INTO core.lexeme_form_kanji_char VALUES (3, 1, '食');
INSERT INTO core.lexeme_form_kanji_char VALUES (4, 1, '食');
INSERT INTO core.lexeme_form_kanji_char VALUES (5, 1, '行');
INSERT INTO core.lexeme_form_kanji_char VALUES (6, 1, '行');
INSERT INTO core.lexeme_form_kanji_char VALUES (7, 1, '水');
INSERT INTO core.lexeme_form_kanji_char VALUES (8, 1, '水');
INSERT INTO core.lexeme_form_kanji_char VALUES (9, 1, '日');
INSERT INTO core.lexeme_form_kanji_char VALUES (10, 1, '日');
INSERT INTO core.lexeme_form_kanji_char VALUES (11, 1, '本');
INSERT INTO core.lexeme_form_kanji_char VALUES (12, 1, '本');
INSERT INTO core.lexeme_form_kanji_char VALUES (13, 1, '学');
INSERT INTO core.lexeme_form_kanji_char VALUES (13, 2, '生');
INSERT INTO core.lexeme_form_kanji_char VALUES (14, 1, '学');
INSERT INTO core.lexeme_form_kanji_char VALUES (14, 2, '生');
INSERT INTO core.lexeme_form_kanji_char VALUES (15, 1, '学');
INSERT INTO core.lexeme_form_kanji_char VALUES (15, 2, '校');
INSERT INTO core.lexeme_form_kanji_char VALUES (16, 1, '学');
INSERT INTO core.lexeme_form_kanji_char VALUES (16, 2, '校');
INSERT INTO core.lexeme_form_kanji_char VALUES (17, 1, '先');
INSERT INTO core.lexeme_form_kanji_char VALUES (17, 2, '生');
INSERT INTO core.lexeme_form_kanji_char VALUES (18, 1, '先');
INSERT INTO core.lexeme_form_kanji_char VALUES (18, 2, '生');
INSERT INTO core.lexeme_form_kanji_char VALUES (19, 1, '大');
INSERT INTO core.lexeme_form_kanji_char VALUES (20, 1, '大');
INSERT INTO core.lexeme_form_kanji_char VALUES (21, 1, '猫');
INSERT INTO core.lexeme_form_kanji_char VALUES (22, 1, '猫');
INSERT INTO core.lexeme_form_kanji_char VALUES (23, 1, '勉');
INSERT INTO core.lexeme_form_kanji_char VALUES (23, 2, '強');
INSERT INTO core.lexeme_form_kanji_char VALUES (24, 1, '勉');
INSERT INTO core.lexeme_form_kanji_char VALUES (24, 2, '強');


--
-- Data for Name: lexeme_form_tag; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: lexeme_level; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.lexeme_level VALUES (1, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (3, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (5, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (7, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (9, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (11, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (13, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (15, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (17, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (19, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (21, 'JLPT', 3, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.lexeme_level VALUES (23, 'JLPT', 5, 'form_reading', 100, '662e11af-93ae-4262-8c0b-6cf103033702');


--
-- Data for Name: mapping_run; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: media_asset; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: pronunciation; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.pronunciation VALUES (1, 2, 'rʌn', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (2, 1, NULL, 'demo/audio/ja/はしる.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (3, 4, 'iːt', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (4, 3, NULL, 'demo/audio/ja/たべる.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (5, 6, 'ɡoʊ', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (6, 5, NULL, 'demo/audio/ja/いく.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (7, 8, 'ˈwɔːtər', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (8, 7, NULL, 'demo/audio/ja/みず.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (9, 10, 'deɪ', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (10, 9, NULL, 'demo/audio/ja/ひ.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (11, 12, 'bʊk', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (12, 11, NULL, 'demo/audio/ja/ほん.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (13, 14, 'ˈstuːdənt', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (14, 13, NULL, 'demo/audio/ja/がくせい.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (15, 16, 'skuːl', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (16, 15, NULL, 'demo/audio/ja/がっこう.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (17, 18, 'ˈtiːtʃər', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (18, 17, NULL, 'demo/audio/ja/せんせい.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (19, 20, 'bɪɡ', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (20, 19, NULL, 'demo/audio/ja/おおきい.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (21, 22, 'kæt', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (22, 21, NULL, 'demo/audio/ja/ねこ.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (23, 24, 'ˈstʌdi', NULL, 'US', 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.pronunciation VALUES (24, 23, NULL, 'demo/audio/ja/べんきょう.mp3', 'Tokyo', 100, '662e11af-93ae-4262-8c0b-6cf103033702');


--
-- Data for Name: sense; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.sense VALUES (1, 1, 1, 'to run', NULL, NULL, true, 'demo:ja:走る:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (2, 2, 1, 'move fast on foot', NULL, NULL, true, 'demo:en:run:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (3, 1, 2, 'to operate (a business)', NULL, NULL, false, 'demo:ja:走る:2', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (4, 2, 2, 'be in charge of a business', NULL, NULL, false, 'demo:en:run:2', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (5, 3, 1, 'to eat', NULL, NULL, true, 'demo:ja:食べる:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (6, 4, 1, 'take food', NULL, NULL, true, 'demo:en:eat:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (7, 5, 1, 'to go', NULL, NULL, true, 'demo:ja:行く:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (8, 6, 1, 'move to a place', NULL, NULL, true, 'demo:en:go:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (9, 7, 1, 'water', NULL, NULL, true, 'demo:ja:水:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (10, 8, 1, 'liquid essential to life', NULL, NULL, true, 'demo:en:water:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (11, 9, 1, 'day; sun', NULL, NULL, true, 'demo:ja:日:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (12, 10, 1, 'daytime or the sun', NULL, NULL, true, 'demo:en:day:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (13, 11, 1, 'book', NULL, NULL, true, 'demo:ja:本:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (14, 12, 1, 'written work', NULL, NULL, true, 'demo:en:book:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (15, 13, 1, 'student', NULL, NULL, true, 'demo:ja:学生:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (16, 14, 1, 'person who studies', NULL, NULL, true, 'demo:en:student:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (17, 15, 1, 'school', NULL, NULL, true, 'demo:ja:学校:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (18, 16, 1, 'place for learning', NULL, NULL, true, 'demo:en:school:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (19, 17, 1, 'teacher', NULL, NULL, true, 'demo:ja:先生:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (20, 18, 1, 'person who teaches', NULL, NULL, true, 'demo:en:teacher:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (21, 19, 1, 'big; large', NULL, NULL, true, 'demo:ja:大きい:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (22, 20, 1, 'of great size', NULL, NULL, true, 'demo:en:big:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (23, 21, 1, 'cat', NULL, NULL, true, 'demo:ja:猫:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (24, 22, 1, 'small domestic animal', NULL, NULL, true, 'demo:en:cat:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (25, 23, 1, 'study', NULL, NULL, true, 'demo:ja:勉強:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);
INSERT INTO core.sense VALUES (26, 24, 1, 'act of learning', NULL, NULL, true, 'demo:en:study:1', '{}', 100, '662e11af-93ae-4262-8c0b-6cf103033702', 1);


--
-- Data for Name: sense_concept; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.sense_concept VALUES (1, 1, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (2, 1, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (3, 2, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (4, 2, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (5, 3, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (6, 3, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (7, 4, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (8, 4, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (9, 5, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (10, 5, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (11, 6, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (12, 6, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (13, 7, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (14, 7, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (15, 8, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (16, 8, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (17, 9, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (18, 9, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (19, 10, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (20, 10, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (21, 11, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (22, 11, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (23, 12, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (24, 12, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (25, 13, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);
INSERT INTO core.sense_concept VALUES (26, 13, 'exact', 1, 'manual', true, 100, '662e11af-93ae-4262-8c0b-6cf103033702', NULL, NULL);


--
-- Data for Name: sense_concept_candidate; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: sense_concept_candidate_review; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: sense_form; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.sense_form VALUES (1, 1);
INSERT INTO core.sense_form VALUES (1, 2);
INSERT INTO core.sense_form VALUES (3, 1);
INSERT INTO core.sense_form VALUES (3, 2);
INSERT INTO core.sense_form VALUES (5, 3);
INSERT INTO core.sense_form VALUES (5, 4);
INSERT INTO core.sense_form VALUES (7, 5);
INSERT INTO core.sense_form VALUES (7, 6);
INSERT INTO core.sense_form VALUES (9, 7);
INSERT INTO core.sense_form VALUES (9, 8);
INSERT INTO core.sense_form VALUES (11, 9);
INSERT INTO core.sense_form VALUES (11, 10);
INSERT INTO core.sense_form VALUES (13, 11);
INSERT INTO core.sense_form VALUES (13, 12);
INSERT INTO core.sense_form VALUES (15, 13);
INSERT INTO core.sense_form VALUES (15, 14);
INSERT INTO core.sense_form VALUES (17, 15);
INSERT INTO core.sense_form VALUES (17, 16);
INSERT INTO core.sense_form VALUES (19, 17);
INSERT INTO core.sense_form VALUES (19, 18);
INSERT INTO core.sense_form VALUES (21, 19);
INSERT INTO core.sense_form VALUES (21, 20);
INSERT INTO core.sense_form VALUES (23, 21);
INSERT INTO core.sense_form VALUES (23, 22);
INSERT INTO core.sense_form VALUES (25, 23);
INSERT INTO core.sense_form VALUES (25, 24);


--
-- Data for Name: sense_gloss; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.sense_gloss VALUES (1, 1, 1, 'to run', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (2, 1, 3, 'chạy', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (3, 2, 3, 'chạy', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (4, 3, 1, 'to operate (a business)', NULL, true, NULL, NULL, 100, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (5, 3, 3, 'điều hành', NULL, true, NULL, NULL, 100, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (6, 4, 3, 'điều hành', NULL, true, NULL, NULL, 100, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (7, 5, 1, 'to eat', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (8, 5, 3, 'ăn', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (9, 6, 3, 'ăn', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (10, 7, 1, 'to go', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (11, 7, 3, 'đi', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (12, 8, 3, 'đi', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (13, 9, 1, 'water', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (14, 9, 3, 'nước', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (15, 10, 3, 'nước', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (16, 11, 1, 'day; sun', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (17, 11, 3, 'ngày; mặt trời', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (18, 12, 3, 'ngày; mặt trời', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (19, 13, 1, 'book', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (20, 13, 3, 'sách', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (21, 14, 3, 'sách', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (22, 15, 1, 'student', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (23, 15, 3, 'học sinh, sinh viên', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (24, 16, 3, 'học sinh, sinh viên', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (25, 17, 1, 'school', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (26, 17, 3, 'trường học', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (27, 18, 3, 'trường học', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (28, 19, 1, 'teacher', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (29, 19, 3, 'giáo viên', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (30, 20, 3, 'giáo viên', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (31, 21, 1, 'big; large', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (32, 21, 3, 'to lớn', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (33, 22, 3, 'to lớn', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (34, 23, 1, 'cat', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (35, 23, 3, 'con mèo', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (36, 24, 3, 'con mèo', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (37, 25, 1, 'study', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (38, 25, 3, 'học tập', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');
INSERT INTO core.sense_gloss VALUES (39, 26, 3, 'học tập', NULL, false, NULL, NULL, NULL, 1, 100, '662e11af-93ae-4262-8c0b-6cf103033702');


--
-- Data for Name: sense_gloss_history; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: sense_relation; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: sense_relation_candidate; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: sense_tag; Type: TABLE DATA; Schema: core; Owner: -
--

INSERT INTO core.sense_tag VALUES (1, 'v5r');
INSERT INTO core.sense_tag VALUES (2, 'v5r');
INSERT INTO core.sense_tag VALUES (3, 'v5r');
INSERT INTO core.sense_tag VALUES (4, 'v5r');
INSERT INTO core.sense_tag VALUES (5, 'v1');
INSERT INTO core.sense_tag VALUES (6, 'v1');
INSERT INTO core.sense_tag VALUES (7, 'v5k');
INSERT INTO core.sense_tag VALUES (8, 'v5k');
INSERT INTO core.sense_tag VALUES (9, 'n');
INSERT INTO core.sense_tag VALUES (10, 'n');
INSERT INTO core.sense_tag VALUES (11, 'n');
INSERT INTO core.sense_tag VALUES (12, 'n');
INSERT INTO core.sense_tag VALUES (13, 'n');
INSERT INTO core.sense_tag VALUES (14, 'n');
INSERT INTO core.sense_tag VALUES (15, 'n');
INSERT INTO core.sense_tag VALUES (16, 'n');
INSERT INTO core.sense_tag VALUES (17, 'n');
INSERT INTO core.sense_tag VALUES (18, 'n');
INSERT INTO core.sense_tag VALUES (19, 'n');
INSERT INTO core.sense_tag VALUES (20, 'n');
INSERT INTO core.sense_tag VALUES (21, 'adj-i');
INSERT INTO core.sense_tag VALUES (22, 'adj-i');
INSERT INTO core.sense_tag VALUES (23, 'n');
INSERT INTO core.sense_tag VALUES (24, 'n');
INSERT INTO core.sense_tag VALUES (25, 'vs');
INSERT INTO core.sense_tag VALUES (26, 'vs');


--
-- Data for Name: source_entry_identity; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: source_form; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: translation_assertion; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: translation_target_candidate; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: wordnet_relation; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: wordnet_synset; Type: TABLE DATA; Schema: core; Owner: -
--



--
-- Data for Name: language; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.language VALUES (1, 'en', 'Tiếng Anh', 'Latn', true, false);
INSERT INTO public.language VALUES (2, 'ja', 'Tiếng Nhật', 'Jpan', true, false);
INSERT INTO public.language VALUES (3, 'vi', 'Tiếng Việt', 'Latn', false, true);
INSERT INTO public.language VALUES (4, 'zh-Hans', 'Tiếng Trung (giản thể)', 'Hans', true, false);


--
-- Data for Name: radical; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.radical VALUES (10, '儿', 'legs', 'bộ Nhân đi', 'người (biến thể của 人)', 2, '{}');
INSERT INTO public.radical VALUES (19, '力', 'power', 'bộ Lực', 'sức mạnh', 2, '{}');
INSERT INTO public.radical VALUES (37, '大', 'big', 'bộ Đại', 'to lớn', 3, '{}');
INSERT INTO public.radical VALUES (39, '子', 'child', 'bộ Tử', 'con, đứa trẻ', 3, '{}');
INSERT INTO public.radical VALUES (57, '弓', 'bow', 'bộ Cung', 'cái cung', 3, '{}');
INSERT INTO public.radical VALUES (72, '日', 'sun', 'bộ Nhật', 'mặt trời, ngày', 4, '{}');
INSERT INTO public.radical VALUES (75, '木', 'tree', 'bộ Mộc', 'cây', 4, '{}');
INSERT INTO public.radical VALUES (85, '水', 'water', 'bộ Thuỷ', 'nước', 4, '{氵}');
INSERT INTO public.radical VALUES (94, '犬', 'dog', 'bộ Khuyển', 'con chó', 4, '{犭}');
INSERT INTO public.radical VALUES (100, '生', 'life', 'bộ Sinh', 'sinh, sống', 5, '{}');
INSERT INTO public.radical VALUES (144, '行', 'go', 'bộ Hành', 'đi, hàng', 6, '{}');
INSERT INTO public.radical VALUES (156, '走', 'run', 'bộ Tẩu', 'chạy', 7, '{}');
INSERT INTO public.radical VALUES (184, '食', 'eat', 'bộ Thực', 'ăn', 9, '{飠}');


--
-- Data for Name: schema_migration; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.schema_migration VALUES ('001_metadata.sql', '2026-09-26 14:01:59.136668+07');
INSERT INTO public.schema_migration VALUES ('002_staging.sql', '2026-09-26 14:01:59.176828+07');
INSERT INTO public.schema_migration VALUES ('003_staging_indexes.sql', '2026-09-26 14:01:59.290266+07');
INSERT INTO public.schema_migration VALUES ('004_staging_more.sql', '2026-09-26 14:01:59.30314+07');
INSERT INTO public.schema_migration VALUES ('005_core.sql', '2026-09-26 14:01:59.318582+07');
INSERT INTO public.schema_migration VALUES ('006_core_lexeme_forms.sql', '2026-09-26 14:01:59.619633+07');
INSERT INTO public.schema_migration VALUES ('007_core_source_links.sql', '2026-09-26 14:01:59.702162+07');
INSERT INTO public.schema_migration VALUES ('008_extra_levels.sql', '2026-09-26 14:01:59.750658+07');
INSERT INTO public.schema_migration VALUES ('009_mapping_foundation.sql', '2026-09-26 14:01:59.798358+07');
INSERT INTO public.schema_migration VALUES ('010_source_text_and_labels.sql', '2026-09-26 14:01:59.876962+07');
INSERT INTO public.schema_migration VALUES ('011_example_mapping.sql', '2026-09-26 14:01:59.914639+07');
INSERT INTO public.schema_migration VALUES ('012_jlpt_forms_and_chars.sql', '2026-09-26 14:01:59.977379+07');
INSERT INTO public.schema_migration VALUES ('013_translations_and_relations.sql', '2026-09-26 14:02:00.070825+07');
INSERT INTO public.schema_migration VALUES ('014_mapping_storage_trim.sql', '2026-09-26 14:02:00.16924+07');
INSERT INTO public.schema_migration VALUES ('015_wikt_definition_language_backfill.sql', '2026-09-26 14:02:00.176563+07');
INSERT INTO public.schema_migration VALUES ('016_candidate_reviews.sql', '2026-09-26 14:02:00.182824+07');
INSERT INTO public.schema_migration VALUES ('017_app_users_auth.sql', '2026-09-26 14:02:00.21363+07');
INSERT INTO public.schema_migration VALUES ('018_app_collections.sql', '2026-09-26 14:02:00.361779+07');
INSERT INTO public.schema_migration VALUES ('019_app_srs.sql', '2026-09-26 14:02:00.486358+07');
INSERT INTO public.schema_migration VALUES ('020_app_sessions.sql', '2026-09-26 14:02:01.236495+07');
INSERT INTO public.schema_migration VALUES ('021_app_gamification.sql', '2026-09-26 14:02:01.312127+07');
INSERT INTO public.schema_migration VALUES ('022_app_reminders.sql', '2026-09-26 14:02:01.432232+07');
INSERT INTO public.schema_migration VALUES ('023_app_ai.sql', '2026-09-26 14:02:01.480212+07');
INSERT INTO public.schema_migration VALUES ('024_core_reference.sql', '2026-09-26 14:02:01.584675+07');
INSERT INTO public.schema_migration VALUES ('025_serve_models.sql', '2026-09-26 14:02:01.696892+07');


--
-- Data for Name: source; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.source VALUES (1, 'jmdict', 'JMdict (kèm ví dụ Tatoeba)', 'CC BY-SA 4.0', 'Electronic Dictionary Research and Development Group (EDRDG)', 'https://github.com/scriptin/jmdict-simplified/releases', '3.6.2', '8cdbb0cc9625f775cd093e37931974b568221747bf6f2cbaff7b0671b5631ca5', NULL);
INSERT INTO public.source VALUES (2, 'kanjidic2', 'KANJIDIC2', 'CC BY-SA 4.0', 'Electronic Dictionary Research and Development Group (EDRDG)', 'https://github.com/scriptin/jmdict-simplified/releases', '3.6.2', '8f2c7700cd97a79221a0f225a324fa885622be88f321a4c1bb37b4b333d8ee97', NULL);
INSERT INTO public.source VALUES (3, 'kradfile', 'KRADFILE', 'CC BY-SA 4.0', 'Electronic Dictionary Research and Development Group (EDRDG)', 'https://github.com/scriptin/jmdict-simplified/releases', '3.6.2', '90369021899d89159ee6e079bccd7d83915daa3191f0c6ed7efc2473e088c086', NULL);
INSERT INTO public.source VALUES (4, 'cili', 'Collaborative Interlingual Index', 'CC BY 4.0', 'Global WordNet Association', 'https://github.com/globalwordnet/cili', '1.0', '76a86feb1b4945c7572008407a7d2e0049194a19151628f14fba90f2eb995b85', NULL);
INSERT INTO public.source VALUES (5, 'oewn', 'Open English WordNet', 'CC BY 4.0', 'Open English WordNet', 'https://en-word.net/', '2024', '76a86feb1b4945c7572008407a7d2e0049194a19151628f14fba90f2eb995b85', NULL);
INSERT INTO public.source VALUES (6, 'omw-ja', 'Japanese WordNet', 'ghi nguồn', 'NICT Japanese WordNet', 'https://github.com/omwn/omw-data', '1.4', '76a86feb1b4945c7572008407a7d2e0049194a19151628f14fba90f2eb995b85', NULL);
INSERT INTO public.source VALUES (7, 'omw-en', 'OMW English Wordnet (WordNet 3.0)', 'ghi nguồn', 'Open Multilingual Wordnet', 'https://github.com/omwn/omw-data', '1.4', '76a86feb1b4945c7572008407a7d2e0049194a19151628f14fba90f2eb995b85', NULL);
INSERT INTO public.source VALUES (8, 'wiktextract', 'Wiktextract (English)', 'CC BY-SA 4.0', 'Wiktionary contributors / Tatu Ylonen (LREC 2022)', 'https://kaikki.org/dictionary/', NULL, 'de6533a7bc7143167f0b27b4d2b568930436cd20bb5c1ce3cf542c1ec7bbbfec', NULL);
INSERT INTO public.source VALUES (9, 'omw-wikt-vi', 'OMW extended Vietnamese (Wiktionary-derived)', 'CC BY-SA', 'Open Multilingual Wordnet / Wiktionary contributors', 'https://github.com/omwn/omw-data/blob/main/wns/wikt/wn-wikt-vie.tab', NULL, '2f74ee9d80a96aeb44f7639a9cf39d66af69e376f0c7cb8bfa9a7efd87ddbce7', NULL);
INSERT INTO public.source VALUES (10, 'tatoeba', 'Tatoeba sentences', 'CC BY 2.0 FR', 'Tatoeba contributors', 'https://downloads.tatoeba.org/exports/', NULL, 'b4d467dc5108b861bb207927456dd036d5dcb2b549b79360674d5688addae8a5', NULL);
INSERT INTO public.source VALUES (11, 'kanji-data', 'Kanji data (grade/JLPT/frequency)', 'CẦN XÁC MINH', 'davidluzgouveia/kanji-data', 'https://github.com/davidluzgouveia/kanji-data', NULL, '561b72ea9df703c58fae0c68585812e172aaa7611d2fcee6719d55fd2dfd4fa4', NULL);
INSERT INTO public.source VALUES (12, 'jlpt-list', 'JLPT word list N1–N5', 'CẦN XÁC MINH', 'elzup/jlpt-word-list (từ tanos.co.uk)', 'https://github.com/elzup/jlpt-word-list', NULL, '8863a96442adeadfa3510edb84bd60b158ed6b3839172b93cab2ceb026e5ef8a', NULL);
INSERT INTO public.source VALUES (13, 'ili-map-pwn30', 'Ánh xạ PWN 3.0 offset → ILI', 'CC BY 4.0', 'Global WordNet Association (CILI)', 'https://github.com/globalwordnet/cili', NULL, '13b6741395a8bdf20e5a19686ffa49167653696d4f523db17a79dce3211a6627', NULL);
INSERT INTO public.source VALUES (14, 'llm-vi', 'Gloss tiếng Việt do LLM sinh', 'nội bộ', 'Sinh bởi mô hình, chưa kiểm duyệt', NULL, NULL, NULL, NULL);
INSERT INTO public.source VALUES (15, 'wordfreq', 'wordfreq', 'CC BY-SA 4.0', 'wordfreq (RSpeer)', 'https://github.com/rspeer/wordfreq', NULL, NULL, NULL);
INSERT INTO public.source VALUES (16, 'wordnet-stack', 'CILI + OEWN + omw-ja + omw-en (wn.db)', 'nhiều (xem từng wordnet)', 'Global WordNet Association; Open English WordNet; NICT Japanese WordNet', 'https://github.com/goodmami/wn', 'wn 1.1.1', '76a86feb1b4945c7572008407a7d2e0049194a19151628f14fba90f2eb995b85', NULL);
INSERT INTO public.source VALUES (100, 'demo', 'Dữ liệu mẫu phát triển', 'nội bộ', 'Sinh bởi scripts/seed_core_demo.py', NULL, '1', NULL, NULL);


--
-- Data for Name: tag; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tag VALUES ('v5uru', 'misc', 'Godan verb - Uru old class verb (old form of Eru)', NULL, NULL);
INSERT INTO public.tag VALUES ('v2g-s', 'pos', 'Nidan verb (lower class) with ''gu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('dei', 'misc', 'deity', NULL, NULL);
INSERT INTO public.tag VALUES ('ship', 'misc', 'ship name', NULL, NULL);
INSERT INTO public.tag VALUES ('leg', 'misc', 'legend', NULL, NULL);
INSERT INTO public.tag VALUES ('bra', 'dialect', 'Brazilian', NULL, NULL);
INSERT INTO public.tag VALUES ('music', 'field', 'music', NULL, 'âm nhạc');
INSERT INTO public.tag VALUES ('quote', 'misc', 'quotation', NULL, NULL);
INSERT INTO public.tag VALUES ('pref', 'pos', 'prefix', 'prefix', NULL);
INSERT INTO public.tag VALUES ('ktb', 'dialect', 'Kantou-ben', NULL, 'Kantou-ben');
INSERT INTO public.tag VALUES ('rK', 'kanji', 'rarely used kanji form', NULL, NULL);
INSERT INTO public.tag VALUES ('derog', 'misc', 'derogatory', NULL, NULL);
INSERT INTO public.tag VALUES ('abbr', 'misc', 'abbreviation', NULL, NULL);
INSERT INTO public.tag VALUES ('exp', 'pos', 'expressions (phrases, clauses, etc.)', 'expression', NULL);
INSERT INTO public.tag VALUES ('astron', 'field', 'astronomy', NULL, 'thiên văn');
INSERT INTO public.tag VALUES ('v2g-k', 'pos', 'Nidan verb (upper class) with ''gu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('aux-v', 'pos', 'auxiliary verb', 'auxiliary', NULL);
INSERT INTO public.tag VALUES ('ctr', 'pos', 'counter', 'counter', NULL);
INSERT INTO public.tag VALUES ('surg', 'field', 'surgery', NULL, NULL);
INSERT INTO public.tag VALUES ('baseb', 'field', 'baseball', NULL, 'bóng chày');
INSERT INTO public.tag VALUES ('serv', 'misc', 'service', NULL, NULL);
INSERT INTO public.tag VALUES ('genet', 'field', 'genetics', NULL, NULL);
INSERT INTO public.tag VALUES ('geogr', 'field', 'geography', NULL, NULL);
INSERT INTO public.tag VALUES ('dent', 'field', 'dentistry', NULL, NULL);
INSERT INTO public.tag VALUES ('v5k-s', 'pos', 'Godan verb - Iku/Yuku special class', 'verb', NULL);
INSERT INTO public.tag VALUES ('horse', 'field', 'horse racing', NULL, NULL);
INSERT INTO public.tag VALUES ('ornith', 'field', 'ornithology', NULL, NULL);
INSERT INTO public.tag VALUES ('v2w-s', 'pos', 'Nidan verb (lower class) with ''u'' ending and ''we'' conjugation (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('sK', 'kanji', 'search-only kanji form', NULL, NULL);
INSERT INTO public.tag VALUES ('rk', 'kana', 'rarely used kana form', NULL, NULL);
INSERT INTO public.tag VALUES ('hob', 'dialect', 'Hokkaido-ben', NULL, 'Hokuriku-ben');
INSERT INTO public.tag VALUES ('male', 'misc', 'male term or language', NULL, NULL);
INSERT INTO public.tag VALUES ('motor', 'field', 'motorsport', NULL, NULL);
INSERT INTO public.tag VALUES ('vidg', 'field', 'video games', NULL, NULL);
INSERT INTO public.tag VALUES ('n-pref', 'pos', 'noun, used as a prefix', 'prefix', NULL);
INSERT INTO public.tag VALUES ('n-suf', 'pos', 'noun, used as a suffix', 'suffix', NULL);
INSERT INTO public.tag VALUES ('suf', 'pos', 'suffix', 'suffix', NULL);
INSERT INTO public.tag VALUES ('hon', 'misc', 'honorific or respectful (sonkeigo) language', NULL, NULL);
INSERT INTO public.tag VALUES ('biol', 'field', 'biology', NULL, 'sinh học');
INSERT INTO public.tag VALUES ('pol', 'misc', 'polite (teineigo) language', NULL, NULL);
INSERT INTO public.tag VALUES ('vulg', 'misc', 'vulgar expression or word', NULL, NULL);
INSERT INTO public.tag VALUES ('v2n-s', 'pos', 'Nidan verb (lower class) with ''nu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('mil', 'field', 'military', NULL, 'quân sự');
INSERT INTO public.tag VALUES ('golf', 'field', 'golf', NULL, NULL);
INSERT INTO public.tag VALUES ('min', 'field', 'mineralogy', NULL, NULL);
INSERT INTO public.tag VALUES ('X', 'misc', 'rude or X-rated term (not displayed in educational software)', NULL, NULL);
INSERT INTO public.tag VALUES ('sk', 'kana', 'search-only kana form', NULL, NULL);
INSERT INTO public.tag VALUES ('jpmyth', 'field', 'Japanese mythology', NULL, NULL);
INSERT INTO public.tag VALUES ('sl', 'misc', 'slang', NULL, NULL);
INSERT INTO public.tag VALUES ('fict', 'misc', 'fiction', NULL, NULL);
INSERT INTO public.tag VALUES ('art', 'field', 'art, aesthetics', NULL, NULL);
INSERT INTO public.tag VALUES ('stat', 'field', 'statistics', NULL, NULL);
INSERT INTO public.tag VALUES ('cryst', 'field', 'crystallography', NULL, NULL);
INSERT INTO public.tag VALUES ('pathol', 'field', 'pathology', NULL, NULL);
INSERT INTO public.tag VALUES ('photo', 'field', 'photography', NULL, NULL);
INSERT INTO public.tag VALUES ('food', 'field', 'food, cooking', NULL, 'ẩm thực');
INSERT INTO public.tag VALUES ('n', 'pos', 'noun (common) (futsuumeishi)', 'noun', NULL);
INSERT INTO public.tag VALUES ('thb', 'dialect', 'Touhoku-ben', NULL, 'Touhoku-ben');
INSERT INTO public.tag VALUES ('fish', 'field', 'fishing', NULL, NULL);
INSERT INTO public.tag VALUES ('v5r-i', 'pos', 'Godan verb with ''ru'' ending (irregular verb)', 'verb', NULL);
INSERT INTO public.tag VALUES ('arch', 'misc', 'archaic', NULL, NULL);
INSERT INTO public.tag VALUES ('v1', 'pos', 'Ichidan verb', 'verb', NULL);
INSERT INTO public.tag VALUES ('bus', 'field', 'business', NULL, NULL);
INSERT INTO public.tag VALUES ('tv', 'field', 'television', NULL, NULL);
INSERT INTO public.tag VALUES ('euph', 'misc', 'euphemistic', NULL, NULL);
INSERT INTO public.tag VALUES ('embryo', 'field', 'embryology', NULL, NULL);
INSERT INTO public.tag VALUES ('v2y-k', 'pos', 'Nidan verb (upper class) with ''yu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('uk', 'misc', 'word usually written using kana alone', NULL, NULL);
INSERT INTO public.tag VALUES ('rare', 'misc', 'rare term', NULL, NULL);
INSERT INTO public.tag VALUES ('v2a-s', 'pos', 'Nidan verb with ''u'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('hanaf', 'field', 'hanafuda', NULL, NULL);
INSERT INTO public.tag VALUES ('figskt', 'field', 'figure skating', NULL, NULL);
INSERT INTO public.tag VALUES ('agric', 'field', 'agriculture', NULL, NULL);
INSERT INTO public.tag VALUES ('given', 'misc', 'given name or forename, gender not specified', NULL, NULL);
INSERT INTO public.tag VALUES ('physiol', 'field', 'physiology', NULL, NULL);
INSERT INTO public.tag VALUES ('v5u-s', 'pos', 'Godan verb with ''u'' ending (special class)', 'verb', NULL);
INSERT INTO public.tag VALUES ('chn', 'misc', 'children''s language', NULL, NULL);
INSERT INTO public.tag VALUES ('ev', 'misc', 'event', NULL, NULL);
INSERT INTO public.tag VALUES ('adv', 'pos', 'adverb (fukushi)', 'adverb', NULL);
INSERT INTO public.tag VALUES ('prt', 'pos', 'particle', 'particle', NULL);
INSERT INTO public.tag VALUES ('vi', 'pos', 'intransitive verb', 'verb', NULL);
INSERT INTO public.tag VALUES ('v2y-s', 'pos', 'Nidan verb (lower class) with ''yu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('kyb', 'dialect', 'Kyoto-ben', NULL, 'Kyoto-ben');
INSERT INTO public.tag VALUES ('vk', 'pos', 'Kuru verb - special class', 'verb', NULL);
INSERT INTO public.tag VALUES ('grmyth', 'field', 'Greek mythology', NULL, NULL);
INSERT INTO public.tag VALUES ('vn', 'pos', 'irregular nu verb', 'verb', NULL);
INSERT INTO public.tag VALUES ('electr', 'field', 'electronics', NULL, NULL);
INSERT INTO public.tag VALUES ('gardn', 'field', 'gardening, horticulture', NULL, NULL);
INSERT INTO public.tag VALUES ('adj-kari', 'misc', '''kari'' adjective (archaic)', NULL, NULL);
INSERT INTO public.tag VALUES ('vr', 'pos', 'irregular ru verb, plain form ends with -ri', 'verb', NULL);
INSERT INTO public.tag VALUES ('vs', 'pos', 'noun or participle which takes the aux. verb suru', 'verb', NULL);
INSERT INTO public.tag VALUES ('internet', 'field', 'Internet', NULL, NULL);
INSERT INTO public.tag VALUES ('vt', 'pos', 'transitive verb', 'verb', NULL);
INSERT INTO public.tag VALUES ('cards', 'field', 'card games', NULL, NULL);
INSERT INTO public.tag VALUES ('stockm', 'field', 'stock market', NULL, NULL);
INSERT INTO public.tag VALUES ('vz', 'pos', 'Ichidan verb - zuru verb (alternative form of -jiru verbs)', 'verb', NULL);
INSERT INTO public.tag VALUES ('aux', 'pos', 'auxiliary', 'auxiliary', NULL);
INSERT INTO public.tag VALUES ('v2h-s', 'pos', 'Nidan verb (lower class) with ''hu/fu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('kyu', 'dialect', 'Kyuushuu-ben', NULL, NULL);
INSERT INTO public.tag VALUES ('noh', 'field', 'noh', NULL, NULL);
INSERT INTO public.tag VALUES ('econ', 'field', 'economics', NULL, 'kinh tế');
INSERT INTO public.tag VALUES ('rommyth', 'field', 'Roman mythology', NULL, NULL);
INSERT INTO public.tag VALUES ('ecol', 'field', 'ecology', NULL, NULL);
INSERT INTO public.tag VALUES ('n-t', 'misc', 'noun (temporal) (jisoumeishi)', NULL, NULL);
INSERT INTO public.tag VALUES ('psy', 'field', 'psychiatry', NULL, NULL);
INSERT INTO public.tag VALUES ('proverb', 'misc', 'proverb', NULL, NULL);
INSERT INTO public.tag VALUES ('company', 'misc', 'company name', NULL, NULL);
INSERT INTO public.tag VALUES ('poet', 'misc', 'poetical term', NULL, NULL);
INSERT INTO public.tag VALUES ('ateji', 'kanji', 'ateji (phonetic) reading', NULL, NULL);
INSERT INTO public.tag VALUES ('paleo', 'field', 'paleontology', NULL, NULL);
INSERT INTO public.tag VALUES ('v2h-k', 'pos', 'Nidan verb (upper class) with ''hu/fu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('civeng', 'field', 'civil engineering', NULL, NULL);
INSERT INTO public.tag VALUES ('go', 'field', 'go (game)', NULL, NULL);
INSERT INTO public.tag VALUES ('adv-to', 'pos', 'adverb taking the ''to'' particle', 'adverb', NULL);
INSERT INTO public.tag VALUES ('ent', 'field', 'entomology', NULL, NULL);
INSERT INTO public.tag VALUES ('unc', 'pos', 'unclassified', 'unknown', NULL);
INSERT INTO public.tag VALUES ('unclass', 'misc', 'unclassified name', NULL, NULL);
INSERT INTO public.tag VALUES ('on-mim', 'misc', 'onomatopoeic or mimetic word', NULL, NULL);
INSERT INTO public.tag VALUES ('yoji', 'misc', 'yojijukugo', NULL, NULL);
INSERT INTO public.tag VALUES ('n-adv', 'misc', 'adverbial noun (fukushitekimeishi)', NULL, NULL);
INSERT INTO public.tag VALUES ('print', 'field', 'printing', NULL, 'in ấn');
INSERT INTO public.tag VALUES ('form', 'misc', 'formal or literary term', NULL, NULL);
INSERT INTO public.tag VALUES ('obj', 'misc', 'object', NULL, NULL);
INSERT INTO public.tag VALUES ('osb', 'dialect', 'Osaka-ben', NULL, 'Osaka-ben');
INSERT INTO public.tag VALUES ('adj-shiku', 'pos', '''shiku'' adjective (archaic)', 'adjective', NULL);
INSERT INTO public.tag VALUES ('Christn', 'field', 'Christianity', NULL, NULL);
INSERT INTO public.tag VALUES ('hum', 'misc', 'humble (kenjougo) language', NULL, NULL);
INSERT INTO public.tag VALUES ('obs', 'misc', 'obsolete term', NULL, NULL);
INSERT INTO public.tag VALUES ('relig', 'misc', 'religion', NULL, NULL);
INSERT INTO public.tag VALUES ('iK', 'kanji', 'word containing irregular kanji usage', NULL, NULL);
INSERT INTO public.tag VALUES ('v2k-s', 'pos', 'Nidan verb (lower class) with ''ku'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('conj', 'pos', 'conjunction', 'conjunction', NULL);
INSERT INTO public.tag VALUES ('v2s-s', 'pos', 'Nidan verb (lower class) with ''su'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('geol', 'field', 'geology', NULL, 'địa chất');
INSERT INTO public.tag VALUES ('geom', 'field', 'geometry', NULL, NULL);
INSERT INTO public.tag VALUES ('anat', 'field', 'anatomy', NULL, 'giải phẫu');
INSERT INTO public.tag VALUES ('nab', 'dialect', 'Nagano-ben', NULL, NULL);
INSERT INTO public.tag VALUES ('ski', 'field', 'skiing', NULL, NULL);
INSERT INTO public.tag VALUES ('hist', 'misc', 'historical term', NULL, NULL);
INSERT INTO public.tag VALUES ('fam', 'misc', 'familiar language', NULL, NULL);
INSERT INTO public.tag VALUES ('myth', 'misc', 'mythology', NULL, NULL);
INSERT INTO public.tag VALUES ('gramm', 'field', 'grammar', NULL, NULL);
INSERT INTO public.tag VALUES ('v2k-k', 'pos', 'Nidan verb (upper class) with ''ku'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('id', 'misc', 'idiomatic expression', NULL, NULL);
INSERT INTO public.tag VALUES ('v5aru', 'pos', 'Godan verb - -aru special class', 'verb', NULL);
INSERT INTO public.tag VALUES ('psyanal', 'field', 'psychoanalysis', NULL, NULL);
INSERT INTO public.tag VALUES ('comp', 'field', 'computing', NULL, 'tin học');
INSERT INTO public.tag VALUES ('creat', 'misc', 'creature', NULL, NULL);
INSERT INTO public.tag VALUES ('ik', 'kanji', 'word containing irregular kana usage', NULL, NULL);
INSERT INTO public.tag VALUES ('oth', 'misc', 'other', NULL, NULL);
INSERT INTO public.tag VALUES ('v-unspec', 'pos', 'verb unspecified', 'verb', NULL);
INSERT INTO public.tag VALUES ('io', 'kanji', 'irregular okurigana usage', NULL, NULL);
INSERT INTO public.tag VALUES ('work', 'misc', 'work of art, literature, music, etc. name', NULL, NULL);
INSERT INTO public.tag VALUES ('adj-ix', 'pos', 'adjective (keiyoushi) - yoi/ii class', 'adjective', NULL);
INSERT INTO public.tag VALUES ('phil', 'field', 'philosophy', NULL, NULL);
INSERT INTO public.tag VALUES ('doc', 'misc', 'document', NULL, NULL);
INSERT INTO public.tag VALUES ('math', 'field', 'mathematics', NULL, 'toán học');
INSERT INTO public.tag VALUES ('pharm', 'field', 'pharmacology', NULL, NULL);
INSERT INTO public.tag VALUES ('adj-nari', 'pos', 'archaic/formal form of na-adjective', 'adjective', NULL);
INSERT INTO public.tag VALUES ('v2r-k', 'pos', 'Nidan verb (upper class) with ''ru'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('adj-f', 'pos', 'noun or verb acting prenominally', 'adjective', NULL);
INSERT INTO public.tag VALUES ('adj-i', 'pos', 'adjective (keiyoushi)', 'adjective', NULL);
INSERT INTO public.tag VALUES ('audvid', 'field', 'audiovisual', NULL, NULL);
INSERT INTO public.tag VALUES ('rkb', 'dialect', 'Ryuukyuu-ben', NULL, 'Ryukyu-ben');
INSERT INTO public.tag VALUES ('adj-t', 'pos', '''taru'' adjective', 'adjective', NULL);
INSERT INTO public.tag VALUES ('v2r-s', 'pos', 'Nidan verb (lower class) with ''ru'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('Buddh', 'field', 'Buddhism', NULL, 'Phật giáo');
INSERT INTO public.tag VALUES ('biochem', 'field', 'biochemistry', NULL, NULL);
INSERT INTO public.tag VALUES ('v2b-k', 'pos', 'Nidan verb (upper class) with ''bu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('vs-s', 'pos', 'suru verb - special class', 'verb', NULL);
INSERT INTO public.tag VALUES ('surname', 'misc', 'family or surname', NULL, NULL);
INSERT INTO public.tag VALUES ('physics', 'field', 'physics', NULL, 'vật lý');
INSERT INTO public.tag VALUES ('place', 'misc', 'place name', NULL, NULL);
INSERT INTO public.tag VALUES ('v2b-s', 'misc', 'Nidan verb (lower class) with ''bu'' ending (archaic)', NULL, NULL);
INSERT INTO public.tag VALUES ('kabuki', 'field', 'kabuki', NULL, NULL);
INSERT INTO public.tag VALUES ('prowres', 'field', 'professional wrestling', NULL, NULL);
INSERT INTO public.tag VALUES ('product', 'misc', 'product name', NULL, NULL);
INSERT INTO public.tag VALUES ('vs-c', 'pos', 'su verb - precursor to the modern suru', 'verb', NULL);
INSERT INTO public.tag VALUES ('tsug', 'dialect', 'Tsugaru-ben', NULL, NULL);
INSERT INTO public.tag VALUES ('adj-ku', 'pos', '''ku'' adjective (archaic)', 'adjective', NULL);
INSERT INTO public.tag VALUES ('telec', 'field', 'telecommunications', NULL, NULL);
INSERT INTO public.tag VALUES ('vs-i', 'pos', 'suru verb - included', 'verb', NULL);
INSERT INTO public.tag VALUES ('v2z-s', 'pos', 'Nidan verb (lower class) with ''zu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('organization', 'misc', 'organization name', NULL, NULL);
INSERT INTO public.tag VALUES ('char', 'misc', 'character', NULL, NULL);
INSERT INTO public.tag VALUES ('engr', 'field', 'engineering', NULL, NULL);
INSERT INTO public.tag VALUES ('logic', 'field', 'logic', NULL, NULL);
INSERT INTO public.tag VALUES ('v2m-s', 'pos', 'Nidan verb (lower class) with ''mu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('col', 'misc', 'colloquial', NULL, NULL);
INSERT INTO public.tag VALUES ('archeol', 'field', 'archeology', NULL, NULL);
INSERT INTO public.tag VALUES ('cop', 'pos', 'copula', 'auxiliary', NULL);
INSERT INTO public.tag VALUES ('num', 'pos', 'numeric', 'noun', NULL);
INSERT INTO public.tag VALUES ('aviat', 'field', 'aviation', NULL, NULL);
INSERT INTO public.tag VALUES ('aux-adj', 'pos', 'auxiliary adjective', 'auxiliary', NULL);
INSERT INTO public.tag VALUES ('m-sl', 'misc', 'manga slang', NULL, NULL);
INSERT INTO public.tag VALUES ('fem', 'misc', 'female term or language', NULL, NULL);
INSERT INTO public.tag VALUES ('MA', 'field', 'martial arts', NULL, 'võ thuật');
INSERT INTO public.tag VALUES ('finc', 'field', 'finance', NULL, NULL);
INSERT INTO public.tag VALUES ('v1-s', 'pos', 'Ichidan verb - kureru special class', 'verb', NULL);
INSERT INTO public.tag VALUES ('v2m-k', 'misc', 'Nidan verb (upper class) with ''mu'' ending (archaic)', NULL, NULL);
INSERT INTO public.tag VALUES ('manga', 'field', 'manga', NULL, NULL);
INSERT INTO public.tag VALUES ('shogi', 'field', 'shogi', NULL, 'shogi');
INSERT INTO public.tag VALUES ('group', 'misc', 'group', NULL, NULL);
INSERT INTO public.tag VALUES ('adj-no', 'pos', 'nouns which may take the genitive case particle ''no''', 'adjective', NULL);
INSERT INTO public.tag VALUES ('adj-na', 'pos', 'adjectival nouns or quasi-adjectives (keiyodoshi)', 'adjective', NULL);
INSERT INTO public.tag VALUES ('sens', 'misc', 'sensitive', NULL, NULL);
INSERT INTO public.tag VALUES ('law', 'field', 'law', NULL, 'luật');
INSERT INTO public.tag VALUES ('vet', 'field', 'veterinary terms', NULL, NULL);
INSERT INTO public.tag VALUES ('mahj', 'field', 'mahjong', NULL, NULL);
INSERT INTO public.tag VALUES ('v4b', 'pos', 'Yodan verb with ''bu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('rail', 'field', 'railway', NULL, NULL);
INSERT INTO public.tag VALUES ('v4g', 'pos', 'Yodan verb with ''gu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('elec', 'field', 'electricity, elec. eng.', NULL, NULL);
INSERT INTO public.tag VALUES ('film', 'field', 'film', NULL, NULL);
INSERT INTO public.tag VALUES ('mining', 'field', 'mining', NULL, NULL);
INSERT INTO public.tag VALUES ('v4h', 'pos', 'Yodan verb with ''hu/fu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('v4k', 'pos', 'Yodan verb with ''ku'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('v4m', 'pos', 'Yodan verb with ''mu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('v4n', 'misc', 'Yodan verb with ''nu'' ending (archaic)', NULL, NULL);
INSERT INTO public.tag VALUES ('sumo', 'field', 'sumo', NULL, 'sumo');
INSERT INTO public.tag VALUES ('v4s', 'pos', 'Yodan verb with ''su'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('v4r', 'pos', 'Yodan verb with ''ru'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('person', 'misc', 'full name of a particular person', NULL, NULL);
INSERT INTO public.tag VALUES ('v4t', 'pos', 'Yodan verb with ''tsu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('boxing', 'field', 'boxing', NULL, NULL);
INSERT INTO public.tag VALUES ('oK', 'kanji', 'word containing out-dated kanji or kanji usage', NULL, NULL);
INSERT INTO public.tag VALUES ('cloth', 'field', 'clothing', NULL, NULL);
INSERT INTO public.tag VALUES ('joc', 'misc', 'jocular, humorous term', NULL, NULL);
INSERT INTO public.tag VALUES ('politics', 'field', 'politics', NULL, NULL);
INSERT INTO public.tag VALUES ('v2t-k', 'pos', 'Nidan verb (upper class) with ''tsu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('tsb', 'dialect', 'Tosa-ben', NULL, NULL);
INSERT INTO public.tag VALUES ('v5b', 'pos', 'Godan verb with ''bu'' ending', 'verb', NULL);
INSERT INTO public.tag VALUES ('ling', 'field', 'linguistics', NULL, 'ngôn ngữ học');
INSERT INTO public.tag VALUES ('bot', 'field', 'botany', NULL, 'thực vật học');
INSERT INTO public.tag VALUES ('v2t-s', 'pos', 'Nidan verb (lower class) with ''tsu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('v5g', 'pos', 'Godan verb with ''gu'' ending', 'verb', NULL);
INSERT INTO public.tag VALUES ('med', 'field', 'medicine', NULL, 'y học');
INSERT INTO public.tag VALUES ('v5k', 'pos', 'Godan verb with ''ku'' ending', 'verb', NULL);
INSERT INTO public.tag VALUES ('mech', 'field', 'mechanical engineering', NULL, NULL);
INSERT INTO public.tag VALUES ('v5n', 'pos', 'Godan verb with ''nu'' ending', 'verb', NULL);
INSERT INTO public.tag VALUES ('v5m', 'pos', 'Godan verb with ''mu'' ending', 'verb', NULL);
INSERT INTO public.tag VALUES ('v2d-k', 'misc', 'Nidan verb (upper class) with ''dzu'' ending (archaic)', NULL, NULL);
INSERT INTO public.tag VALUES ('v5r', 'pos', 'Godan verb with ''ru'' ending', 'verb', NULL);
INSERT INTO public.tag VALUES ('v5t', 'pos', 'Godan verb with ''tsu'' ending', 'verb', NULL);
INSERT INTO public.tag VALUES ('v5s', 'pos', 'Godan verb with ''su'' ending', 'verb', NULL);
INSERT INTO public.tag VALUES ('v5u', 'pos', 'Godan verb with ''u'' ending', 'verb', NULL);
INSERT INTO public.tag VALUES ('Shinto', 'field', 'Shinto', NULL, NULL);
INSERT INTO public.tag VALUES ('station', 'misc', 'railway station', NULL, NULL);
INSERT INTO public.tag VALUES ('chmyth', 'field', 'Chinese mythology', NULL, NULL);
INSERT INTO public.tag VALUES ('dated', 'misc', 'dated term', NULL, NULL);
INSERT INTO public.tag VALUES ('v2d-s', 'pos', 'Nidan verb (lower class) with ''dzu'' ending (archaic)', 'verb', NULL);
INSERT INTO public.tag VALUES ('psych', 'field', 'psychology', NULL, NULL);
INSERT INTO public.tag VALUES ('adj-pn', 'pos', 'pre-noun adjectival (rentaishi)', 'adjective', NULL);
INSERT INTO public.tag VALUES ('ok', 'kana', 'out-dated or obsolete kana usage', NULL, NULL);
INSERT INTO public.tag VALUES ('met', 'field', 'meteorology', NULL, NULL);
INSERT INTO public.tag VALUES ('chem', 'field', 'chemistry', NULL, 'hoá học');
INSERT INTO public.tag VALUES ('sports', 'field', 'sports', NULL, 'thể thao');
INSERT INTO public.tag VALUES ('zool', 'field', 'zoology', NULL, 'động vật học');
INSERT INTO public.tag VALUES ('int', 'pos', 'interjection (kandoushi)', 'interjection', NULL);
INSERT INTO public.tag VALUES ('tradem', 'field', 'trademark', NULL, NULL);
INSERT INTO public.tag VALUES ('net-sl', 'misc', 'Internet slang', NULL, NULL);
INSERT INTO public.tag VALUES ('n-pr', 'misc', 'proper noun', NULL, NULL);
INSERT INTO public.tag VALUES ('archit', 'field', 'architecture', NULL, NULL);
INSERT INTO public.tag VALUES ('ksb', 'dialect', 'Kansai-ben', NULL, 'Kansai-ben');
INSERT INTO public.tag VALUES ('pn', 'pos', 'pronoun', 'pronoun', NULL);
INSERT INTO public.tag VALUES ('gikun', 'kana', 'gikun (meaning as reading) or jukujikun (special kanji reading)', NULL, NULL);


--
-- Data for Name: ili_map_pwn30; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: import_batch; Type: TABLE DATA; Schema: staging; Owner: -
--

INSERT INTO staging.import_batch VALUES ('e5b3854d-7c98-443f-b0bf-bc0ad03ee5ff', 'demo', 'seed_core_demo.py', 'demo', 12, '2026-09-26 14:06:45.703676+07', '2026-09-26 14:06:45.703676+07', 'done', NULL);
INSERT INTO staging.import_batch VALUES ('662e11af-93ae-4262-8c0b-6cf103033702', 'demo', 'seed_core_demo.py', 'demo', 12, '2026-09-26 14:07:33.199548+07', '2026-09-26 14:07:33.199548+07', 'done', NULL);


--
-- Data for Name: jlpt_entry; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: jmdict_entry; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: kanji_data_entry; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: kanji_entry; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: krad_entry; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: omw_wikt_vi; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: tatoeba_link; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: tatoeba_sentence; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: wikt_entry; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: wn_example; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: wn_relation; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Data for Name: wn_synset; Type: TABLE DATA; Schema: staging; Owner: -
--



--
-- Name: chat_message_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.chat_message_id_seq', 6, true);


--
-- Name: gloss_report_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.gloss_report_id_seq', 3, true);


--
-- Name: notification_log_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.notification_log_id_seq', 3, true);


--
-- Name: quiz_question_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.quiz_question_id_seq', 5, true);


--
-- Name: review_log_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.review_log_id_seq', 27, true);


--
-- Name: search_history_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.search_history_id_seq', 4, true);


--
-- Name: srs_state_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.srs_state_id_seq', 26, true);


--
-- Name: study_session_item_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.study_session_item_id_seq', 3, true);


--
-- Name: tag_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.tag_id_seq', 7, true);


--
-- Name: user_identity_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.user_identity_id_seq', 5, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.users_id_seq', 5, true);


--
-- Name: xp_event_id_seq; Type: SEQUENCE SET; Schema: app; Owner: -
--

SELECT pg_catalog.setval('app.xp_event_id_seq', 15, true);


--
-- Name: concept_gloss_history_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.concept_gloss_history_id_seq', 1, false);


--
-- Name: concept_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.concept_id_seq', 13, true);


--
-- Name: concept_label_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.concept_label_id_seq', 1, false);


--
-- Name: deck_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.deck_id_seq', 2, true);


--
-- Name: example_annotation_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.example_annotation_id_seq', 1, false);


--
-- Name: example_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.example_id_seq', 24, true);


--
-- Name: jlpt_link_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.jlpt_link_id_seq', 1, false);


--
-- Name: lexeme_form_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.lexeme_form_id_seq', 24, true);


--
-- Name: lexeme_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.lexeme_id_seq', 24, true);


--
-- Name: mapping_run_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.mapping_run_id_seq', 1, false);


--
-- Name: media_asset_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.media_asset_id_seq', 1, false);


--
-- Name: pronunciation_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.pronunciation_id_seq', 24, true);


--
-- Name: sense_concept_candidate_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.sense_concept_candidate_id_seq', 1, false);


--
-- Name: sense_concept_candidate_review_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.sense_concept_candidate_review_id_seq', 1, false);


--
-- Name: sense_gloss_history_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.sense_gloss_history_id_seq', 1, false);


--
-- Name: sense_gloss_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.sense_gloss_id_seq', 39, true);


--
-- Name: sense_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.sense_id_seq', 26, true);


--
-- Name: sense_relation_candidate_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.sense_relation_candidate_id_seq', 1, false);


--
-- Name: source_entry_identity_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.source_entry_identity_id_seq', 1, false);


--
-- Name: source_form_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.source_form_id_seq', 1, false);


--
-- Name: translation_assertion_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.translation_assertion_id_seq', 1, false);


--
-- Name: translation_target_candidate_id_seq; Type: SEQUENCE SET; Schema: core; Owner: -
--

SELECT pg_catalog.setval('core.translation_target_candidate_id_seq', 1, false);


--
-- Name: wikt_entry_id_seq; Type: SEQUENCE SET; Schema: staging; Owner: -
--

SELECT pg_catalog.setval('staging.wikt_entry_id_seq', 1, false);


--
-- Name: achievement achievement_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.achievement
    ADD CONSTRAINT achievement_pkey PRIMARY KEY (code);


--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (user_id, period, feature);


--
-- Name: chat_message chat_message_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.chat_message
    ADD CONSTRAINT chat_message_pkey PRIMARY KEY (id);


--
-- Name: chat_session chat_session_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.chat_session
    ADD CONSTRAINT chat_session_pkey PRIMARY KEY (id);


--
-- Name: collection_item collection_item_collection_id_anchor_sense_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item
    ADD CONSTRAINT collection_item_collection_id_anchor_sense_id_key UNIQUE (collection_id, anchor_sense_id);


--
-- Name: collection_item_face collection_item_face_item_id_language_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item_face
    ADD CONSTRAINT collection_item_face_item_id_language_id_key UNIQUE (item_id, language_id);


--
-- Name: collection_item_face collection_item_face_item_id_sense_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item_face
    ADD CONSTRAINT collection_item_face_item_id_sense_id_key UNIQUE (item_id, sense_id);


--
-- Name: collection_item_face collection_item_face_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item_face
    ADD CONSTRAINT collection_item_face_pkey PRIMARY KEY (id);


--
-- Name: collection_item collection_item_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item
    ADD CONSTRAINT collection_item_pkey PRIMARY KEY (id);


--
-- Name: collection_item_tag collection_item_tag_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item_tag
    ADD CONSTRAINT collection_item_tag_pkey PRIMARY KEY (item_id, tag_id);


--
-- Name: collection collection_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection
    ADD CONSTRAINT collection_pkey PRIMARY KEY (id);


--
-- Name: collection_share collection_share_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_share
    ADD CONSTRAINT collection_share_pkey PRIMARY KEY (id);


--
-- Name: collection_share collection_share_token_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_share
    ADD CONSTRAINT collection_share_token_key UNIQUE (token);


--
-- Name: device device_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.device
    ADD CONSTRAINT device_pkey PRIMARY KEY (id);


--
-- Name: gloss_report gloss_report_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.gloss_report
    ADD CONSTRAINT gloss_report_pkey PRIMARY KEY (id);


--
-- Name: leaderboard_snapshot leaderboard_snapshot_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.leaderboard_snapshot
    ADD CONSTRAINT leaderboard_snapshot_pkey PRIMARY KEY (period_start, scope, user_id);


--
-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (id);


--
-- Name: quiz quiz_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz
    ADD CONSTRAINT quiz_pkey PRIMARY KEY (id);


--
-- Name: quiz_question quiz_question_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz_question
    ADD CONSTRAINT quiz_question_pkey PRIMARY KEY (id);


--
-- Name: quiz_question quiz_question_quiz_id_ordinal_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz_question
    ADD CONSTRAINT quiz_question_quiz_id_ordinal_key UNIQUE (quiz_id, ordinal);


--
-- Name: reminder reminder_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.reminder
    ADD CONSTRAINT reminder_pkey PRIMARY KEY (id);


--
-- Name: review_log review_log_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log
    ADD CONSTRAINT review_log_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2026_09 review_log_2026_09_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2026_09
    ADD CONSTRAINT review_log_2026_09_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2026_10 review_log_2026_10_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2026_10
    ADD CONSTRAINT review_log_2026_10_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2026_11 review_log_2026_11_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2026_11
    ADD CONSTRAINT review_log_2026_11_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2026_12 review_log_2026_12_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2026_12
    ADD CONSTRAINT review_log_2026_12_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_01 review_log_2027_01_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_01
    ADD CONSTRAINT review_log_2027_01_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_02 review_log_2027_02_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_02
    ADD CONSTRAINT review_log_2027_02_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_03 review_log_2027_03_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_03
    ADD CONSTRAINT review_log_2027_03_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_04 review_log_2027_04_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_04
    ADD CONSTRAINT review_log_2027_04_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_05 review_log_2027_05_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_05
    ADD CONSTRAINT review_log_2027_05_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_06 review_log_2027_06_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_06
    ADD CONSTRAINT review_log_2027_06_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_07 review_log_2027_07_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_07
    ADD CONSTRAINT review_log_2027_07_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_08 review_log_2027_08_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_08
    ADD CONSTRAINT review_log_2027_08_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_09 review_log_2027_09_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_09
    ADD CONSTRAINT review_log_2027_09_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_10 review_log_2027_10_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_10
    ADD CONSTRAINT review_log_2027_10_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_11 review_log_2027_11_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_11
    ADD CONSTRAINT review_log_2027_11_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2027_12 review_log_2027_12_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2027_12
    ADD CONSTRAINT review_log_2027_12_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_01 review_log_2028_01_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_01
    ADD CONSTRAINT review_log_2028_01_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_02 review_log_2028_02_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_02
    ADD CONSTRAINT review_log_2028_02_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_03 review_log_2028_03_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_03
    ADD CONSTRAINT review_log_2028_03_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_04 review_log_2028_04_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_04
    ADD CONSTRAINT review_log_2028_04_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_05 review_log_2028_05_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_05
    ADD CONSTRAINT review_log_2028_05_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_06 review_log_2028_06_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_06
    ADD CONSTRAINT review_log_2028_06_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_07 review_log_2028_07_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_07
    ADD CONSTRAINT review_log_2028_07_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_08 review_log_2028_08_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_08
    ADD CONSTRAINT review_log_2028_08_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_09 review_log_2028_09_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_09
    ADD CONSTRAINT review_log_2028_09_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_10 review_log_2028_10_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_10
    ADD CONSTRAINT review_log_2028_10_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_11 review_log_2028_11_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_11
    ADD CONSTRAINT review_log_2028_11_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2028_12 review_log_2028_12_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2028_12
    ADD CONSTRAINT review_log_2028_12_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2029_01 review_log_2029_01_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2029_01
    ADD CONSTRAINT review_log_2029_01_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2029_02 review_log_2029_02_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2029_02
    ADD CONSTRAINT review_log_2029_02_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2029_03 review_log_2029_03_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2029_03
    ADD CONSTRAINT review_log_2029_03_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2029_04 review_log_2029_04_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2029_04
    ADD CONSTRAINT review_log_2029_04_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2029_05 review_log_2029_05_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2029_05
    ADD CONSTRAINT review_log_2029_05_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2029_06 review_log_2029_06_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2029_06
    ADD CONSTRAINT review_log_2029_06_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2029_07 review_log_2029_07_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2029_07
    ADD CONSTRAINT review_log_2029_07_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: review_log_2029_08 review_log_2029_08_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.review_log_2029_08
    ADD CONSTRAINT review_log_2029_08_pkey PRIMARY KEY (id, reviewed_at);


--
-- Name: search_history search_history_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.search_history
    ADD CONSTRAINT search_history_pkey PRIMARY KEY (id);


--
-- Name: srs_state srs_state_face_id_direction_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.srs_state
    ADD CONSTRAINT srs_state_face_id_direction_key UNIQUE (face_id, direction);


--
-- Name: srs_state srs_state_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.srs_state
    ADD CONSTRAINT srs_state_pkey PRIMARY KEY (id);


--
-- Name: streak_day streak_day_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.streak_day
    ADD CONSTRAINT streak_day_pkey PRIMARY KEY (user_id, day);


--
-- Name: study_profile study_profile_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_profile
    ADD CONSTRAINT study_profile_pkey PRIMARY KEY (id);


--
-- Name: study_session_item study_session_item_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session_item
    ADD CONSTRAINT study_session_item_pkey PRIMARY KEY (id);


--
-- Name: study_session_item study_session_item_session_id_ordinal_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session_item
    ADD CONSTRAINT study_session_item_session_id_ordinal_key UNIQUE (session_id, ordinal);


--
-- Name: study_session study_session_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session
    ADD CONSTRAINT study_session_pkey PRIMARY KEY (id);


--
-- Name: tag tag_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.tag
    ADD CONSTRAINT tag_pkey PRIMARY KEY (id);


--
-- Name: user_achievement user_achievement_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_achievement
    ADD CONSTRAINT user_achievement_pkey PRIMARY KEY (user_id, achievement_code);


--
-- Name: user_identity user_identity_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_identity
    ADD CONSTRAINT user_identity_pkey PRIMARY KEY (id);


--
-- Name: user_identity user_identity_provider_provider_uid_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_identity
    ADD CONSTRAINT user_identity_provider_provider_uid_key UNIQUE (provider, provider_uid);


--
-- Name: user_session user_session_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_session
    ADD CONSTRAINT user_session_pkey PRIMARY KEY (id);


--
-- Name: user_session user_session_refresh_token_hash_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_session
    ADD CONSTRAINT user_session_refresh_token_hash_key UNIQUE (refresh_token_hash);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);


--
-- Name: user_stats user_stats_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_stats
    ADD CONSTRAINT user_stats_pkey PRIMARY KEY (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: xp_event xp_event_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.xp_event
    ADD CONSTRAINT xp_event_pkey PRIMARY KEY (id);


--
-- Name: xp_event xp_event_user_id_idempotency_key_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.xp_event
    ADD CONSTRAINT xp_event_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key);


--
-- Name: xp_rule xp_rule_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.xp_rule
    ADD CONSTRAINT xp_rule_pkey PRIMARY KEY (code);


--
-- Name: concept_gloss_history concept_gloss_history_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_gloss_history
    ADD CONSTRAINT concept_gloss_history_pkey PRIMARY KEY (id);


--
-- Name: concept_gloss concept_gloss_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_gloss
    ADD CONSTRAINT concept_gloss_pkey PRIMARY KEY (concept_id, language_id, rank);


--
-- Name: concept concept_ili_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept
    ADD CONSTRAINT concept_ili_key UNIQUE (ili);


--
-- Name: concept_label concept_label_concept_id_language_id_rank_label_kind_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_label
    ADD CONSTRAINT concept_label_concept_id_language_id_rank_label_kind_key UNIQUE (concept_id, language_id, rank, label_kind);


--
-- Name: concept_label concept_label_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_label
    ADD CONSTRAINT concept_label_pkey PRIMARY KEY (id);


--
-- Name: concept concept_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept
    ADD CONSTRAINT concept_pkey PRIMARY KEY (id);


--
-- Name: deck_item deck_item_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.deck_item
    ADD CONSTRAINT deck_item_pkey PRIMARY KEY (deck_id, anchor_sense_id);


--
-- Name: deck deck_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.deck
    ADD CONSTRAINT deck_pkey PRIMARY KEY (id);


--
-- Name: deck deck_slug_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.deck
    ADD CONSTRAINT deck_slug_key UNIQUE (slug);


--
-- Name: example_annotation example_annotation_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_annotation
    ADD CONSTRAINT example_annotation_pkey PRIMARY KEY (id);


--
-- Name: example_annotation example_annotation_source_example_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_annotation
    ADD CONSTRAINT example_annotation_source_example_id_key UNIQUE (source_example_id);


--
-- Name: example_concept example_concept_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_concept
    ADD CONSTRAINT example_concept_pkey PRIMARY KEY (example_id, concept_id);


--
-- Name: example example_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example
    ADD CONSTRAINT example_pkey PRIMARY KEY (id);


--
-- Name: example_sense example_sense_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_sense
    ADD CONSTRAINT example_sense_pkey PRIMARY KEY (example_id, sense_id);


--
-- Name: example_translation example_translation_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_translation
    ADD CONSTRAINT example_translation_pkey PRIMARY KEY (example_id, translation_id);


--
-- Name: jlpt_link jlpt_link_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.jlpt_link
    ADD CONSTRAINT jlpt_link_pkey PRIMARY KEY (id);


--
-- Name: jlpt_link jlpt_link_source_level_source_row_number_variant_index_lexe_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.jlpt_link
    ADD CONSTRAINT jlpt_link_source_level_source_row_number_variant_index_lexe_key UNIQUE (source_level, source_row_number, variant_index, lexeme_id);


--
-- Name: kanji_media kanji_media_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji_media
    ADD CONSTRAINT kanji_media_pkey PRIMARY KEY (kanji_literal, kind);


--
-- Name: kanji kanji_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji
    ADD CONSTRAINT kanji_pkey PRIMARY KEY (literal);


--
-- Name: kanji_radical kanji_radical_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji_radical
    ADD CONSTRAINT kanji_radical_pkey PRIMARY KEY (kanji_literal, part);


--
-- Name: lexeme lexeme_external_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme
    ADD CONSTRAINT lexeme_external_id_key UNIQUE (external_id);


--
-- Name: lexeme_form_applies_to lexeme_form_applies_to_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_applies_to
    ADD CONSTRAINT lexeme_form_applies_to_pkey PRIMARY KEY (form_id, target_form_id);


--
-- Name: lexeme_form_char lexeme_form_char_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_char
    ADD CONSTRAINT lexeme_form_char_pkey PRIMARY KEY (form_id, char_position);


--
-- Name: lexeme_form_kanji_char lexeme_form_kanji_char_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_kanji_char
    ADD CONSTRAINT lexeme_form_kanji_char_pkey PRIMARY KEY (form_id, char_position);


--
-- Name: lexeme_form lexeme_form_order_unique; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form
    ADD CONSTRAINT lexeme_form_order_unique UNIQUE (lexeme_id, kind, form_order);


--
-- Name: lexeme_form lexeme_form_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form
    ADD CONSTRAINT lexeme_form_pkey PRIMARY KEY (id);


--
-- Name: lexeme_form_tag lexeme_form_tag_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_tag
    ADD CONSTRAINT lexeme_form_tag_pkey PRIMARY KEY (form_id, tag_code);


--
-- Name: lexeme_form lexeme_form_text_unique; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form
    ADD CONSTRAINT lexeme_form_text_unique UNIQUE (lexeme_id, kind, form_text);


--
-- Name: lexeme_level lexeme_level_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_level
    ADD CONSTRAINT lexeme_level_pkey PRIMARY KEY (lexeme_id, scheme);


--
-- Name: lexeme lexeme_natural_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme
    ADD CONSTRAINT lexeme_natural_key UNIQUE (language_id, lemma, pos, homograph_no);


--
-- Name: lexeme lexeme_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme
    ADD CONSTRAINT lexeme_pkey PRIMARY KEY (id);


--
-- Name: mapping_run mapping_run_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.mapping_run
    ADD CONSTRAINT mapping_run_pkey PRIMARY KEY (id);


--
-- Name: mapping_run mapping_run_run_key_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.mapping_run
    ADD CONSTRAINT mapping_run_run_key_key UNIQUE (run_key);


--
-- Name: media_asset media_asset_object_key_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.media_asset
    ADD CONSTRAINT media_asset_object_key_key UNIQUE (object_key);


--
-- Name: media_asset media_asset_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.media_asset
    ADD CONSTRAINT media_asset_pkey PRIMARY KEY (id);


--
-- Name: pronunciation pronunciation_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.pronunciation
    ADD CONSTRAINT pronunciation_pkey PRIMARY KEY (id);


--
-- Name: sense_concept_candidate sense_concept_candidate_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept_candidate
    ADD CONSTRAINT sense_concept_candidate_pkey PRIMARY KEY (id);


--
-- Name: sense_concept_candidate_review sense_concept_candidate_revie_candidate_id_mapping_run_id_r_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept_candidate_review
    ADD CONSTRAINT sense_concept_candidate_revie_candidate_id_mapping_run_id_r_key UNIQUE (candidate_id, mapping_run_id, reviewer_kind, reviewer);


--
-- Name: sense_concept_candidate_review sense_concept_candidate_review_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept_candidate_review
    ADD CONSTRAINT sense_concept_candidate_review_pkey PRIMARY KEY (id);


--
-- Name: sense_concept_candidate sense_concept_candidate_run_id_sense_id_concept_id_relation_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept_candidate
    ADD CONSTRAINT sense_concept_candidate_run_id_sense_id_concept_id_relation_key UNIQUE (run_id, sense_id, concept_id, relation);


--
-- Name: sense_concept sense_concept_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept
    ADD CONSTRAINT sense_concept_pkey PRIMARY KEY (sense_id, concept_id);


--
-- Name: sense sense_external_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense
    ADD CONSTRAINT sense_external_id_key UNIQUE (external_id);


--
-- Name: sense_form sense_form_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_form
    ADD CONSTRAINT sense_form_pkey PRIMARY KEY (sense_id, form_id);


--
-- Name: sense_gloss_history sense_gloss_history_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_gloss_history
    ADD CONSTRAINT sense_gloss_history_pkey PRIMARY KEY (id);


--
-- Name: sense_gloss sense_gloss_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_gloss
    ADD CONSTRAINT sense_gloss_pkey PRIMARY KEY (id);


--
-- Name: sense_gloss sense_gloss_slot; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_gloss
    ADD CONSTRAINT sense_gloss_slot UNIQUE (sense_id, language_id, rank);


--
-- Name: sense sense_order_per_lexeme; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense
    ADD CONSTRAINT sense_order_per_lexeme UNIQUE (lexeme_id, sense_no);


--
-- Name: sense sense_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense
    ADD CONSTRAINT sense_pkey PRIMARY KEY (id);


--
-- Name: sense_relation_candidate sense_relation_candidate_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation_candidate
    ADD CONSTRAINT sense_relation_candidate_pkey PRIMARY KEY (id);


--
-- Name: sense_relation_candidate sense_relation_candidate_source_key_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation_candidate
    ADD CONSTRAINT sense_relation_candidate_source_key_key UNIQUE (source_key);


--
-- Name: sense_relation sense_relation_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation
    ADD CONSTRAINT sense_relation_pkey PRIMARY KEY (source_sense_id, target_sense_id, relation);


--
-- Name: sense_tag sense_tag_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_tag
    ADD CONSTRAINT sense_tag_pkey PRIMARY KEY (sense_id, tag_code);


--
-- Name: source_entry_identity source_entry_identity_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.source_entry_identity
    ADD CONSTRAINT source_entry_identity_pkey PRIMARY KEY (id);


--
-- Name: source_entry_identity source_entry_identity_source_id_source_snapshot_source_exte_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.source_entry_identity
    ADD CONSTRAINT source_entry_identity_source_id_source_snapshot_source_exte_key UNIQUE (source_id, source_snapshot, source_external_id);


--
-- Name: source_form source_form_lexeme_id_form_text_form_kind_source_ordinal_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.source_form
    ADD CONSTRAINT source_form_lexeme_id_form_text_form_kind_source_ordinal_key UNIQUE (lexeme_id, form_text, form_kind, source_ordinal);


--
-- Name: source_form source_form_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.source_form
    ADD CONSTRAINT source_form_pkey PRIMARY KEY (id);


--
-- Name: translation_assertion translation_assertion_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_assertion
    ADD CONSTRAINT translation_assertion_pkey PRIMARY KEY (id);


--
-- Name: translation_assertion translation_assertion_source_key_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_assertion
    ADD CONSTRAINT translation_assertion_source_key_key UNIQUE (source_key);


--
-- Name: translation_target_candidate translation_target_candidate_assertion_id_target_lexeme_id__key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_target_candidate
    ADD CONSTRAINT translation_target_candidate_assertion_id_target_lexeme_id__key UNIQUE (assertion_id, target_lexeme_id, target_sense_id, match_method);


--
-- Name: translation_target_candidate translation_target_candidate_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_target_candidate
    ADD CONSTRAINT translation_target_candidate_pkey PRIMARY KEY (id);


--
-- Name: wordnet_relation wordnet_relation_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.wordnet_relation
    ADD CONSTRAINT wordnet_relation_pkey PRIMARY KEY (lexicon, source_synset_id, target_synset_id, rel_type);


--
-- Name: wordnet_synset wordnet_synset_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.wordnet_synset
    ADD CONSTRAINT wordnet_synset_pkey PRIMARY KEY (lexicon, synset_id);


--
-- Name: language language_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.language
    ADD CONSTRAINT language_code_key UNIQUE (code);


--
-- Name: language language_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.language
    ADD CONSTRAINT language_pkey PRIMARY KEY (id);


--
-- Name: radical radical_character_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radical
    ADD CONSTRAINT radical_character_key UNIQUE ("character");


--
-- Name: radical radical_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radical
    ADD CONSTRAINT radical_pkey PRIMARY KEY (number);


--
-- Name: schema_migration schema_migration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migration
    ADD CONSTRAINT schema_migration_pkey PRIMARY KEY (name);


--
-- Name: source source_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source
    ADD CONSTRAINT source_code_key UNIQUE (code);


--
-- Name: source source_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source
    ADD CONSTRAINT source_pkey PRIMARY KEY (id);


--
-- Name: tag tag_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_pkey PRIMARY KEY (code);


--
-- Name: ili_map_pwn30 ili_map_pwn30_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ili_map_pwn30
    ADD CONSTRAINT ili_map_pwn30_pkey PRIMARY KEY (ili, pwn30_offset);


--
-- Name: import_batch import_batch_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.import_batch
    ADD CONSTRAINT import_batch_pkey PRIMARY KEY (id);


--
-- Name: jlpt_entry jlpt_entry_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.jlpt_entry
    ADD CONSTRAINT jlpt_entry_pkey PRIMARY KEY (level, row_number);


--
-- Name: jmdict_entry jmdict_entry_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.jmdict_entry
    ADD CONSTRAINT jmdict_entry_pkey PRIMARY KEY (ent_seq);


--
-- Name: kanji_data_entry kanji_data_entry_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.kanji_data_entry
    ADD CONSTRAINT kanji_data_entry_pkey PRIMARY KEY (literal);


--
-- Name: kanji_entry kanji_entry_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.kanji_entry
    ADD CONSTRAINT kanji_entry_pkey PRIMARY KEY (literal);


--
-- Name: krad_entry krad_entry_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.krad_entry
    ADD CONSTRAINT krad_entry_pkey PRIMARY KEY (literal);


--
-- Name: omw_wikt_vi omw_wikt_vi_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.omw_wikt_vi
    ADD CONSTRAINT omw_wikt_vi_pkey PRIMARY KEY (pwn30_offset, lemma);


--
-- Name: tatoeba_link tatoeba_link_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.tatoeba_link
    ADD CONSTRAINT tatoeba_link_pkey PRIMARY KEY (sentence_id, translation_id);


--
-- Name: tatoeba_sentence tatoeba_sentence_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.tatoeba_sentence
    ADD CONSTRAINT tatoeba_sentence_pkey PRIMARY KEY (id);


--
-- Name: wikt_entry wikt_entry_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.wikt_entry
    ADD CONSTRAINT wikt_entry_pkey PRIMARY KEY (id);


--
-- Name: wn_synset wn_synset_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.wn_synset
    ADD CONSTRAINT wn_synset_pkey PRIMARY KEY (lexicon, synset_id);


--
-- Name: chat_message_by_session; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX chat_message_by_session ON app.chat_message USING btree (session_id, created_at);


--
-- Name: chat_session_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX chat_session_by_user ON app.chat_session USING btree (user_id, last_message_at DESC NULLS LAST);


--
-- Name: collection_by_profile; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX collection_by_profile ON app.collection USING btree (profile_id, archived_at, updated_at DESC);


--
-- Name: collection_item_by_collection; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX collection_item_by_collection ON app.collection_item USING btree (collection_id, "position");


--
-- Name: collection_item_by_concept; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX collection_item_by_concept ON app.collection_item USING btree (concept_id) WHERE (concept_id IS NOT NULL);


--
-- Name: collection_public; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX collection_public ON app.collection USING btree (is_public) WHERE is_public;


--
-- Name: collection_share_by_collection; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX collection_share_by_collection ON app.collection_share USING btree (collection_id) WHERE (revoked_at IS NULL);


--
-- Name: device_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX device_by_user ON app.device USING btree (user_id);


--
-- Name: device_push_unique; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX device_push_unique ON app.device USING btree (push_provider, push_token) WHERE ((push_token IS NOT NULL) AND (revoked_at IS NULL));


--
-- Name: gloss_report_gloss; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX gloss_report_gloss ON app.gloss_report USING btree (target_kind, target_id);


--
-- Name: gloss_report_queue; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX gloss_report_queue ON app.gloss_report USING btree (status, created_at);


--
-- Name: item_face_by_sense; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX item_face_by_sense ON app.collection_item_face USING btree (sense_id);


--
-- Name: item_tag_by_tag; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX item_tag_by_tag ON app.collection_item_tag USING btree (tag_id, item_id);


--
-- Name: leaderboard_top; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX leaderboard_top ON app.leaderboard_snapshot USING btree (period_start, scope, rank);


--
-- Name: notification_log_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX notification_log_by_user ON app.notification_log USING btree (user_id, created_at DESC);


--
-- Name: notification_log_idempotent; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX notification_log_idempotent ON app.notification_log USING btree (reminder_id, idempotency_key) WHERE ((reminder_id IS NOT NULL) AND (idempotency_key IS NOT NULL));


--
-- Name: quiz_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX quiz_by_user ON app.quiz USING btree (user_id, created_at DESC);


--
-- Name: reminder_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX reminder_by_user ON app.reminder USING btree (user_id);


--
-- Name: reminder_due; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX reminder_due ON app.reminder USING btree (next_fire_at) WHERE (is_enabled AND (next_fire_at IS NOT NULL));


--
-- Name: review_log_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_by_user ON ONLY app.review_log USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2026_09_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2026_09_user_id_reviewed_at_idx ON app.review_log_2026_09 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2026_10_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2026_10_user_id_reviewed_at_idx ON app.review_log_2026_10 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2026_11_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2026_11_user_id_reviewed_at_idx ON app.review_log_2026_11 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2026_12_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2026_12_user_id_reviewed_at_idx ON app.review_log_2026_12 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_01_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_01_user_id_reviewed_at_idx ON app.review_log_2027_01 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_02_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_02_user_id_reviewed_at_idx ON app.review_log_2027_02 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_03_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_03_user_id_reviewed_at_idx ON app.review_log_2027_03 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_04_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_04_user_id_reviewed_at_idx ON app.review_log_2027_04 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_05_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_05_user_id_reviewed_at_idx ON app.review_log_2027_05 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_06_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_06_user_id_reviewed_at_idx ON app.review_log_2027_06 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_07_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_07_user_id_reviewed_at_idx ON app.review_log_2027_07 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_08_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_08_user_id_reviewed_at_idx ON app.review_log_2027_08 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_09_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_09_user_id_reviewed_at_idx ON app.review_log_2027_09 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_10_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_10_user_id_reviewed_at_idx ON app.review_log_2027_10 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_11_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_11_user_id_reviewed_at_idx ON app.review_log_2027_11 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2027_12_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2027_12_user_id_reviewed_at_idx ON app.review_log_2027_12 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_01_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_01_user_id_reviewed_at_idx ON app.review_log_2028_01 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_02_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_02_user_id_reviewed_at_idx ON app.review_log_2028_02 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_03_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_03_user_id_reviewed_at_idx ON app.review_log_2028_03 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_04_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_04_user_id_reviewed_at_idx ON app.review_log_2028_04 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_05_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_05_user_id_reviewed_at_idx ON app.review_log_2028_05 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_06_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_06_user_id_reviewed_at_idx ON app.review_log_2028_06 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_07_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_07_user_id_reviewed_at_idx ON app.review_log_2028_07 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_08_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_08_user_id_reviewed_at_idx ON app.review_log_2028_08 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_09_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_09_user_id_reviewed_at_idx ON app.review_log_2028_09 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_10_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_10_user_id_reviewed_at_idx ON app.review_log_2028_10 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_11_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_11_user_id_reviewed_at_idx ON app.review_log_2028_11 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2028_12_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2028_12_user_id_reviewed_at_idx ON app.review_log_2028_12 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2029_01_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2029_01_user_id_reviewed_at_idx ON app.review_log_2029_01 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2029_02_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2029_02_user_id_reviewed_at_idx ON app.review_log_2029_02 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2029_03_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2029_03_user_id_reviewed_at_idx ON app.review_log_2029_03 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2029_04_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2029_04_user_id_reviewed_at_idx ON app.review_log_2029_04 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2029_05_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2029_05_user_id_reviewed_at_idx ON app.review_log_2029_05 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2029_06_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2029_06_user_id_reviewed_at_idx ON app.review_log_2029_06 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2029_07_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2029_07_user_id_reviewed_at_idx ON app.review_log_2029_07 USING btree (user_id, reviewed_at DESC);


--
-- Name: review_log_2029_08_user_id_reviewed_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX review_log_2029_08_user_id_reviewed_at_idx ON app.review_log_2029_08 USING btree (user_id, reviewed_at DESC);


--
-- Name: search_history_recent; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX search_history_recent ON app.search_history USING btree (user_id, created_at DESC);


--
-- Name: session_item_by_session; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX session_item_by_session ON app.study_session_item USING btree (session_id, ordinal);


--
-- Name: session_item_wrong; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX session_item_wrong ON app.study_session_item USING btree (session_id) WHERE (is_correct IS FALSE);


--
-- Name: srs_due_by_profile; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX srs_due_by_profile ON app.srs_state USING btree (profile_id, due_at) WHERE (NOT suspended);


--
-- Name: srs_due_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX srs_due_by_user ON app.srs_state USING btree (user_id, due_at) WHERE (NOT suspended);


--
-- Name: streak_day_recent; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX streak_day_recent ON app.streak_day USING btree (user_id, day DESC);


--
-- Name: study_profile_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX study_profile_by_user ON app.study_profile USING btree (user_id);


--
-- Name: study_profile_one_default; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX study_profile_one_default ON app.study_profile USING btree (user_id) WHERE is_default;


--
-- Name: study_session_by_profile; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX study_session_by_profile ON app.study_session USING btree (profile_id, started_at DESC);


--
-- Name: study_session_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX study_session_by_user ON app.study_session USING btree (user_id, started_at DESC);


--
-- Name: study_session_open; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX study_session_open ON app.study_session USING btree (user_id) WHERE (status = 'in_progress'::text);


--
-- Name: tag_user_name_unique; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX tag_user_name_unique ON app.tag USING btree (user_id, lower(name));


--
-- Name: user_achievement_unseen; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX user_achievement_unseen ON app.user_achievement USING btree (user_id) WHERE ((unlocked_at IS NOT NULL) AND (seen_at IS NULL));


--
-- Name: user_identity_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX user_identity_by_user ON app.user_identity USING btree (user_id);


--
-- Name: user_session_active; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX user_session_active ON app.user_session USING btree (user_id, expires_at) WHERE (revoked_at IS NULL);


--
-- Name: users_by_status; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX users_by_status ON app.users USING btree (status) WHERE (status <> 'active'::text);


--
-- Name: users_email_unique; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX users_email_unique ON app.users USING btree (lower(email));


--
-- Name: xp_event_by_source; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX xp_event_by_source ON app.xp_event USING btree (source, created_at DESC);


--
-- Name: xp_event_by_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX xp_event_by_user ON app.xp_event USING btree (user_id, created_at DESC);


--
-- Name: concept_curated; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX concept_curated ON core.concept USING btree (id) WHERE (status = 'curated'::text);


--
-- Name: concept_gloss_history_by_gloss; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX concept_gloss_history_by_gloss ON core.concept_gloss_history USING btree (concept_id, language_id, rank, changed_at DESC);


--
-- Name: concept_label_concept; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX concept_label_concept ON core.concept_label USING btree (concept_id, language_id, rank);


--
-- Name: concept_label_lookup; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX concept_label_lookup ON core.concept_label USING btree (language_id, text);


--
-- Name: deck_item_concept; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX deck_item_concept ON core.deck_item USING btree (concept_id) WHERE (concept_id IS NOT NULL);


--
-- Name: deck_item_position; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX deck_item_position ON core.deck_item USING btree (deck_id, "position");


--
-- Name: deck_published; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX deck_published ON core.deck USING btree (language_id, level_label) WHERE is_published;


--
-- Name: example_annotation_canonical; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX example_annotation_canonical ON core.example_annotation USING btree (canonical_example_id) WHERE (canonical_example_id IS NOT NULL);


--
-- Name: example_annotation_status; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX example_annotation_status ON core.example_annotation USING btree (match_status, source_sentence_id);


--
-- Name: example_by_external_id; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX example_by_external_id ON core.example USING btree (external_id) WHERE (external_id IS NOT NULL);


--
-- Name: example_by_sense; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX example_by_sense ON core.example USING btree (sense_id, language_id) WHERE (sense_id IS NOT NULL);


--
-- Name: example_concept_by_concept; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX example_concept_by_concept ON core.example_concept USING btree (concept_id, confidence DESC);


--
-- Name: example_sense_by_sense; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX example_sense_by_sense ON core.example_sense USING btree (sense_id, confidence DESC);


--
-- Name: example_source_per_sense; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX example_source_per_sense ON core.example USING btree (sense_id, external_id) WHERE ((sense_id IS NOT NULL) AND (external_id IS NOT NULL));


--
-- Name: example_translation_target; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX example_translation_target ON core.example_translation USING btree (translation_id, example_id);


--
-- Name: example_unlinked_source; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX example_unlinked_source ON core.example USING btree (external_id) WHERE ((sense_id IS NULL) AND (external_id IS NOT NULL));


--
-- Name: jlpt_link_lexeme; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX jlpt_link_lexeme ON core.jlpt_link USING btree (lexeme_id, status);


--
-- Name: jlpt_link_status; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX jlpt_link_status ON core.jlpt_link USING btree (status, source_level, expression);


--
-- Name: kanji_frequency; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX kanji_frequency ON core.kanji USING btree (frequency_rank) WHERE (frequency_rank IS NOT NULL);


--
-- Name: kanji_radical_part; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX kanji_radical_part ON core.kanji_radical USING btree (part, kanji_literal);


--
-- Name: lexeme_form_applies_target; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_form_applies_target ON core.lexeme_form_applies_to USING btree (target_form_id, form_id);


--
-- Name: lexeme_form_by_lexeme; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_form_by_lexeme ON core.lexeme_form USING btree (lexeme_id, kind, form_order);


--
-- Name: lexeme_form_char_kanji; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_form_char_kanji ON core.lexeme_form_char USING btree (kanji_literal) WHERE (kanji_literal IS NOT NULL);


--
-- Name: lexeme_form_char_literal; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_form_char_literal ON core.lexeme_form_char USING btree (literal, character_kind);


--
-- Name: lexeme_form_kanji_char_by_literal; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_form_kanji_char_by_literal ON core.lexeme_form_kanji_char USING btree (kanji_literal, form_id);


--
-- Name: lexeme_form_lookup; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_form_lookup ON core.lexeme_form USING btree (kind, form_text, lexeme_id);


--
-- Name: lexeme_form_tag_code; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_form_tag_code ON core.lexeme_form_tag USING btree (tag_code, form_id);


--
-- Name: lexeme_frequency; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_frequency ON core.lexeme USING btree (language_id, frequency_rank) WHERE (frequency_rank IS NOT NULL);


--
-- Name: lexeme_kana_forms; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_kana_forms ON core.lexeme USING gin (((attributes -> 'kana'::text)) jsonb_path_ops);


--
-- Name: lexeme_kanji_forms; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_kanji_forms ON core.lexeme USING gin (((attributes -> 'kanji'::text)) jsonb_path_ops);


--
-- Name: lexeme_lemma_lookup; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_lemma_lookup ON core.lexeme USING btree (language_id, lemma);


--
-- Name: lexeme_lemma_prefix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_lemma_prefix ON core.lexeme USING btree (lemma text_pattern_ops);


--
-- Name: lexeme_level_lookup; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_level_lookup ON core.lexeme_level USING btree (scheme, level, lexeme_id);


--
-- Name: lexeme_reading_lookup; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_reading_lookup ON core.lexeme USING btree (language_id, reading) WHERE (reading IS NOT NULL);


--
-- Name: lexeme_reading_prefix; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX lexeme_reading_prefix ON core.lexeme USING btree (reading text_pattern_ops) WHERE (reading IS NOT NULL);


--
-- Name: mapping_run_task_status; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX mapping_run_task_status ON core.mapping_run USING btree (task, status, started_at DESC);


--
-- Name: media_asset_by_kind; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX media_asset_by_kind ON core.media_asset USING btree (kind);


--
-- Name: pronunciation_by_lexeme; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX pronunciation_by_lexeme ON core.pronunciation USING btree (lexeme_id);


--
-- Name: sense_concept_by_concept; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_concept_by_concept ON core.sense_concept USING btree (concept_id, confidence DESC);


--
-- Name: sense_concept_candidate_queue; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_concept_candidate_queue ON core.sense_concept_candidate USING btree (decision, run_id, score DESC);


--
-- Name: sense_concept_candidate_review_candidate; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_concept_candidate_review_candidate ON core.sense_concept_candidate_review USING btree (candidate_id, created_at DESC);


--
-- Name: sense_concept_candidate_review_run; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_concept_candidate_review_run ON core.sense_concept_candidate_review USING btree (mapping_run_id, reviewer_kind, score DESC);


--
-- Name: sense_concept_candidate_sense; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_concept_candidate_sense ON core.sense_concept_candidate USING btree (sense_id, decision, calibrated_score DESC);


--
-- Name: sense_form_by_form; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_form_by_form ON core.sense_form USING btree (form_id, sense_id);


--
-- Name: sense_gloss_history_by_gloss; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_gloss_history_by_gloss ON core.sense_gloss_history USING btree (gloss_id, changed_at DESC);


--
-- Name: sense_gloss_language; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_gloss_language ON core.sense_gloss USING btree (language_id, sense_id);


--
-- Name: sense_one_primary; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX sense_one_primary ON core.sense USING btree (lexeme_id) WHERE is_primary;


--
-- Name: sense_relation_candidate_queue; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_relation_candidate_queue ON core.sense_relation_candidate USING btree (decision, relation, score DESC);


--
-- Name: sense_relation_target; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_relation_target ON core.sense_relation USING btree (target_sense_id, relation);


--
-- Name: sense_tag_code; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sense_tag_code ON core.sense_tag USING btree (tag_code, sense_id);


--
-- Name: source_entry_identity_lexeme; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX source_entry_identity_lexeme ON core.source_entry_identity USING btree (lexeme_id) WHERE (lexeme_id IS NOT NULL);


--
-- Name: source_entry_identity_logical; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX source_entry_identity_logical ON core.source_entry_identity USING btree (source_id, logical_key, status);


--
-- Name: source_form_lexeme; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX source_form_lexeme ON core.source_form USING btree (lexeme_id, form_kind);


--
-- Name: source_form_lookup; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX source_form_lookup ON core.source_form USING btree (form_text, form_kind);


--
-- Name: translation_assertion_source; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX translation_assertion_source ON core.translation_assertion USING btree (source_lexeme_id, source_sense_id);


--
-- Name: translation_assertion_target; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX translation_assertion_target ON core.translation_assertion USING btree (target_language_id, target_text);


--
-- Name: translation_candidate_queue; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX translation_candidate_queue ON core.translation_target_candidate USING btree (decision, score DESC);


--
-- Name: wordnet_relation_target; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX wordnet_relation_target ON core.wordnet_relation USING btree (lexicon, target_synset_id, rel_type);


--
-- Name: wordnet_synset_concept; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX wordnet_synset_concept ON core.wordnet_synset USING btree (concept_id);


--
-- Name: tag_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_kind ON public.tag USING btree (kind);


--
-- Name: sense_pair_lookup; Type: INDEX; Schema: serve; Owner: -
--

CREATE INDEX sense_pair_lookup ON serve.sense_pair USING btree (sense_a, lang_b, confidence DESC);


--
-- Name: sense_pair_pair; Type: INDEX; Schema: serve; Owner: -
--

CREATE UNIQUE INDEX sense_pair_pair ON serve.sense_pair USING btree (sense_a, sense_b);


--
-- Name: jlpt_entry_match; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX jlpt_entry_match ON staging.jlpt_entry USING btree (expression, reading);


--
-- Name: jmdict_entry_batch; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX jmdict_entry_batch ON staging.jmdict_entry USING btree (batch_id);


--
-- Name: tatoeba_link_trans; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX tatoeba_link_trans ON staging.tatoeba_link USING btree (translation_id);


--
-- Name: tatoeba_sentence_lang; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX tatoeba_sentence_lang ON staging.tatoeba_sentence USING btree (lang);


--
-- Name: wikt_entry_word; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX wikt_entry_word ON staging.wikt_entry USING btree (lang_code, word, pos);


--
-- Name: wn_example_synset; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX wn_example_synset ON staging.wn_example USING btree (lexicon, synset_id);


--
-- Name: wn_relation_src; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX wn_relation_src ON staging.wn_relation USING btree (lexicon, source_id);


--
-- Name: wn_synset_ili; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX wn_synset_ili ON staging.wn_synset USING btree (ili);


--
-- Name: review_log_2026_09_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2026_09_pkey;


--
-- Name: review_log_2026_09_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2026_09_user_id_reviewed_at_idx;


--
-- Name: review_log_2026_10_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2026_10_pkey;


--
-- Name: review_log_2026_10_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2026_10_user_id_reviewed_at_idx;


--
-- Name: review_log_2026_11_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2026_11_pkey;


--
-- Name: review_log_2026_11_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2026_11_user_id_reviewed_at_idx;


--
-- Name: review_log_2026_12_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2026_12_pkey;


--
-- Name: review_log_2026_12_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2026_12_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_01_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_01_pkey;


--
-- Name: review_log_2027_01_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_01_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_02_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_02_pkey;


--
-- Name: review_log_2027_02_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_02_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_03_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_03_pkey;


--
-- Name: review_log_2027_03_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_03_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_04_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_04_pkey;


--
-- Name: review_log_2027_04_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_04_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_05_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_05_pkey;


--
-- Name: review_log_2027_05_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_05_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_06_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_06_pkey;


--
-- Name: review_log_2027_06_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_06_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_07_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_07_pkey;


--
-- Name: review_log_2027_07_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_07_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_08_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_08_pkey;


--
-- Name: review_log_2027_08_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_08_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_09_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_09_pkey;


--
-- Name: review_log_2027_09_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_09_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_10_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_10_pkey;


--
-- Name: review_log_2027_10_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_10_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_11_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_11_pkey;


--
-- Name: review_log_2027_11_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_11_user_id_reviewed_at_idx;


--
-- Name: review_log_2027_12_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2027_12_pkey;


--
-- Name: review_log_2027_12_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2027_12_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_01_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_01_pkey;


--
-- Name: review_log_2028_01_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_01_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_02_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_02_pkey;


--
-- Name: review_log_2028_02_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_02_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_03_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_03_pkey;


--
-- Name: review_log_2028_03_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_03_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_04_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_04_pkey;


--
-- Name: review_log_2028_04_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_04_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_05_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_05_pkey;


--
-- Name: review_log_2028_05_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_05_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_06_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_06_pkey;


--
-- Name: review_log_2028_06_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_06_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_07_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_07_pkey;


--
-- Name: review_log_2028_07_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_07_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_08_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_08_pkey;


--
-- Name: review_log_2028_08_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_08_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_09_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_09_pkey;


--
-- Name: review_log_2028_09_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_09_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_10_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_10_pkey;


--
-- Name: review_log_2028_10_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_10_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_11_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_11_pkey;


--
-- Name: review_log_2028_11_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_11_user_id_reviewed_at_idx;


--
-- Name: review_log_2028_12_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2028_12_pkey;


--
-- Name: review_log_2028_12_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2028_12_user_id_reviewed_at_idx;


--
-- Name: review_log_2029_01_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2029_01_pkey;


--
-- Name: review_log_2029_01_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2029_01_user_id_reviewed_at_idx;


--
-- Name: review_log_2029_02_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2029_02_pkey;


--
-- Name: review_log_2029_02_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2029_02_user_id_reviewed_at_idx;


--
-- Name: review_log_2029_03_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2029_03_pkey;


--
-- Name: review_log_2029_03_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2029_03_user_id_reviewed_at_idx;


--
-- Name: review_log_2029_04_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2029_04_pkey;


--
-- Name: review_log_2029_04_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2029_04_user_id_reviewed_at_idx;


--
-- Name: review_log_2029_05_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2029_05_pkey;


--
-- Name: review_log_2029_05_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2029_05_user_id_reviewed_at_idx;


--
-- Name: review_log_2029_06_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2029_06_pkey;


--
-- Name: review_log_2029_06_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2029_06_user_id_reviewed_at_idx;


--
-- Name: review_log_2029_07_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2029_07_pkey;


--
-- Name: review_log_2029_07_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2029_07_user_id_reviewed_at_idx;


--
-- Name: review_log_2029_08_pkey; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_pkey ATTACH PARTITION app.review_log_2029_08_pkey;


--
-- Name: review_log_2029_08_user_id_reviewed_at_idx; Type: INDEX ATTACH; Schema: app; Owner: -
--

ALTER INDEX app.review_log_by_user ATTACH PARTITION app.review_log_2029_08_user_id_reviewed_at_idx;


--
-- Name: collection_item collection_item_touch; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER collection_item_touch BEFORE UPDATE ON app.collection_item FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


--
-- Name: collection collection_touch; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER collection_touch BEFORE UPDATE ON app.collection FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


--
-- Name: reminder reminder_touch; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER reminder_touch BEFORE UPDATE ON app.reminder FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


--
-- Name: srs_state srs_state_touch; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER srs_state_touch BEFORE UPDATE ON app.srs_state FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


--
-- Name: study_profile study_profile_touch; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER study_profile_touch BEFORE UPDATE ON app.study_profile FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


--
-- Name: user_settings user_settings_touch; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER user_settings_touch BEFORE UPDATE ON app.user_settings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


--
-- Name: user_stats user_stats_touch; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER user_stats_touch BEFORE UPDATE ON app.user_stats FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


--
-- Name: concept_gloss concept_gloss_audit; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER concept_gloss_audit AFTER DELETE OR UPDATE ON core.concept_gloss FOR EACH ROW EXECUTE FUNCTION core.audit_concept_gloss();


--
-- Name: sense_gloss sense_gloss_audit; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER sense_gloss_audit AFTER DELETE OR UPDATE ON core.sense_gloss FOR EACH ROW EXECUTE FUNCTION core.audit_sense_gloss();


--
-- Name: ai_usage ai_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.ai_usage
    ADD CONSTRAINT ai_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: chat_message chat_message_ref_sense_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.chat_message
    ADD CONSTRAINT chat_message_ref_sense_id_fkey FOREIGN KEY (ref_sense_id) REFERENCES core.sense(id) ON DELETE SET NULL;


--
-- Name: chat_message chat_message_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.chat_message
    ADD CONSTRAINT chat_message_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.chat_session(id) ON DELETE CASCADE;


--
-- Name: chat_session chat_session_language_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.chat_session
    ADD CONSTRAINT chat_session_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: chat_session chat_session_profile_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.chat_session
    ADD CONSTRAINT chat_session_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE SET NULL;


--
-- Name: chat_session chat_session_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.chat_session
    ADD CONSTRAINT chat_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: collection collection_cloned_deck_fk; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection
    ADD CONSTRAINT collection_cloned_deck_fk FOREIGN KEY (cloned_from_deck_id) REFERENCES core.deck(id) ON DELETE SET NULL;


--
-- Name: collection collection_cloned_from_collection_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection
    ADD CONSTRAINT collection_cloned_from_collection_id_fkey FOREIGN KEY (cloned_from_collection_id) REFERENCES app.collection(id) ON DELETE SET NULL;


--
-- Name: collection_item collection_item_anchor_sense_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item
    ADD CONSTRAINT collection_item_anchor_sense_id_fkey FOREIGN KEY (anchor_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: collection_item collection_item_collection_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item
    ADD CONSTRAINT collection_item_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES app.collection(id) ON DELETE CASCADE;


--
-- Name: collection_item collection_item_concept_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item
    ADD CONSTRAINT collection_item_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT;


--
-- Name: collection_item collection_item_deck_fk; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item
    ADD CONSTRAINT collection_item_deck_fk FOREIGN KEY (added_from_deck_id) REFERENCES core.deck(id) ON DELETE SET NULL;


--
-- Name: collection_item_face collection_item_face_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item_face
    ADD CONSTRAINT collection_item_face_item_id_fkey FOREIGN KEY (item_id) REFERENCES app.collection_item(id) ON DELETE CASCADE;


--
-- Name: collection_item_face collection_item_face_language_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item_face
    ADD CONSTRAINT collection_item_face_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: collection_item_face collection_item_face_sense_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item_face
    ADD CONSTRAINT collection_item_face_sense_id_fkey FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: collection_item_tag collection_item_tag_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item_tag
    ADD CONSTRAINT collection_item_tag_item_id_fkey FOREIGN KEY (item_id) REFERENCES app.collection_item(id) ON DELETE CASCADE;


--
-- Name: collection_item_tag collection_item_tag_tag_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_item_tag
    ADD CONSTRAINT collection_item_tag_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES app.tag(id) ON DELETE CASCADE;


--
-- Name: collection collection_owner_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection
    ADD CONSTRAINT collection_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: collection collection_profile_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection
    ADD CONSTRAINT collection_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE CASCADE;


--
-- Name: collection_share collection_share_collection_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_share
    ADD CONSTRAINT collection_share_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES app.collection(id) ON DELETE CASCADE;


--
-- Name: collection_share collection_share_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.collection_share
    ADD CONSTRAINT collection_share_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: device device_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.device
    ADD CONSTRAINT device_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: gloss_report gloss_report_language_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.gloss_report
    ADD CONSTRAINT gloss_report_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: gloss_report gloss_report_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.gloss_report
    ADD CONSTRAINT gloss_report_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE SET NULL;


--
-- Name: leaderboard_snapshot leaderboard_snapshot_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.leaderboard_snapshot
    ADD CONSTRAINT leaderboard_snapshot_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: notification_log notification_log_reminder_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.notification_log
    ADD CONSTRAINT notification_log_reminder_id_fkey FOREIGN KEY (reminder_id) REFERENCES app.reminder(id) ON DELETE SET NULL;


--
-- Name: notification_log notification_log_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.notification_log
    ADD CONSTRAINT notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: quiz quiz_collection_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz
    ADD CONSTRAINT quiz_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES app.collection(id) ON DELETE SET NULL;


--
-- Name: quiz quiz_profile_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz
    ADD CONSTRAINT quiz_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE CASCADE;


--
-- Name: quiz_question quiz_question_concept_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz_question
    ADD CONSTRAINT quiz_question_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE SET NULL;


--
-- Name: quiz_question quiz_question_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz_question
    ADD CONSTRAINT quiz_question_item_id_fkey FOREIGN KEY (item_id) REFERENCES app.collection_item(id) ON DELETE SET NULL;


--
-- Name: quiz_question quiz_question_language_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz_question
    ADD CONSTRAINT quiz_question_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: quiz_question quiz_question_quiz_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz_question
    ADD CONSTRAINT quiz_question_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES app.quiz(id) ON DELETE CASCADE;


--
-- Name: quiz quiz_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.quiz
    ADD CONSTRAINT quiz_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: reminder reminder_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.reminder
    ADD CONSTRAINT reminder_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: review_log review_log_srs_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE app.review_log
    ADD CONSTRAINT review_log_srs_id_fkey FOREIGN KEY (srs_id) REFERENCES app.srs_state(id) ON DELETE SET NULL;


--
-- Name: review_log review_log_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE app.review_log
    ADD CONSTRAINT review_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: search_history search_history_language_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.search_history
    ADD CONSTRAINT search_history_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: search_history search_history_matched_sense_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.search_history
    ADD CONSTRAINT search_history_matched_sense_id_fkey FOREIGN KEY (matched_sense_id) REFERENCES core.sense(id) ON DELETE SET NULL;


--
-- Name: search_history search_history_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.search_history
    ADD CONSTRAINT search_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: study_session_item session_item_quiz_question_fk; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session_item
    ADD CONSTRAINT session_item_quiz_question_fk FOREIGN KEY (quiz_question_id) REFERENCES app.quiz_question(id) ON DELETE SET NULL;


--
-- Name: srs_state srs_state_face_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.srs_state
    ADD CONSTRAINT srs_state_face_id_fkey FOREIGN KEY (face_id) REFERENCES app.collection_item_face(id) ON DELETE CASCADE;


--
-- Name: srs_state srs_state_profile_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.srs_state
    ADD CONSTRAINT srs_state_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE CASCADE;


--
-- Name: srs_state srs_state_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.srs_state
    ADD CONSTRAINT srs_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: streak_day streak_day_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.streak_day
    ADD CONSTRAINT streak_day_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: study_profile study_profile_primary_language_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_profile
    ADD CONSTRAINT study_profile_primary_language_id_fkey FOREIGN KEY (primary_language_id) REFERENCES public.language(id);


--
-- Name: study_profile study_profile_secondary_language_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_profile
    ADD CONSTRAINT study_profile_secondary_language_id_fkey FOREIGN KEY (secondary_language_id) REFERENCES public.language(id);


--
-- Name: study_profile study_profile_support_language_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_profile
    ADD CONSTRAINT study_profile_support_language_id_fkey FOREIGN KEY (support_language_id) REFERENCES public.language(id);


--
-- Name: study_profile study_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_profile
    ADD CONSTRAINT study_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: study_session study_session_collection_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session
    ADD CONSTRAINT study_session_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES app.collection(id) ON DELETE SET NULL;


--
-- Name: study_session_item study_session_item_face_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session_item
    ADD CONSTRAINT study_session_item_face_id_fkey FOREIGN KEY (face_id) REFERENCES app.collection_item_face(id) ON DELETE SET NULL;


--
-- Name: study_session_item study_session_item_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session_item
    ADD CONSTRAINT study_session_item_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.study_session(id) ON DELETE CASCADE;


--
-- Name: study_session_item study_session_item_srs_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session_item
    ADD CONSTRAINT study_session_item_srs_id_fkey FOREIGN KEY (srs_id) REFERENCES app.srs_state(id) ON DELETE SET NULL;


--
-- Name: study_session study_session_profile_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session
    ADD CONSTRAINT study_session_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES app.study_profile(id) ON DELETE CASCADE;


--
-- Name: study_session study_session_quiz_fk; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session
    ADD CONSTRAINT study_session_quiz_fk FOREIGN KEY (quiz_id) REFERENCES app.quiz(id) ON DELETE SET NULL;


--
-- Name: study_session study_session_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.study_session
    ADD CONSTRAINT study_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: tag tag_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.tag
    ADD CONSTRAINT tag_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: user_achievement user_achievement_achievement_code_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_achievement
    ADD CONSTRAINT user_achievement_achievement_code_fkey FOREIGN KEY (achievement_code) REFERENCES app.achievement(code) ON DELETE CASCADE;


--
-- Name: user_achievement user_achievement_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_achievement
    ADD CONSTRAINT user_achievement_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: user_identity user_identity_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_identity
    ADD CONSTRAINT user_identity_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: user_session user_session_device_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_session
    ADD CONSTRAINT user_session_device_id_fkey FOREIGN KEY (device_id) REFERENCES app.device(id) ON DELETE SET NULL;


--
-- Name: user_session user_session_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_session
    ADD CONSTRAINT user_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_active_profile_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_settings
    ADD CONSTRAINT user_settings_active_profile_id_fkey FOREIGN KEY (active_profile_id) REFERENCES app.study_profile(id) ON DELETE SET NULL;


--
-- Name: user_settings user_settings_ui_language_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_settings
    ADD CONSTRAINT user_settings_ui_language_id_fkey FOREIGN KEY (ui_language_id) REFERENCES public.language(id);


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: user_stats user_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_stats
    ADD CONSTRAINT user_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: xp_event xp_event_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.xp_event
    ADD CONSTRAINT xp_event_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: concept concept_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept
    ADD CONSTRAINT concept_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: concept_gloss concept_gloss_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_gloss
    ADD CONSTRAINT concept_gloss_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: concept_gloss concept_gloss_concept_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_gloss
    ADD CONSTRAINT concept_gloss_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT;


--
-- Name: concept_gloss concept_gloss_language_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_gloss
    ADD CONSTRAINT concept_gloss_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: concept_gloss concept_gloss_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_gloss
    ADD CONSTRAINT concept_gloss_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: concept_label concept_label_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_label
    ADD CONSTRAINT concept_label_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: concept_label concept_label_concept_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_label
    ADD CONSTRAINT concept_label_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT;


--
-- Name: concept_label concept_label_language_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_label
    ADD CONSTRAINT concept_label_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: concept_label concept_label_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept_label
    ADD CONSTRAINT concept_label_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: concept concept_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.concept
    ADD CONSTRAINT concept_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: deck_item deck_item_anchor_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.deck_item
    ADD CONSTRAINT deck_item_anchor_sense_id_fkey FOREIGN KEY (anchor_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: deck_item deck_item_concept_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.deck_item
    ADD CONSTRAINT deck_item_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT;


--
-- Name: deck_item deck_item_deck_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.deck_item
    ADD CONSTRAINT deck_item_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES core.deck(id) ON DELETE CASCADE;


--
-- Name: deck deck_language_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.deck
    ADD CONSTRAINT deck_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: example_annotation example_annotation_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_annotation
    ADD CONSTRAINT example_annotation_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: example_annotation example_annotation_canonical_example_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_annotation
    ADD CONSTRAINT example_annotation_canonical_example_id_fkey FOREIGN KEY (canonical_example_id) REFERENCES core.example(id) ON DELETE RESTRICT;


--
-- Name: example_annotation example_annotation_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_annotation
    ADD CONSTRAINT example_annotation_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id);


--
-- Name: example_annotation example_annotation_source_example_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_annotation
    ADD CONSTRAINT example_annotation_source_example_id_fkey FOREIGN KEY (source_example_id) REFERENCES core.example(id) ON DELETE RESTRICT;


--
-- Name: example_annotation example_annotation_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_annotation
    ADD CONSTRAINT example_annotation_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: example example_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example
    ADD CONSTRAINT example_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: example_concept example_concept_concept_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_concept
    ADD CONSTRAINT example_concept_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT;


--
-- Name: example_concept example_concept_example_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_concept
    ADD CONSTRAINT example_concept_example_id_fkey FOREIGN KEY (example_id) REFERENCES core.example(id) ON DELETE RESTRICT;


--
-- Name: example_concept example_concept_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_concept
    ADD CONSTRAINT example_concept_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id);


--
-- Name: example example_language_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example
    ADD CONSTRAINT example_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: example_sense example_sense_example_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_sense
    ADD CONSTRAINT example_sense_example_id_fkey FOREIGN KEY (example_id) REFERENCES core.example(id) ON DELETE RESTRICT;


--
-- Name: example example_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example
    ADD CONSTRAINT example_sense_id_fkey FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: example_sense example_sense_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_sense
    ADD CONSTRAINT example_sense_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id);


--
-- Name: example_sense example_sense_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_sense
    ADD CONSTRAINT example_sense_sense_id_fkey FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: example example_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example
    ADD CONSTRAINT example_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: example_translation example_translation_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_translation
    ADD CONSTRAINT example_translation_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: example_translation example_translation_example_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_translation
    ADD CONSTRAINT example_translation_example_id_fkey FOREIGN KEY (example_id) REFERENCES core.example(id);


--
-- Name: example_translation example_translation_translation_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.example_translation
    ADD CONSTRAINT example_translation_translation_id_fkey FOREIGN KEY (translation_id) REFERENCES core.example(id);


--
-- Name: jlpt_link jlpt_link_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.jlpt_link
    ADD CONSTRAINT jlpt_link_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: jlpt_link jlpt_link_lexeme_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.jlpt_link
    ADD CONSTRAINT jlpt_link_lexeme_id_fkey FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT;


--
-- Name: jlpt_link jlpt_link_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.jlpt_link
    ADD CONSTRAINT jlpt_link_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id);


--
-- Name: jlpt_link jlpt_link_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.jlpt_link
    ADD CONSTRAINT jlpt_link_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: jlpt_link jlpt_link_source_level_source_row_number_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.jlpt_link
    ADD CONSTRAINT jlpt_link_source_level_source_row_number_fkey FOREIGN KEY (source_level, source_row_number) REFERENCES staging.jlpt_entry(level, row_number);


--
-- Name: kanji kanji_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji
    ADD CONSTRAINT kanji_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: kanji kanji_jlpt_new_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji
    ADD CONSTRAINT kanji_jlpt_new_source_id_fkey FOREIGN KEY (jlpt_new_source_id) REFERENCES public.source(id);


--
-- Name: kanji_media kanji_media_asset_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji_media
    ADD CONSTRAINT kanji_media_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES core.media_asset(id) ON DELETE RESTRICT;


--
-- Name: kanji_media kanji_media_kanji_literal_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji_media
    ADD CONSTRAINT kanji_media_kanji_literal_fkey FOREIGN KEY (kanji_literal) REFERENCES core.kanji(literal) ON DELETE CASCADE;


--
-- Name: kanji_radical kanji_radical_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji_radical
    ADD CONSTRAINT kanji_radical_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: kanji_radical kanji_radical_kanji_literal_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji_radical
    ADD CONSTRAINT kanji_radical_kanji_literal_fkey FOREIGN KEY (kanji_literal) REFERENCES core.kanji(literal) ON DELETE CASCADE;


--
-- Name: kanji_radical kanji_radical_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji_radical
    ADD CONSTRAINT kanji_radical_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: kanji kanji_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.kanji
    ADD CONSTRAINT kanji_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: lexeme lexeme_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme
    ADD CONSTRAINT lexeme_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: lexeme_form_applies_to lexeme_form_applies_to_form_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_applies_to
    ADD CONSTRAINT lexeme_form_applies_to_form_id_fkey FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE;


--
-- Name: lexeme_form_applies_to lexeme_form_applies_to_target_form_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_applies_to
    ADD CONSTRAINT lexeme_form_applies_to_target_form_id_fkey FOREIGN KEY (target_form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE;


--
-- Name: lexeme_form lexeme_form_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form
    ADD CONSTRAINT lexeme_form_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: lexeme_form_char lexeme_form_char_form_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_char
    ADD CONSTRAINT lexeme_form_char_form_id_fkey FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE;


--
-- Name: lexeme_form_char lexeme_form_char_kanji_literal_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_char
    ADD CONSTRAINT lexeme_form_char_kanji_literal_fkey FOREIGN KEY (kanji_literal) REFERENCES core.kanji(literal) ON DELETE RESTRICT;


--
-- Name: lexeme_form_kanji_char lexeme_form_kanji_char_form_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_kanji_char
    ADD CONSTRAINT lexeme_form_kanji_char_form_id_fkey FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE;


--
-- Name: lexeme_form_kanji_char lexeme_form_kanji_char_kanji_literal_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_kanji_char
    ADD CONSTRAINT lexeme_form_kanji_char_kanji_literal_fkey FOREIGN KEY (kanji_literal) REFERENCES core.kanji(literal) ON DELETE RESTRICT;


--
-- Name: lexeme_form lexeme_form_lexeme_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form
    ADD CONSTRAINT lexeme_form_lexeme_id_fkey FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT;


--
-- Name: lexeme_form lexeme_form_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form
    ADD CONSTRAINT lexeme_form_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: lexeme_form_tag lexeme_form_tag_form_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_tag
    ADD CONSTRAINT lexeme_form_tag_form_id_fkey FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE;


--
-- Name: lexeme_form_tag lexeme_form_tag_tag_code_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_form_tag
    ADD CONSTRAINT lexeme_form_tag_tag_code_fkey FOREIGN KEY (tag_code) REFERENCES public.tag(code);


--
-- Name: lexeme lexeme_language_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme
    ADD CONSTRAINT lexeme_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: lexeme_level lexeme_level_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_level
    ADD CONSTRAINT lexeme_level_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: lexeme_level lexeme_level_lexeme_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_level
    ADD CONSTRAINT lexeme_level_lexeme_id_fkey FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id);


--
-- Name: lexeme_level lexeme_level_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme_level
    ADD CONSTRAINT lexeme_level_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: lexeme lexeme_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.lexeme
    ADD CONSTRAINT lexeme_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: media_asset media_asset_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.media_asset
    ADD CONSTRAINT media_asset_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: pronunciation pronunciation_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.pronunciation
    ADD CONSTRAINT pronunciation_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: pronunciation pronunciation_lexeme_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.pronunciation
    ADD CONSTRAINT pronunciation_lexeme_id_fkey FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT;


--
-- Name: pronunciation pronunciation_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.pronunciation
    ADD CONSTRAINT pronunciation_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: sense sense_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense
    ADD CONSTRAINT sense_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: sense_concept sense_concept_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept
    ADD CONSTRAINT sense_concept_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: sense_concept_candidate sense_concept_candidate_concept_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept_candidate
    ADD CONSTRAINT sense_concept_candidate_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT;


--
-- Name: sense_concept_candidate_review sense_concept_candidate_review_candidate_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept_candidate_review
    ADD CONSTRAINT sense_concept_candidate_review_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES core.sense_concept_candidate(id) ON DELETE RESTRICT;


--
-- Name: sense_concept_candidate_review sense_concept_candidate_review_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept_candidate_review
    ADD CONSTRAINT sense_concept_candidate_review_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id) ON DELETE RESTRICT;


--
-- Name: sense_concept_candidate sense_concept_candidate_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept_candidate
    ADD CONSTRAINT sense_concept_candidate_run_id_fkey FOREIGN KEY (run_id) REFERENCES core.mapping_run(id) ON DELETE RESTRICT;


--
-- Name: sense_concept_candidate sense_concept_candidate_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept_candidate
    ADD CONSTRAINT sense_concept_candidate_sense_id_fkey FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: sense_concept sense_concept_concept_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept
    ADD CONSTRAINT sense_concept_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES core.concept(id) ON DELETE RESTRICT;


--
-- Name: sense_concept sense_concept_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept
    ADD CONSTRAINT sense_concept_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id);


--
-- Name: sense_concept sense_concept_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept
    ADD CONSTRAINT sense_concept_sense_id_fkey FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: sense_concept sense_concept_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_concept
    ADD CONSTRAINT sense_concept_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: sense sense_definition_language_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense
    ADD CONSTRAINT sense_definition_language_id_fkey FOREIGN KEY (definition_language_id) REFERENCES public.language(id);


--
-- Name: sense_form sense_form_form_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_form
    ADD CONSTRAINT sense_form_form_id_fkey FOREIGN KEY (form_id) REFERENCES core.lexeme_form(id) ON DELETE CASCADE;


--
-- Name: sense_form sense_form_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_form
    ADD CONSTRAINT sense_form_sense_id_fkey FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE CASCADE;


--
-- Name: sense_gloss sense_gloss_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_gloss
    ADD CONSTRAINT sense_gloss_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: sense_gloss sense_gloss_language_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_gloss
    ADD CONSTRAINT sense_gloss_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.language(id);


--
-- Name: sense_gloss sense_gloss_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_gloss
    ADD CONSTRAINT sense_gloss_sense_id_fkey FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: sense_gloss sense_gloss_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_gloss
    ADD CONSTRAINT sense_gloss_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: sense sense_lexeme_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense
    ADD CONSTRAINT sense_lexeme_id_fkey FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT;


--
-- Name: sense_relation sense_relation_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation
    ADD CONSTRAINT sense_relation_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: sense_relation_candidate sense_relation_candidate_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation_candidate
    ADD CONSTRAINT sense_relation_candidate_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id);


--
-- Name: sense_relation_candidate sense_relation_candidate_source_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation_candidate
    ADD CONSTRAINT sense_relation_candidate_source_sense_id_fkey FOREIGN KEY (source_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: sense_relation_candidate sense_relation_candidate_target_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation_candidate
    ADD CONSTRAINT sense_relation_candidate_target_sense_id_fkey FOREIGN KEY (target_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: sense_relation sense_relation_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation
    ADD CONSTRAINT sense_relation_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id);


--
-- Name: sense_relation sense_relation_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation
    ADD CONSTRAINT sense_relation_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: sense_relation sense_relation_source_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation
    ADD CONSTRAINT sense_relation_source_sense_id_fkey FOREIGN KEY (source_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: sense_relation sense_relation_target_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_relation
    ADD CONSTRAINT sense_relation_target_sense_id_fkey FOREIGN KEY (target_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: sense sense_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense
    ADD CONSTRAINT sense_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: sense_tag sense_tag_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_tag
    ADD CONSTRAINT sense_tag_sense_id_fkey FOREIGN KEY (sense_id) REFERENCES core.sense(id) ON DELETE CASCADE;


--
-- Name: sense_tag sense_tag_tag_code_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sense_tag
    ADD CONSTRAINT sense_tag_tag_code_fkey FOREIGN KEY (tag_code) REFERENCES public.tag(code);


--
-- Name: source_entry_identity source_entry_identity_lexeme_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.source_entry_identity
    ADD CONSTRAINT source_entry_identity_lexeme_id_fkey FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT;


--
-- Name: source_entry_identity source_entry_identity_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.source_entry_identity
    ADD CONSTRAINT source_entry_identity_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: source_form source_form_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.source_form
    ADD CONSTRAINT source_form_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: source_form source_form_lexeme_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.source_form
    ADD CONSTRAINT source_form_lexeme_id_fkey FOREIGN KEY (lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT;


--
-- Name: source_form source_form_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.source_form
    ADD CONSTRAINT source_form_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: translation_assertion translation_assertion_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_assertion
    ADD CONSTRAINT translation_assertion_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: translation_assertion translation_assertion_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_assertion
    ADD CONSTRAINT translation_assertion_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id);


--
-- Name: translation_assertion translation_assertion_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_assertion
    ADD CONSTRAINT translation_assertion_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: translation_assertion translation_assertion_source_lexeme_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_assertion
    ADD CONSTRAINT translation_assertion_source_lexeme_id_fkey FOREIGN KEY (source_lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT;


--
-- Name: translation_assertion translation_assertion_source_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_assertion
    ADD CONSTRAINT translation_assertion_source_sense_id_fkey FOREIGN KEY (source_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: translation_assertion translation_assertion_target_language_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_assertion
    ADD CONSTRAINT translation_assertion_target_language_id_fkey FOREIGN KEY (target_language_id) REFERENCES public.language(id);


--
-- Name: translation_target_candidate translation_target_candidate_assertion_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_target_candidate
    ADD CONSTRAINT translation_target_candidate_assertion_id_fkey FOREIGN KEY (assertion_id) REFERENCES core.translation_assertion(id) ON DELETE RESTRICT;


--
-- Name: translation_target_candidate translation_target_candidate_mapping_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_target_candidate
    ADD CONSTRAINT translation_target_candidate_mapping_run_id_fkey FOREIGN KEY (mapping_run_id) REFERENCES core.mapping_run(id);


--
-- Name: translation_target_candidate translation_target_candidate_target_lexeme_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_target_candidate
    ADD CONSTRAINT translation_target_candidate_target_lexeme_id_fkey FOREIGN KEY (target_lexeme_id) REFERENCES core.lexeme(id) ON DELETE RESTRICT;


--
-- Name: translation_target_candidate translation_target_candidate_target_sense_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.translation_target_candidate
    ADD CONSTRAINT translation_target_candidate_target_sense_id_fkey FOREIGN KEY (target_sense_id) REFERENCES core.sense(id) ON DELETE RESTRICT;


--
-- Name: wordnet_relation wordnet_relation_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.wordnet_relation
    ADD CONSTRAINT wordnet_relation_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: wordnet_relation wordnet_relation_lexicon_source_synset_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.wordnet_relation
    ADD CONSTRAINT wordnet_relation_lexicon_source_synset_id_fkey FOREIGN KEY (lexicon, source_synset_id) REFERENCES core.wordnet_synset(lexicon, synset_id);


--
-- Name: wordnet_relation wordnet_relation_lexicon_target_synset_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.wordnet_relation
    ADD CONSTRAINT wordnet_relation_lexicon_target_synset_id_fkey FOREIGN KEY (lexicon, target_synset_id) REFERENCES core.wordnet_synset(lexicon, synset_id);


--
-- Name: wordnet_synset wordnet_synset_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.wordnet_synset
    ADD CONSTRAINT wordnet_synset_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: wordnet_synset wordnet_synset_concept_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.wordnet_synset
    ADD CONSTRAINT wordnet_synset_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES core.concept(id);


--
-- Name: wordnet_synset wordnet_synset_source_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.wordnet_synset
    ADD CONSTRAINT wordnet_synset_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.source(id);


--
-- Name: ili_map_pwn30 ili_map_pwn30_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ili_map_pwn30
    ADD CONSTRAINT ili_map_pwn30_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: jlpt_entry jlpt_entry_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.jlpt_entry
    ADD CONSTRAINT jlpt_entry_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: jmdict_entry jmdict_entry_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.jmdict_entry
    ADD CONSTRAINT jmdict_entry_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: kanji_data_entry kanji_data_entry_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.kanji_data_entry
    ADD CONSTRAINT kanji_data_entry_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: kanji_entry kanji_entry_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.kanji_entry
    ADD CONSTRAINT kanji_entry_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: krad_entry krad_entry_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.krad_entry
    ADD CONSTRAINT krad_entry_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: omw_wikt_vi omw_wikt_vi_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.omw_wikt_vi
    ADD CONSTRAINT omw_wikt_vi_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: tatoeba_link tatoeba_link_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.tatoeba_link
    ADD CONSTRAINT tatoeba_link_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: tatoeba_sentence tatoeba_sentence_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.tatoeba_sentence
    ADD CONSTRAINT tatoeba_sentence_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: wikt_entry wikt_entry_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.wikt_entry
    ADD CONSTRAINT wikt_entry_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: wn_example wn_example_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.wn_example
    ADD CONSTRAINT wn_example_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: wn_relation wn_relation_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.wn_relation
    ADD CONSTRAINT wn_relation_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: wn_synset wn_synset_batch_id_fkey; Type: FK CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.wn_synset
    ADD CONSTRAINT wn_synset_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES staging.import_batch(id);


--
-- Name: sense_pair; Type: MATERIALIZED VIEW DATA; Schema: serve; Owner: -
--

REFRESH MATERIALIZED VIEW serve.sense_pair;


--
-- PostgreSQL database dump complete
--

