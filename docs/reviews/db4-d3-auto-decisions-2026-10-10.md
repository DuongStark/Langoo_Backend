# DB4-D3 — Bộ quyết định mapping tự động

Ngày: 2026-10-10. Trạng thái: code/test đã kiểm tra local và chạy pilot thật.
Chưa commit/push/deploy/import/promote DB.

## Kết quả trên dữ liệu Muse hiện có

Generation 100 sense, 345 candidate/69 bundle; final D4 ledger 137/138 validated
output. Không gọi Muse thêm, không dùng thêm token hoặc mở kết nối DB.

| Trạng thái theo target                                 | Số lượng |
| ------------------------------------------------------ | -------: |
| Cùng exact duy nhất, không unresolved; proposal cho D6 |       20 |
| Có hai phase nhưng chưa đủ rule exact                  |       44 |
| Hai lượt all-none trong shortlist                      |        4 |
| Thiếu một phase hợp lệ                                 |        1 |
| Không có candidate/bundle từ D2                        |       31 |
| Tổng target retrieval                                  |      100 |

340 candidate decisions trên 68 bundle đủ hai phase: 20 accept_exact,
94 accept_nonexact, 94 reject_pair, 132 defer. Bundle thiếu phase không có
decision D1 giả cho năm candidate. Nonexact không thuộc exact-proposals hoặc
được promote như tương đương. Reject chỉ là pair trong run, không reject sense.

Đây là kết quả policy, **không là measured semantic precision hoặc link đã apply**.
Hai lượt cùng Muse có thể cùng sai. Manifest giữ `semanticQualityValidated=false`,
`promotionReady=false`, `apply=false`.

## Thay đổi và lý do

- `_decisions.ts`: unique exact/consensus, unresolved/defer; match candidateKey,
  không so thứ tự/lời giải thích làm điều kiện đồng thuận.
- `muse-review-decide.ts`: hash/source-proof/generation binding, rebuild rendered
  payload, đối chiếu normalized với raw responses qua D1; giữ denominator.
- `_mapping-types.ts`: shared bound decision checker/parser theo bundle; schema
  giữ nguyên. Tránh validate toàn context lặp theo từng candidate. Caller mutation
  không làm đổi các inputs private đã parse.
- `decisions.test.ts`: regression policy, data drift, thiếu phase, immutable rerun,
  parser equivalence và bounded input.
- 500 target/generation, 64 MiB/file; chưa benchmark batch 500/toàn JLPT trên VPS.

## Artifact và chạy lại

```bash
npx tsx scripts/db4/muse-review-decide.ts \
  uploads/db4-d2-pilot \
  muse-d4-v1/manifest.json \
  muse-d4-v1/validated/1b03b68ea623/summary.json
```

Artifact private/ignored local:
`uploads/db4-d2-pilot/muse-d3-v1/208f8206aa7dc1f3810f29df36bebb91f2f4b0f48b5a5a81b7109f04d9c3c90e/`.
Manifest SHA256:
`dea13711617ae20f8be2e94052408075347c2d0bbbee3308880c2c4f375b7a61`.
Same-input rerun trả cùng ref, không sửa source/output gốc.
Lượt đo CLI cuối trên local (bao gồm startup npx/tsx): **21,24 giây**, peak RSS
**445.764 KiB (~435 MiB)**. Thay shared parser và giữ request metadata vẫn tạo
đúng cùng manifest/file hashes với phiên bản trước tối ưu. Đây là một observation
trên cohort hiện tại, không là benchmark VPS hoặc cơ sở suy ra thời gian 15k target.

## Kiểm tra thực tế

- `node --import tsx --test scripts/db4/*.test.ts`: **55/55 pass**, gồm 14 test D3,
  30 D1 và 11 D2; không fail/skip. Fixture synthetic kiểm rule/contract, không
  chứng minh accuracy model.
- `npx tsc -p tsconfig.db4.json`: pass.
- `npx eslint scripts/db4/_mapping-types.ts scripts/db4/_decisions.ts scripts/db4/muse-review-decide.ts scripts/db4/decisions.test.ts --max-warnings 0`: pass.
- CLI pilot và same-input reruns: cùng hash/counts, 20 exact proposals/340 pair
  decisions; không sửa raw output. Invalid/altered-normalized/proof-drift/count
  mismatch/bounded-file tests fail trước publish theo đúng kỳ vọng.
- Prettier code + hai tài liệu D3: pass; 161 link file nội bộ của tài liệu consumer
  tồn tại; `git diff --check` và whitespace cả code/docs chưa track pass. Đã kiểm
  trạng thái working tree; tất cả thay đổi chặng này vẫn chưa commit/push.
- Không chạy backend build/E2E DB/provider live: lượt này chỉ thay offline scripts;
  D6/D7/actual DB writes chưa triển khai. Chưa có lexical calibration/scoring mới.

## Gate và bước tiếp

- D3 không yêu cầu người vận hành duyệt từng mapping.
- DB4-D5: đo chất lượng/false-exact với source reference/audit đúng loại;
  consistency/synthetic fixture không là semantic accuracy benchmark.
- DB4-D6: DB test import/apply/rollback/idempotence, target guard và journal.
- DB4-D7: exact/curated/confidence serving phù hợp, API regression trước VPS apply.
- D6/D7/VPS bulk orchestration chưa làm. Không đổi dữ liệu học, runtime API,
  provider config hoặc schema DB trong lượt này.

[Plan/CLI/consumer contract](../plans/db4-d3-auto-decisions.md).
Git: code/test/docs local chưa commit/push; không gom hoặc sửa thay đổi của
milestone khác đang có trong working tree.
