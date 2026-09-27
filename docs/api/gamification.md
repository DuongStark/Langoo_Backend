# API: Gamification (XP, streak, level, thành tích — M8)

Mọi lượt ôn (`POST /v1/srs/reviews`, `POST /v1/sessions/:id/answers`) cập nhật gamification
**trong cùng transaction** (CONTEXT §7.2): XP theo `app.xp_rule` + **daily cap** → `streak_day`
→ `user_stats` (cache) → thành tích. Retry mạng cùng khoá idempotency **không cộng đôi**.

## Luật XP (seed `app.xp_rule`)

| code | amount | daily_cap | Ghi chú |
|---|---|---|---|
| `review` | +1 | 200 | mỗi lượt ôn (mọi mode M6/M7) |
| `quiz_correct` | +5 | 200 | dành cho AI quiz (M11) |
| `streak_day` | +2 | 2 | **lượt ôn đầu tiên trong ngày**; khoá `streak:<user>:<day>` |

- Cap đếm theo **ngày địa phương** (`user_settings.timezone`); hết cap → lượt đó nhận 0 XP
  nhưng **vẫn ghi** `review_log`/`streak_day` (streak không đứt vì cap).
- Thành tích thưởng XP nguồn `achievement` (không cap), khoá `ach:<code>` — chỉ thưởng 1 lần.

## Streak & level

- `streak_day`: `review_count`, `xp`, `met_goal = review_count ≥ user_settings.daily_goal`.
- `streak_current`: hôm qua đã học → +1; hôm nay đã học → giữ; cũ hơn → reset 1;
  `streak_longest = max`. Tính tại thời điểm ghi, không cần cron 0h.
- Level: `level = floor(sqrt(xp_total / 100)) + 1` → **L2=100, L3=400, L4=900, L5=1600 XP**.
- `items_learned` = số `collection_item` có ≥1 face đã bắt đầu học (`srs_state.introduced_at`).

## GET /v1/me/stats

```bash
curl -s http://localhost:3000/v1/me/stats -H "Authorization: Bearer <token>"
```

```json
{
  "xp_total": 42, "level": 1,
  "level_progress": { "level": 1, "xp_in_level": 42, "xp_for_next": 100, "percent": 42 },
  "streak_current": 3, "streak_longest": 7, "last_study_date": "2026-09-27",
  "items_learned": 12, "reviews_total": 40,
  "today": { "day": "2026-09-27", "review_count": 12, "xp": 14, "met_goal": false, "goal": 20 }
}
```

User chưa hoạt động trả mặc định (`xp_total 0`, `level 1`, `streak 0`) — không tạo rác.

## GET /v1/me/achievements

```bash
curl -s http://localhost:3000/v1/me/achievements -H "Authorization: Bearer <token>"
# → {"data":[{"code":"streak_7","name_vi":"Chuỗi 7 ngày","category":"streak",
#             "xp_reward":30,"progress":3,"unlocked_at":null,"seen_at":null}, ...],
#    "unseen_count": 1}
```

Seed 5 thành tích: `words_100` (items_learned ≥ 100), `reviews_1000`, `streak_7`, `streak_30`,
`quiz_100` (quiz_correct — M11). `progress` là giá trị metric hiện tại (UI tự kẹp theo ngưỡng).

## POST /v1/me/achievements/seen

```bash
curl -s -X POST http://localhost:3000/v1/me/achievements/seen \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{}'                      # bỏ trống codes = đánh dấu tất cả
# → {"updated":1,"unseen_count":0}
```

Lỗi: `401 AUTH_TOKEN_MISSING` · `400 VALIDATION_FAILED` (`codes` không phải mảng string).

Swagger UI: `http://localhost:3000/docs` (nhóm **gamification**).
