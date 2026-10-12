# DB4-D4/D5 — Tiếp quản & kế hoạch hoàn thiện (12/10/2026)

> **Từ 12/10/2026, DB4-D4/D5 do phiên deepseek phụ trách** (chủ dự án giao toàn quyền).
> Pipeline `muse-native` (cookie) của phiên cũ **ngừng vận hành** — artifacts của họ
> giữ nguyên làm tham chiếu frozen; không canary/resume thêm.

## 1. Hiện trạng chốt (đợt 1 — cohort 1.000 sense)

| Hạng mục | Trạng thái |
|---|---|
| Population JLPT N1–N5 | 15.245 sense (N1 4.334 · N2 2.705 · N3 4.611 · N4 1.613 · N5 1.982); dev 3.112 / holdout 12.133 (chia theo lexeme) |
| Đợt 1 (selected 1.000: 200 dev + 800 holdout) | 966 ready + 34 no_candidate |
| Kết quả pipeline mới | **430 high** (muse pick + bunny confirm) · 77 bunny bác · 14 unknown · 445 unresolved |
| Split | dev 96/200 (48,0%) · holdout 334/800 (41,8%) |
| Pipeline cũ (agent kia) | dừng ở 291/966 R1, R2=0, 0 proposal (transport cookie hỏng) |
| Thời gian thay thế | full 966 + cross-confirm ≈ **30 phút** (vs 38h) |

## 2. Vai trò Space Bunny (`space-bunny-alpha`, ~minimax-m3)

1. **Giám khảo độc lập #2** (đã dùng): lọc 91 ca muse over-accept trên 521 pick →
   tập high 430 (precision cao hơn). Trùng concept 92% khi cả hai cùng chọn.
2. **Người hỏi chính vòng 2** cho 445 unresolved (bunny pass1+pass2, muse confirm chéo)
   → dự kiến vớt thêm 10-20% positive hợp lệ (từ pilot B: bunny tìm được ca muse bỏ sót).
3. **Xác nhận chéo toàn cohort** khi mở rộng (mỗi pick phải 2 model độc lập đồng ý).
4. Chi phí ~$0,5/1.000 sense; cần batch 8 + retry chia nhỏ (flaky content rỗng)
   và lưu ý dữ liệu đi qua router bên thứ ba.

## 3. Kế hoạch hoàn thiện

### GĐ1 — Chốt dữ liệu đợt 1 (hôm nay)
- Vòng 2: 445 unresolved (bunny→muse confirm) → tier-2 proposals; retry 14 unknown.
- Đầu ra: `db4-tier2-proposals.jsonl`, cập nhật high/unknown lists; mọi target có
  trạng thái cuối (proposal t1/t2 · unresolved lý do rõ).

### GĐ2 — Audit D5 (theo gate của họ: Pilot A + Pilot B)
- **Pilot A**: audit 100 target trạng thái cuối (ràng buộc: proposal phải đúng,
  unresolved phải đúng là không-có-exact-trong-shortlist).
- **Pilot B**: ≥100 positive (sample tier1+tier2) + ≥50 **hard-negative** (các ca
  bunny bác + các cặp gần đúng bị từ chối).
- Reviewer: phiên này (rubric exact-toàn-scope), verdict JSONL + summary + Wilson CI.
- Gate: **không severe** mới cho promote (severe = liên kết sai nghĩa được đề xuất,
  hoặc unresolved sai do bỏ sót exact rõ ràng).

### GĐ3 — D6 promote (code mới — chưa có)
- Viết `scripts/db4/promote/…`: đưa proposals đã audit đạt vào
  `core.sense_concept` (method mới, `verified=false` mặc định; chỉ `verified=true`
  nếu audit đạt từng ca), gắn `mapping_run` + batch_id + evidence;
  dry-run → apply transaction → verify counts → **rollback drill** (xoá theo run id).
- Lưu ý: `core.sense_concept` hiện có 577.525 dòng `wordnet_synset` (baseline verified)
  — promote không được đụng baseline; chỉ thêm dòng mới method riêng.

### GĐ4 — D7 serving
- Theo plan: gate serving + refresh (serve view/pair dùng mapping mới).
- Chốt danh sách consumer (sense_pair? projection?) trước khi mở.

### GĐ5 — Mở rộng cohort (sau, tùy chủ dự án)
- Population 15.245; mỗi đợt ~2.000 sense: bundle retrieval (MiniLM, pipeline D2 có sẵn)
  + batch muse + bunny confirm + audit mẫu. Ước: ~1-2h/2.000 sense.

## 4. Việc chạy ngay hôm nay
- [x] Vòng 2 cho 445 unresolved + retry 14 unknown (đang chạy nền).
- [ ] Audit Pilot A/B (sau khi có tier-2).
- [ ] Viết code D6 promote + dry-run.
- [ ] Report tổng + đề xuất gate apply cho chủ dự án.
