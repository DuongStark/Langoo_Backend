-- 036_gamification_reviews_total_srs.sql — M8.2 (chốt 2026-10-03).
-- `app.user_stats.reviews_total` chỉ đếm lượt ôn SRS (nguồn ReviewEngine),
-- không đếm câu quiz M11. Quiz vẫn tính streak_day.review_count/met_goal/XP.
-- Trước đây mọi applyActivity đều +1 (kể cả quiz), nên rebuild lại bộ đếm từ
-- app.review_log — nguồn đúng của lượt ôn SRS. Không hạ achievement đã mở khoá:
-- user_achievement.progress/unlocked_at chỉ tiến, code không thu hồi.

UPDATE app.user_stats us
SET reviews_total = COALESCE(sub.n, 0)
FROM (
  SELECT u.id AS user_id, count(rl.id)::int AS n
  FROM app.users u
  LEFT JOIN app.review_log rl ON rl.user_id = u.id
  GROUP BY u.id
) sub
WHERE us.user_id = sub.user_id;
