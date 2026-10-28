# M6 — Bổ sung từ loại vào dữ liệu flashcard SRS

Ngày: 2026-10-28. Yêu cầu: sửa backend và push theo chỉ định chủ dự án.

## Phạm vi và kế hoạch

- `GET /v1/srs/due`: đưa `DueRow.pos` đã được query từ `core.lexeme.pos` vào
  nội dung `kind: "word"`; không đổi query, scheduler, dữ liệu hoặc migration.
- Cập nhật response type, Swagger DTO, API docs và kiểm thử qua `SrsService.getDue`.
- Kiểm thử trước khi sửa cho cả recognize/recall, có từ loại/thiếu từ loại;
  sau sửa chạy unit suite, build, lint và diff-check, commit/push đúng phạm vi.
- Chỉ bổ sung contract flashcard đang được FE dùng qua `/srs/due`; không thay
  payload snapshot của `/sessions`, không sửa FE.

## Contract cho FE

Phía có `kind: "word"` luôn có thêm `pos: string | null`:

```json
{
  "kind": "word",
  "text": "走る",
  "reading": "はしる",
  "romanization": "hashiru",
  "pos": "verb"
}
```

- Recognize: đọc `card.prompt.pos` khi `card.prompt.kind === "word"`.
- Recall: đọc `card.answer.pos` khi `card.answer.kind === "word"`.
- Nội dung `kind: "meaning"` không được thêm `pos`.
- Giá trị lấy nguyên từ DB, không dịch/chuẩn hoá hoặc suy đoán từ chữ/nghĩa.
  Khi chưa có dữ liệu trả `null`; FE ẩn nhãn tương ứng.
- Đây là ví dụ cấu trúc, không phải cam kết mọi dữ liệu từ loại dùng cùng một
  bộ mã cố định. FE mapping nhãn cần chấp nhận giá trị chưa biết.
- Bổ sung field tương thích client cũ. FE cần bổ sung type/render để hiển thị;
  backend trả thêm field không tự thay giao diện.

## Kiểm tra và trạng thái

- RED: `npm test -- --runInBand src/srs/srs.service.spec.ts` thất bại đúng
  bốn ca thiếu `pos` trước khi sửa mapper.
- GREEN: `npm test -- --runInBand` pass 62 suite / 544 test trên Node 22.22.2.
  Log cảnh báo/lỗi giả lập của các test AI/feedback là các ca failure injection,
  không phải test fail.
- Build đầu trên checkout chung gặp TS2739 ở auth đang được chỉnh đồng thời
  (`UserResponse` thêm identities/has_password/has_google nhưng helper chưa đủ).
  Không sửa/gom WIP đó. Xuất snapshot tạm từ HEAD cộng đúng file dự định commit,
  dùng cùng dependencies/Prisma client; `npm run build` pass trên snapshot.
- `npm run lint` trên snapshot phát hiện hai lỗi matcher có sẵn của M7.3;
  CI nền `40625560390` cũng fail đúng hai lỗi đó. Sửa kiểu test riêng M7.3,
  sau đó lint toàn snapshot pass, không suppress rule.
- Các lượt build/lint/test song song ban đầu được dừng do thiếu RAM; kết quả
  nêu trên lấy từ lượt chạy hoàn tất, không tính lượt bị dừng là pass.
- `npm test -- --runInBand src/srs/srs.service.spec.ts src/sessions/sessions.service.spec.ts`
  trên snapshot: 2 suite / 13 test pass. `git diff --check` pass.
- Không có migration, chưa nghiệm thu FE hoặc response có dữ liệu thật trên VPS.
  Push main kích hoạt CI và pipeline tự deploy đang có.

Git: chuẩn bị commit/push theo yêu cầu; không đưa WIP auth hoặc tài liệu PDF
DOCS1 vào commit M6. Trạng thái release được bổ sung sau push.
