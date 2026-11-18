-- M6.3 — one recognizable state per face; retire XP entirely, keep activity/streak.
-- The migration runner wraps this file and its ledger entry in one transaction.
-- Deploy the matching application with this schema; old binaries use removed columns.
LOCK TABLE app.srs_state, app.review_log, app.srs_review_receipt,
  app.study_session, app.study_session_item, app.streak_day, app.user_stats,
  app.user_achievement, app.xp_event IN ACCESS EXCLUSIVE MODE;

-- Preserve provenance before deleting states/receipts. A receipt also identifies
-- recall logs whose SRS link was already detached. This is dev-only history:
-- remove every orphan log as its original direction can no longer be proved,
-- even if a surviving request receipt says recognize. Linked recognize stays.
CREATE TEMP TABLE m63_recall_reviews ON COMMIT DROP AS
SELECT r.id, r.reviewed_at, r.user_id, r.client_review_id
FROM app.review_log r
WHERE r.srs_id IS NULL
   OR EXISTS (SELECT 1 FROM app.srs_state s WHERE s.id = r.srs_id AND s.direction = 'recall')
   OR EXISTS (SELECT 1 FROM app.srs_review_receipt rr
     WHERE rr.user_id = r.user_id AND rr.client_review_id = r.client_review_id
       AND jsonb_path_exists(rr.request_payload, '$.**.direction ? (@ == "recall")'));

DELETE FROM app.review_log r USING m63_recall_reviews doomed
WHERE r.id = doomed.id AND r.reviewed_at = doomed.reviewed_at;
-- Match either receipt key or cached log ID (legacy and version1 envelopes).
-- Compare text; malformed historical JSON IDs must never abort the migration.
DELETE FROM app.srs_review_receipt receipt
WHERE EXISTS (SELECT 1 FROM m63_recall_reviews doomed
    WHERE doomed.user_id = receipt.user_id AND (
      doomed.client_review_id = receipt.client_review_id
      OR receipt.response_payload #>> '{review_log,id}' = doomed.id::text
      OR receipt.response_payload #>> '{response,review_log,id}' = doomed.id::text
    ))
   OR jsonb_path_exists(request_payload, '$.**.direction ? (@ == "recall")')
   OR jsonb_path_exists(response_payload, '$.**.direction ? (@ == "recall")');

DELETE FROM app.study_session ss
WHERE ss.kind <> 'quiz' AND (
  jsonb_path_exists(ss.settings, '$.**.direction ? (@ == "recall")')
  OR EXISTS (SELECT 1 FROM app.study_session_item si
    LEFT JOIN app.srs_state s ON s.id = si.srs_id
    WHERE si.session_id = ss.id
      AND (s.direction = 'recall'
        OR jsonb_path_exists(si.prompt, '$.**.direction ? (@ == "recall")')))
);
DELETE FROM app.srs_state WHERE direction = 'recall';
UPDATE app.srs_state SET buried_until = NULL WHERE buried_until IS NOT NULL;
ALTER TABLE app.srs_state
  DROP CONSTRAINT srs_state_face_id_direction_key,
  DROP CONSTRAINT srs_state_direction_check,
  DROP COLUMN direction,
  ADD CONSTRAINT srs_state_face_id_key UNIQUE (face_id);

-- Cached JSON is replayed verbatim by receipt handlers, so remove XP/badges recursively
-- rather than merely removing its relational tables/columns. User answer text is
-- intentionally left untouched; it is learner content, not an API response cache.
CREATE FUNCTION pg_temp.m63_without_xp(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb;
BEGIN
  IF jsonb_typeof(payload) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(key, pg_temp.m63_without_xp(value)), '{}'::jsonb)
    INTO result FROM jsonb_each(payload)
    WHERE key NOT IN ('xp','xp_amount','streak_xp','achievement_xp','xp_total',
      'xp_reward','xp_awarded','level','level_progress','xp_in_level','xp_for_next',
      'xpAmount','xpAwarded','xpTotal','xpReward','streakXp','achievementXp',
      'unlocked','achievements','badges','unseen_count','achievement_code');
  ELSIF jsonb_typeof(payload) = 'array' THEN
    SELECT COALESCE(jsonb_agg(pg_temp.m63_without_xp(value) ORDER BY ordinal), '[]'::jsonb)
    INTO result FROM jsonb_array_elements(payload) WITH ORDINALITY AS element(value, ordinal);
  ELSE RETURN payload;
  END IF;
  RETURN result;
END $$;
UPDATE app.srs_review_receipt
SET request_payload = pg_temp.m63_without_xp(request_payload),
    response_payload = pg_temp.m63_without_xp(response_payload);
UPDATE app.study_session_item
SET answer_receipt = pg_temp.m63_without_xp(answer_receipt)
WHERE answer_receipt IS NOT NULL;
UPDATE app.study_session SET settings = pg_temp.m63_without_xp(settings);

DROP TABLE app.xp_event;
DROP TABLE app.xp_rule;
DROP TABLE app.leaderboard_snapshot;
ALTER TABLE app.streak_day DROP COLUMN xp;
ALTER TABLE app.user_stats DROP COLUMN xp_total, DROP COLUMN level;
ALTER TABLE app.study_session DROP COLUMN xp_awarded;
DROP TABLE app.user_achievement;
DROP TABLE app.achievement;

-- reviews are represented once by review_log. Only legacy quiz answers count
-- toward streak: m11.3-v3 and m11.5-v1 explicitly do not award activity.
CREATE TEMP TABLE m63_activity ON COMMIT DROP AS
SELECT events.user_id,
       (events.occurred_at AT TIME ZONE COALESCE(settings.timezone, 'Asia/Ho_Chi_Minh'))::date AS day,
       count(*)::int AS review_count
FROM (
  SELECT user_id, reviewed_at AS occurred_at FROM app.review_log
  UNION ALL
  SELECT ss.user_id, si.answered_at
  FROM app.study_session_item si
  JOIN app.study_session ss ON ss.id = si.session_id
  WHERE ss.kind = 'quiz' AND si.answered_at IS NOT NULL
    AND COALESCE(ss.settings->>'quiz_version','') NOT IN ('m11.3-v3','m11.5-v1')
) events
LEFT JOIN app.user_settings settings ON settings.user_id = events.user_id
GROUP BY events.user_id, day;

DELETE FROM app.streak_day;
INSERT INTO app.streak_day(user_id, day, review_count, met_goal)
SELECT activity.user_id, activity.day, activity.review_count,
       activity.review_count >= COALESCE(settings.daily_goal,20)
FROM m63_activity activity
LEFT JOIN app.user_settings settings ON settings.user_id = activity.user_id;

-- Group consecutive local dates into streak islands. Longest uses all history;
-- current is zero when the latest day is older than yesterday in that user's TZ.
CREATE TEMP TABLE m63_streaks ON COMMIT DROP AS
WITH numbered AS (
  SELECT user_id, day, day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS island
  FROM m63_activity
), runs AS (
  SELECT user_id, min(day) AS start_day, max(day) AS end_day, count(*)::int AS length
  FROM numbered GROUP BY user_id, island
)
SELECT runs.user_id, max(runs.end_day) AS last_study_date,
       max(runs.length)::int AS streak_longest,
       COALESCE(max(runs.length) FILTER (
         WHERE runs.end_day >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(settings.timezone,'Asia/Ho_Chi_Minh'))::date - 1
       ),0)::int AS streak_current
FROM runs LEFT JOIN app.user_settings settings ON settings.user_id = runs.user_id
GROUP BY runs.user_id;

INSERT INTO app.user_stats(user_id) SELECT id FROM app.users ON CONFLICT DO NOTHING;
UPDATE app.user_stats stats SET
  reviews_total = (SELECT count(*)::int FROM app.review_log r WHERE r.user_id = stats.user_id),
  items_learned = (SELECT count(DISTINCT f.item_id)::int FROM app.srs_state s
    JOIN app.collection_item_face f ON f.id = s.face_id
    WHERE s.user_id = stats.user_id AND s.introduced_at IS NOT NULL),
  last_study_date = streak.last_study_date,
  streak_current = COALESCE(streak.streak_current,0),
  streak_longest = COALESCE(streak.streak_longest,0)
FROM app.users u LEFT JOIN m63_streaks streak ON streak.user_id = u.id
WHERE stats.user_id = u.id;

DROP FUNCTION pg_temp.m63_without_xp(jsonb);
