# DB4 — Pilot A: kết quả chạy + audit mẫu (dừng sớm theo yêu cầu) · 2026-10-07

> Trạng thái: **pilot chạy xong 100/100 target**; audit LLM dừng ở **23/100** target (mẫu) để tiết kiệm thời gian. Artifact nằm trong `uploads/db4/` (gitignored).

## 1. Pilot (R1/R2 hai lượt)

| Hạng mục | Kết quả |
| --- | --- |
| Target | 100/100 `decision_ready` (500 cặp sense↔concept) |
| Batch 1 | 44 target — longcat-2.5-preview-free (58 target gồm retry) |
| Batch 2 | 42 target — deepseek-v4.1-flash (`reasoning_effort=minimal`) |
| Lỗi hạ tầng gặp phải | longcat hay bịa key JSON (đã sửa prompt), JSON cắt do reasoning dài (fix bằng `thinking:disabled`), input cũ `conceptPos` gây lỗi 26% (đã sửa) |
| Job files | `jobs/pilot-a-longcat.json` (44), `jobs/pilot-a-retry.json` (14), `jobs/pilot-a-ds.json` (42) |

**Phân bố quyết định (500 cặp):**

| Proposal | Số cặp |
| --- | --- |
| `accept_exact` | 37 |
| `accept_nonexact` | 106 |
| `reject_pair` | 245 |
| `defer` | 112 |

- 80/100 target có ≥1 accept; 20 target reject hết; 52 target có ≥1 defer.
- Relation: exact 47, related 107, broader 42, narrower 26, none 278.

## 2. Audit mẫu (23 target = 115 cặp, deepseek-v4.1-flash độc lập)

| Verdict | Số cặp | Severity |
| --- | --- | --- |
| pass | 95 | none 95 |
| fail | 19 | **minor 19** |
| deferred | 1 | (minor 1) |
| **severe** | **0** | |

## 3. Vấn đề phát hiện (từ các ca fail)

1. **Lệch hướng relation broader/narrower** — model 2 lượt cùng chọn `narrower` nhưng theo auditor phải là `broader` (sense rộng hơn concept), ví dụ:
   - 取りあえず (first of all / at once) → concept "without delay" — sense rộng hơn → đúng phải `broader`.
   - 損得 (loss and gain) → concept "disadvantage" — sense rộng hơn → phải `broader`.
   → Link vẫn hợp lý, chỉ sai nhãn hướng (minor). Prompt cần ví dụ hướng quan hệ rõ hơn.
2. **Policy defer hơi quá tay** — nhiều cặp cả 2 lượt đều `none` nhưng proposal vẫn `defer` (do unresolvedReason/disagreement) trong khi auditor cho là đủ bằng chứng để `reject_pair` (ví dụ 割り算, 決まる).
3. **Không có severe** — chưa thấy ca gán exact sai nghĩa/identity trong mẫu 23 target.

## 4. Đề xuất nếu quay lại DB4

1. Prompt review v2: thêm ví dụ định hướng `broader`/`narrower` (sense→concept) và ràng buộc chọn hướng.
2. Policy decision v2: nếu cả 2 lượt `none` (không kể uncertain) → `reject_pair`, không defer; chỉ defer khi thật sự bất đồng `broader/narrower/related/exact`.
3. Chạy lại pilot trên cùng manifest (cache chỉ giữ kết quả cũ theo provider; prompt mới = provider config mới nên chạy sạch ~200 call).
4. Audit đầy đủ 100 target khi cần gate chính thức (`mapping-audit.ts` đã sẵn: `DB4_AUDIT_EXTRA_JOBS`, `DB4_AUDIT_GATE_PILOT`).

## 5. Artifact liên quan

- Decisions: `uploads/db4/decisions/<jobKey>/<targetKey>.json`
- Responses R1/R2: `uploads/db4/responses/<jobKey>/<phase>/<bundleKey>/<n>.{raw,validated}.json`
- Audit mẫu: `uploads/db4/audits/<jobKey>/<targetKey>.json`
- Spot-check accept_exact: `/tmp/opencode/spotcheck-accept-exact.json` (37 ca)
