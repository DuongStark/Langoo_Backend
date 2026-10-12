# DB4-D4/D5 — Pilot đối chiếu pipeline agent khác (12/10/2026)

> Artifacts: `/opt/langoo/storage/db4-batches/db4-d4-d5-pilot-doi-chieu-2026-10-12/`
> (`pilot-input.json`, `pilot-them.json`, `pilot-result.jsonl`, `db4-pilot.py`).
> Input dùng **đúng bundle + 5 ứng viên** của cohort DB4-D2 (966 sense), lấy từ
> `generation/cohort-2026-10-10-v1/bundles.jsonl` và decisions R1 của họ.

## 1. Bối cảnh

Agent kia (DB4-D4/D5) sau ~38 giờ: 291/966 R1, 0 R2, **0 proposal**, breaker
transport mở liên tục phải canary thủ công (chi tiết: mục "Trạng thái D4/D5").
Pilot này so sánh trực tiếp trên cùng 40 sense:

- **Set A (20)**: sense mà pipeline của họ có "exact duy nhất ở R1" (r2_eligible).
- **Set B (20)**: sense mà pipeline của họ kết luận **không có exact**.

## 2. Pipeline pilot (của mình)

- Channel: **zen/go Responses API** (API key; khác hẳn `muse-native` cookie của họ).
- Pass 1: batch 8 sense/lần gọi → chọn 1 concept exact hoặc `null` (không bịa ngoài shortlist).
- Pass 2: batch xác nhận lại từng cặp sense↔concept (mô phỏng R1+R2 của họ nhưng gộp lô).
- Không đổi input (cùng bundle/candidates) → so sánh 1-1.

## 3. Kết quả

| Chỉ số | Kết quả |
|---|---|
| Thời gian | **9 lần gọi API / 19,7 giây** cho 40 sense (họ: ~2 ngày cho 291 R1 chưa xong) |
| Set A — đồng thuận concept | **17/20 trùng đúng concept họ chọn** (0 chọn sai khác) |
| Set A — mình bác | 3/20 (pass2 từ chối) — soi tay: ≥2 ca nghi họ **false positive** (vd 観衆 = "người xem" ≠ concept "buổi tụ tập khán giả"; 縛る ≠ "restrict to") |
| Set B — mình cũng `null` | 16/20 (đồng thuận "không exact") |
| Set B — mình tìm thêm được | **4/20 ca họ bỏ sót** (パーティー→"social gathering"; 解説→"act of explaining"; 兵器→"instrument used in fighting"; 国籍→"colors flown by ship") |
| Tỷ lệ proposal ước tính | ~21/40 = **52%** (vs 0 của họ) |

Ngoài ra: shortlist retrieval của họ có ca ứng viên kém (vd お茶 có "crystal tea",
"Marburg virus") — judge chọn null được, nhưng chất lượng candidate pool đáng xem lại.

## 4. Kết luận

1. **Nút thắt thật của D4/D5 là transport/tốc độ, không phải ngữ nghĩa**: cùng
   model (muse), cùng input, pipeline batch qua API key chạy 40 sense trong 20 giây
   và cho kết quả ngang/hơn (đồng thuận 17, bắt thêm 4, bác 3 nghi dương tính giả).
2. `muse-native` (cookie) + per-sense R1/R2 + breaker-canary thủ công là tổ hợp
   sai cho throughput: ước tính full 966 sense bằng pipeline batch chỉ ~190-250
   lần gọi, ~15-30 phút, ~$0.5.
3. Khung kiểm định/ledger/gate của họ vẫn tốt — nên **giữ lớp validation/audit,
   thay lớp transport/runner** bằng batch API (hoặc tối thiểu thêm retry-in-run
   để bỏ canary thủ công).

## 5. Đề xuất

- (a) Chạy full 966 sense bằng pipeline batch này để có **proposal set thật** cho
  D5 audit/gate của họ (đang là 0 → chặn toàn bộ chuỗi gate).
- (b) Hoặc yêu cầu agent kia thay transport rồi tự chạy tiếp với khung của họ.
