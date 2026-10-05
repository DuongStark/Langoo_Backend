# DB3-B — B2 offline tooling, 05/10/2026

## Kết quả và phạm vi

Đã tích hợp B0/B1 vào main (`39b9fe9`, `b79c047`). Queue thật có 15.245 needs_translation, 0 eligible_source; 34.758 ambiguous và 5.368 blocked_source giữ ngoài translator. B2 triển khai pipeline machine gloss cho queue hiện tại, không chạy B3 hoặc apply full local/VPS.

Contract example riêng đã commit main `097e1d6`, cherry-pick sang nhánh DeepSeek `d3c5804`: [`example schema v1`](../plans/db3-b-example-schema-v1.md). DeepSeek dùng `_example-types.ts` harvest Tatoeba song song, dedupe cặp JA/VI, giữ hướng link và lineage sentence/link; `alignment=unmapped`. Số 8.477 cần đối chiếu count raw links/unique pairs, không tự gán sense hoặc seed example.

## Công cụ đã triển khai

| File | Chức năng |
| --- | --- |
| `_gloss-types.ts` | Giữ candidate/job v1; thêm response và review schema, binding input/output hash, 100 target duy nhất, gate ≥98 pass/0 severe |
| `_gloss-artifacts.ts` | Root-relative path, chặn symlink/traversal, hash, atomic/fsync file, khóa job |
| `_gloss-provider.ts` | Stub có output fixture explicit; Go Responses/chat adapter, chỉ lấy assistant text, bounded response, không log key |
| `gloss-translate.ts` | Dry-run mặc định, chọn 100 JA sense có ≥10 ca đa nghĩa, reserve budget, retry tối đa 3, cache/checkpoint/resume |
| `gloss-review.ts` | Export context JA/EN/source + 100 output; template fail/UNREVIEWED, không overwrite artifact review |
| `gloss-apply.ts` | Guard DB và human review; append lô 50, register child trước mutation, resume COMMIT, rollback ngược |
| `_mutations.ts` | Allowlist gloss/metadata, prepared recovery, giữ lineage/history khi rollback, bảo vệ job phụ thuộc |
| `verify-gloss.ts` | Read-only coverage, anomaly, serving flags, child/run/journal và gloss dùng lại |

Output qua validator chỉ được gọi là `validated` về JSON/ID/length, chưa chứng minh đúng nghĩa. Apply thật cần 100 output non-null được người đọc JA–VI review; chỉ mẫu pass được ghi. Dòng máy luôn machine, quality/reviewed fields NULL; không tự thay cache/status concept hoặc sense_concept.

Intent và response nằm trong `attempts/<jobKey>/` và `responses/<jobKey>/`, cache theo semantic input/provider/model/prompt/protocol. Job khác model không ghi đè response cũ. Attempt chưa biết kết quả giữ budget reservation và cần retry explicit; không tuyên bố provider exactly-once. Token/cost không có usage thật được giữ ước lượng bảo thủ; mọi retry/unknown vẫn tính cap. Giá hardcode theo policy đã chọn phải kiểm tra lại trước B3; cap nội bộ không thay cap billing phía provider.

Apply đối chiếu host/port/database, source/version/hash/license/batch, semantic ID, forms, accepted JLPT và context EN có thứ tự đầy đủ. Không resolve ID qua lemma sang VPS khác snapshot. Source/import_batch/mapping_run được giữ để audit khi rollback; run đánh dấu rolled_back. Gloss đã có sửa tiếp hoặc còn job hoàn tất phụ thuộc khiến rollback dừng.

Phạm vi còn cần mở rộng khi dữ liệu đủ điều kiện: job `eligible_source` trích xuất trực tiếp và `concept_label` chưa có contract executor riêng; hiện không có candidate eligible cho nhánh đó. Example là artifact do DeepSeek làm, không thuộc apply gloss. Công cụ concept_gloss đã có regression, không quảng bá cache concept hoặc trạng thái curated.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Candidate/job schema, example schema, translator/provider/review | 30/30 pass |
| Apply/rollback trên DB UUID mới riêng | 13/13 pass |
| Regression DB3-A dùng chung `_mutations.ts` | 14/14 pass |
| TypeScript strict cho scripts/db3, lint toàn repo, backend build | Pass (Node 22) |
| B1 thật → translator dry-run | 100 pending, attemptCount=0, tokens=0, costUsd=0; không ghi artifact/DB hoặc gọi LLM |

Dry-run đọc artifact B1 `harvest-2026-10-05T10-02-08-778Z/candidates.jsonl` SHA-256 `be7b6901aa30395f7468af998aa1a43ba85369043abfb4fb1f1075fa28dbd5d4`; inventory `2026-10-05T09-29-37-673Z-gloss-inventory.json`, fingerprint `730c5bd3b08b37821cc47124ef2a75160decc0977ceb449a0c68067cbc6671ee`. Artifact nằm trong worktree DeepSeek, gitignored; báo cáo không đồng nghĩa artifact đã được copy/backup trên VPS.

Regression bao gồm JSON/ID sai, null/incomplete, 401/403/429/5xx, Retry-After/timeout, cap trước gọi, checkpoint sau response, khóa concurrent, resume sau COMMIT, rank smallint, reviewed không bị ghi đè, bigint/timestamp, history/metadata, dependency rollback, nguồn/context/forms/JLPT/ILI/synset drift và `serve.sense_card` flags. Provider test dùng HTTP loopback mock; không gửi request LLM thật.

## Bàn giao B3/B4

1. Ops thu hồi key cũ đã lộ, đặt key mới vào `DB3_AI_API_KEY`; kiểm tra model/pricing/policy và budget theo plan. Không đưa key vào Git/chat. Phiên B2 chưa xác nhận xoay key.
2. Chỉ định reviewer JA–VI; export template/context và hoàn thành rubric cho 100 mẫu. Chưa review thì giữ artifact, không apply.
3. Chuẩn bị artifact directory bền vững và backup; dùng [README](../../scripts/db3/README.md#b2--dịch-review-apply-và-rollback-gloss) để chạy/resume/rollback. Trước VPS đối chiếu snapshot/ID, FE badge “Máy dịch · chưa duyệt” và credits nguồn.
4. DeepSeek hoàn tất example harvest theo contract v1 và bàn giao hash/counts/verify. B2 không tự seed example hoặc promote mapping DB4.
