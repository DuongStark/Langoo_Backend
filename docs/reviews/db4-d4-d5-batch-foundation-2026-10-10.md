# DB4-D3/D4 — Contract batch và conditional R2 foundation

Ngày: 2026-10-10. Implementation đang làm theo
[plan DB4-D4/D5 batch rollout](../plans/db4-d4-d5-automated-batch-rollout.md).
Đây là phần foundation local, chưa phải runner hoặc pilot có thể chạy.

## Thay đổi

- `scripts/db4/_batch-types.ts`
  - Batch manifest chỉ nhận `mode=shadow`, `apply=false`,
    `promotionReady=false`.
  - Khóa giới hạn targets/shard/generation/artifact/workers/repair/expansion/
    mapping dispatch/audit dispatch/timeout theo plan.
  - Thêm target strata/split, schedule job, hash job key, event ledger có sequence
    và previous-event hash, cùng schema status per target.
  - Giữ orchestration envelope riêng, không sửa D1.
- `scripts/db4/muse-batch-decide.ts`
  - R2 chỉ đủ điều kiện sau R1 D1-valid với đúng một exact và không unresolved.
  - R1 không đủ điều kiện yêu cầu R2 được đánh dấu `skipped`; không tạo decision
    hai lượt hoặc output hash R2 giả.
  - R1/R2 raw response ref và normalized output hash được giữ riêng.
  - Khi có đủ hai phase hợp lệ, dùng lại `decideMappingBundle()` D3. Exact,
    nonexact, ambiguous, compound, no-exact, invalid và transport-unknown giữ
    trạng thái riêng; không cấp calibrated confidence.

## Kiểm tra

- `npx tsc -p tsconfig.db4.json --noEmit` — pass.
- `npx eslint scripts/db4/_batch-types.ts scripts/db4/muse-batch-decide.ts --max-warnings 0` — pass.
- `prettier --check` hai file trên — pass.
- Unit/integration tests không chạy; không gọi Muse, không tạo job và không ghi DB.
- DB4 cohort được kiểm riêng bằng transaction PostgreSQL `REPEATABLE READ READ ONLY`
  trên VPS; số đếm trong plan chưa thay source data.

## Follow-up tests — 2026-10-10

Thêm `scripts/db4/muse-batch-decide.test.ts` để kiểm tra orchestration envelope
và conditional R2:

- R2 chỉ được đánh giá sau đúng một exact, không unresolved; khi cả hai lượt hợp
  lệ thì dùng pure D3 quyết định.
- No-exact, multiple-exact và unresolved R1 bắt buộc skip R2, nhưng target vẫn
  có terminal status trong denominator.
- Transport unknown không được diễn giải thành no-match; invalid R1 giữ raw ref.
- R2 state sai so với kết quả R1 bị từ chối.
- Event sequence/hash-chain bắt tamper và từ chối key nhạy cảm.

Kiểm tra: 8/8 tests mới và toàn bộ DB4 TypeScript suite 77/77 pass; TypeScript,
ESLint và Prettier pass. Tests dùng fixture synthetic, không đo semantic
accuracy. Chưa gọi Muse, tạo batch job hoặc ghi DB.

## Còn thiếu

- Cohort development/holdout, source audit và hybrid RRF retrieval đã chạy cho
  1.000 sense; semantic quality chưa được đo.
- Atomic batch artifacts/checkpoint, native runner/waves, conditional R2 dispatch,
  reconcile/breaker/systemd và progress/final report.
- Cross-generation binding, durable restart/recovery and dispatch-intent crash
  tests remain; current tests cover pure conditional decisions and event-chain
  integrity only.
- D5 audit coordinator, Pilot A/B gates, D6 journal/apply/rollback và D7 serving.

DB4-D2 đã freeze cohort 1.000, chạy source audit và hybrid RRF retrieval; xem
[review RRF](db4-d2-hybrid-rrf-2026-10-10.md),
[review selector](db4-d2-cohort-selector-2026-10-10.md) và
[review retrieval cohort](db4-d2-cohort-retrieval-2026-10-10.md).

Git code/test/plan/review commit `406c8b2` đã push; không deploy, không apply DB.
Durable runner/recovery, audit coordinator và technical smoke vẫn là gate trước
Muse.
