# Bàn giao FE — Quiz Kanji M11.1

Backend thêm hai style MC: `kanji_reading` (Kanji → kana), `kanji_orthography`
(kana → Kanji). Ghép với `meaning` để trộn các slot MC; `quiz_type=mixed` còn
có fill_blank/matching. UI frontend chưa nằm trong phạm vi repo này.

## Tạo bài

```json
{
  "collection_id": "<uuid>",
  "quiz_type": "multiple_choice",
  "question_styles": ["meaning", "kanji_reading", "kanji_orthography"],
  "context_mode": "source_or_generated",
  "difficulty": "medium",
  "question_count": 10
}
```

Chọn Nghĩa / Đọc Kanji / Chọn Kanji / Trộn dạng. Chọn Có câu ngữ cảnh
(source_or_generated) hoặc Từ riêng lẻ (none) cho Kanji. `source` chỉ dùng câu
nguồn. Client cũ bỏ hai field mới vẫn hỏi nghĩa như trước. Difficulty không gắn nhãn N5–N1.

## Hiển thị và chấm

- GET detail và session item prompt có `question_style` + `context`.
- MC options vẫn `{index,text}`; gửi `{ordinal,option_index}` để chấm. Không đoán đáp án
  qua vị trí options, không cần frontend gọi AI.
- Nếu có context, render sentence một lần và highlight target. `prompt.text`/question
  prompt đã chứa câu và chỉ dẫn: không render thêm sentence lần hai nếu dùng toàn prompt.
- Highlight bằng `Array.from(sentence).slice(start,end).join('')`: offsets là code points,
  end exclusive. Đọc Kanji không thêm furigana; chọn Kanji không hiện câu gốc chứa đáp án.
- `origin=generated`: nhãn “Câu AI tạo”; dictionary: hiển thị attribution.
- Không có context thì render prompt dạng từ riêng lẻ; không coi null là lỗi.
- Explanation/correct answer chỉ lấy từ response sau trả lời. Metadata generator/evidence
  là nội bộ và không có trong GET/start.

## Lỗi

- 409 QUIZ_NOT_ENOUGH_ITEMS: báo chưa đủ dữ liệu/phương án/câu nguồn cho style yêu cầu.
- 503 QUIZ_CONTEXT_UNAVAILABLE: cấu hình ngữ cảnh chưa sẵn sàng.
- 503 QUIZ_CONTEXT_INVALID / AI_PROVIDER_UNAVAILABLE: tạo bài thất bại, cho thử lại.
- 429 cooldown/quota: giữ xử lý M11 hiện tại.
- Không tự bỏ style hoặc chuyển context thành none khi gặp lỗi; người học chọn lại rõ ràng.

Contract đầy đủ và curl ở [API quizzes](../api/quizzes.md).
