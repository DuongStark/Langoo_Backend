# DB4-D4/D5 — Batch đối chiếu full 966 + audit (12/10/2026)

> Artifacts: `/opt/langoo/storage/db4-batches/db4-d4-d5-batch-crossconfirm-2026-10-12/`
> (proposals, disagreements, their-format, scripts, checkpoints).
> Tiếp nối pilot [`db4-d4-d5-pilot-doi-chieu-2026-10-12.md`](db4-d4-d5-pilot-doi-chieu-2026-10-12.md).

## 1. Chạy full 966 sense (muse batch qua zen/go)

| Chỉ số | Kết quả |
|---|---|
| Pass1 chọn concept | 651/966 (67,4%) |
| Pass2 xác nhận (muse) | **521 final (54%)** |
| Unresolved | 445 (315 pass1 không chọn + 130 pass2 bác) |
| Thời gian | **11,9 phút** (203 call batch 8, 8 song song) |
| Cross-check phụ (longcat) | 504 chấm — chỉ 288 OK (55%) → model yếu/ồn, **không dùng** trong tập cuối |

## 2. Cross-confirm bằng Space Bunny (`space-bunny-alpha` = minimax-m3)

Trên 521 pick của muse: ban đầu thống kê "198 bác" nhưng **không đúng** — có ~19 lần gọi
bị lỗi parse (content rỗng → `Expecting value: line 1 column 1`) làm 152 mục chưa
được chấm thật (mỗi call batch 8 nên 1 lỗi mất 8 mục). Sau retry chia nhỏ batch
(6 → tách đôi → từng mục), chấm được 500/521, còn **14 mục không chấm được** (để riêng).

| Kết quả chốt | Số |
|---|---|
| **High-confidence (muse ∩ bunny)** | **430 (82,5% của pick)** |
| Bunny bác | 77 (14,8%) — lý do phần lớn hợp lý (narrower/broader: アイデア, テンポ, 案, 営む…) |
| Chưa chấm được (lỗi transport dai dẳng) | 14 (2,7%) |
| Chi phí bunny confirm | ~$0,16 (66+27 call) |

Đối chiếu 100-sense trước đó: khi cả hai cùng chọn → **trùng concept 92%**; bunny-only
7 ca (đa số lệch — không dùng bunny làm người gọi chính); 6/6 mẫu trùng soi tay đều chuẩn.

**Verdict hai model**: muse = recall tốt (54% pick) nhưng over-accept ~15%;
bunny = strict, hợp làm **giám khảo thứ 2**; giao 2 model = precision cao.

## 3. Deliverables (cho khung D5/validator của agent kia)

| File | Nội dung |
|---|---|
| `db4-proposals-high.jsonl` | **430 proposal** (muse∩bunny) — tập chính để audit/apply |
| `db4-disagreements.jsonl` | 77 ca muse-only bị bunny bác (kèm lý do) — audit ưu tiên |
| `db4-proposals-unknown.jsonl` | 14 ca chưa chấm được |
| `db4-full-proposals.jsonl` | 521 ca toàn bộ pick muse (rộng) |
| `db4-full-unresolved.jsonl` | 445 ca không pick (kèm lý do pass1/pass2) |
| `db4-high-their-format.jsonl` | **430 ca theo contract `sense_concept_review`** (reviews/candidateKey/coveredBranches + `adapter`/`crossConfirm`) — để feed validator/ledger của họ |

Chưa apply DB, chưa đổi gì runtime — đúng gate.

## 4. So sánh với pipeline agent kia (cùng cohort 966)

| | Agent kia (muse-native cookie) | Batch này (API key) |
|---|---|---|
| Thời gian | 38h → 291/966 R1, R2 = 0 | **~30 phút cho cả 966 + cross-confirm** |
| Proposal | 0 | **430 high-confidence** |
| Chi phí | không rõ (cookie) | bunny ~$0,16; muse qua zen |

Lưu ý: 2 judge đều là LLM (muse + minimax-m3); audit mẫu không thay expert gold —
khuyến nghị chạy D5 audit/gate của họ + spot-check người trước khi promotion/apply.

## 5. Rollback

Không có thay đổi DB/runtime. Xoá artifact dir nếu cần.
