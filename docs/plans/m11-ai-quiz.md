# Kế hoạch M11 — AI Quiz

> Trạng thái: **đang triển khai** (chờ review). Ngày: 2026-09-30.
> Chốt với chủ dự án: đa dạng loại câu hỏi (kể cả `matching`), nguồn gồm cả thẻ `new`,
> quota riêng 15 quiz/ngày, cooldown 15s + dedup bấm đúp, XP chỉ khi trả lời đúng.

## 1. Mục tiêu & phạm vi

- Sinh quiz từ collection (stub provider deterministic — không cần key), lưu `app.quiz` + `app.quiz_question`.
- Loại câu hỏi: `multiple_choice`, `fill_blank`, `matching`, `mixed` (trộn cả 3).
- Làm bài qua `study_session(kind='quiz')` — chấm server-side, màn "câu sai" tái dùng `/sessions/:id/items`.
- XP `quiz_correct` (+5, cap 200) **chỉ khi đúng**; mọi câu trả lời vẫn cập nhật streak/`user_stats`/achievement.
- Chống lạm dụng token: quota riêng `AI_QUIZ_DAILY_LIMIT` (mặc định **15/ngày**), cooldown **15s** + dedup cùng tham số.
- **Không migration**, không thêm dependency.

**Backlog:** adapter LLM thật cho quiz (JSON mode), AI giải thích từng câu, matching ở chế độ review M7.

## 2. Quyết định đã chốt

| # | Nội dung | Chốt |
| --- | --- | --- |
| D1 | Loại câu hỏi | MC + fill_blank + matching + mixed |
| D2 | Nguồn từ vựng | item thuộc profile, collection không archive, không `paused`, có `srs_state` (**gồm cả `new`**); ưu tiên `review → relearning → learning → new`, rồi theo vị trí item |
| D3 | Provider quiz | `stub` cho M11 (kể cả khi `AI_PROVIDER=openai` — log cảnh báo); adapter thật để backlog |
| D4 | XP | chỉ câu đúng mới +XP; mọi câu → streak/activity (`xpEligible` thêm vào GamificationService) |
| D5 | Difficulty (stub) | MC: easy 3 phương án / medium-hard 4; FB: easy-medium chấp nhận thêm romaji, hard chỉ lemma+reading; matching: K = 3 easy / 4 còn lại |
| D6 | Lịch sử | `GET /v1/quizzes` (keyset) + `GET /v1/quizzes/:id` (không lộ đáp án, kèm ≤5 session gần nhất) |
| D7 | Hết hạn quiz | 7 ngày; start muộn → `409 QUIZ_EXPIRED` |
| D8 | Trả lời | dùng lại `POST /sessions/:id/answers` (thêm field `pairs` cho matching); phiên quiz trả `srs: null` |
| D9 | Chống lạm dụng | quota 15/ngày (env `AI_QUIZ_DAILY_LIMIT`), cooldown 15s (env `AI_QUIZ_COOLDOWN_MS`), dedup cùng tham số trong cooldown → trả quiz cũ (`reused: true`); **không tiêu quota khi validate thất bại** |

## 3. API

| Endpoint | Mô tả |
| --- | --- |
| `POST /v1/quizzes` | `{collection_id?, quiz_type, difficulty, question_count 1..50}` → 201 `{...quiz, reused}`; sinh đồng bộ (stub) |
| `GET /v1/quizzes?limit&cursor` | lịch sử + tóm tắt session gần nhất |
| `GET /v1/quizzes/:id` | meta + câu hỏi (không đáp án) + ≤5 session |
| `POST /v1/quizzes/:id/start` | tạo `study_session(kind='quiz')` + snapshot câu hỏi → trả như M7 |
| `POST /v1/sessions/:id/answers` | trả lời (option_index/answer_text/pairs) — quiz trả `srs: null` |

Lỗi: `409 QUIZ_NOT_ENOUGH_ITEMS` · `429 QUIZ_GENERATION_COOLDOWN` · `429 AI_QUOTA_EXCEEDED` ·
`409 QUIZ_EXPIRED` · `404 QUIZ_NOT_FOUND` · `503 AI_PROVIDER_UNAVAILABLE`.

## 4. Sinh câu hỏi (stub, hàm thuần + RNG injectable)

- MC: `prompt "Nghĩa của 「X」 là gì?"`, `options [{index,text}]`, `correct_answer {index,text}` (khớp chấm M7).
- FB: `prompt 'Điền từ còn thiếu (nghĩa: "Y")'`, `correct_answer {accepted:[...]}`.
- Matching: `options {left:[{index,text}], right:[{index,text}]}`, `correct_answer {mapping:[{left_index,right_index}]}`;
  chấm **all-or-nothing** (sai 1 cặp = sai cả câu). Cột `quiz_question.options` buộc jsonb **array**
  (CHECK 023) nên lưu dạng mảng gắn nhãn `side: left|right`, tách ra khi start.
- mixed: luân phiên MC → FB → matching theo thứ tự câu.
- Validate trước khi tiêu quota: thiếu từ / MC không đủ 2 nghĩa khác nhau / matching <2 từ → `409` kèm `available`.

## 5. Chống lạm dụng (chi tiết)

1. Quota riêng feature `quiz` (`app.ai_usage`, reserve nguyên tử như M10) — env `AI_QUIZ_DAILY_LIMIT` mặc định 15.
2. Cooldown `AI_QUIZ_COOLDOWN_MS` mặc định 15.000ms, so với `quiz.created_at` gần nhất:
   - cùng tham số (`quiz_type/difficulty/question_count/collection_id`) và `status='ready'` → trả quiz cũ, `reused: true` (không tiêu quota);
   - khác tham số → `429 QUIZ_GENERATION_COOLDOWN` kèm `retry_after_s`.
3. Validate nguồn từ vựng **trước** khi reserve quota.
4. `question_count ≤ 50` (schema) + quiz hết hạn 7 ngày.

## 6. File

```
src/common/pagination/time-cursor.ts            # cursor dùng chung (uuid/bigint) — chat refactor dùng lại
src/sessions/quiz-content.ts (+spec)            # types quiz + gradeQuizAnswer (MC/FB/matching)
src/ai/providers/ai-quiz.provider.ts + stub-quiz.provider.ts + ai-quiz-provider.factory.ts
src/ai/quiz/quiz-generator.ts (+spec)           # buildQuizQuestions (thuần)
src/ai/quiz/repositories/quiz-source.repository.ts
src/ai/quiz/{quiz.controller,quiz.service}.ts (+spec) · dto · types
src/sessions/sessions.service.ts (branch kind='quiz') · types · dto (pairs)
src/gamification/gamification.service.ts (xpEligible) (+spec)
test/quiz.e2e-spec.ts · docs/api/quizzes.md · .env.example · PROGRESS
```

## 7. Kiểm thử

- **Unit:** generator (3 loại + mixed, difficulty,thiếu nguồn, deterministic), gradeQuizAnswer (MC/FB/matching sai 1 cặp),
  cursor, quiz service (cooldown/dedup/quota/expired/ownership), gamification `xpEligible`.
- **E2E:** tạo user+profile+collection 6 từ → sinh MC 3 → start → trả lời 2 đúng 1 sai → `correct_count=2`, `score=67`,
  câu sai 1, XP `quiz_correct` = 10 và replay không cộng đôi; mixed sinh đủ 3 loại + trả lời matching/fill_blank;
  dedup/cooldown; quota 429; quiz người khác 404; hết hạn 409.
