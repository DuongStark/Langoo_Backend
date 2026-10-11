# DB4-D4/D5 — Report có checkpoint và repair định dạng có giới hạn

Ngày: 2026-10-11. Trạng thái cập nhật: code đã commit/push và cài runner riêng
trên VPS. Job phục hồi đang chạy nền, chờ report cũ; chưa có kết quả repair/R2 thật.

## Đầu ra và lý do

- `_batch-jsonl.ts` đọc JSONL theo từng dòng, kiểm byte/row cap, LF, schema và
  SHA256; không giữ cả shard request trong RAM. Preflight giữ identity compact
  của R1/R2. Validator vẫn giữ đầy đủ denominator và hash/binding checks.
- `batch-report.ts` đọc một request tại một thời điểm; checkpoint immutable theo
  shard bind run/validation/shard refs, target identity và evaluation hashes.
  Resume dùng lại shard hoàn tất; không coi file evaluation lẻ là final report.
  Ledger/repair lineage thay đổi giữa hai validation thì report fail, phải retry.
  Mốc tiến độ được ghi ra stderr; summary/manifest chỉ ghi sau đủ denominator.
- `_batch-requests.ts` giữ contract request gốc và normalization; D1/D3 giữ nguyên.
- `_batch-repair.ts`, `batch-repair.ts` tạo/verify wave immutable riêng, không sửa
  schedule/raw gốc. Parent chain giữ cùng clean source pin; tối đa một repair
  cho mỗi target trong toàn chain. Binding đến original request, raw hash,
  parser error, payload/prompt hash và rejected validation. Cap kiểm trước load.
- Repair qua D1 + thứ tự candidate gốc + bảo toàn từng semantic field đã parse
  được, kể cả reason/confidence; đổi claim bị `semantic_change_during_repair`.
  Verdict thiếu được bổ sung; không lấy output phase còn lại. JSON không parse
  được vẫn phải qua toàn bộ D1 khi sửa. Provenance giữ raw gốc và raw repair.
- `muse-batch-runner.py` hỗ trợ `--repair-manifest` và `--repair-only`, durable
  intent riêng cho repair, không tự resend unknown. Metadata load trước preflight;
  payload phase load sau đó và được giải phóng trước Node validator. R2 repair
  dùng dependency R1 của original R2. Latest repair manifest cần truyền khi
  validate/report/status/reconcile; không truyền sẽ fail nếu ledger có repair job.
- `run-shadow.py` chạy repair resume → effective R1 validation → conditional R2
  → report; có tùy chọn `--auto-repair` cho luồng normal, mặc định chưa bật trong
  installed service template. Cap invocation không mở full shadow.
- Consumer/ops: [runbook](../../scripts/ops/db4-batch/README.md).

## Kiểm tra đã chạy

- `node --import tsx --test scripts/db4/*.test.ts`: **90/90 pass**.
- `python3 -m unittest discover -s scripts/db4 -p test_muse_batch_runner.py`:
  **17/17 pass**; direct invocation cũng 17/17.
- `python3 -m unittest discover -s scripts/ops/db4-batch -p 'test_*.py'`:
  **6/6 pass** (bao gồm recover-only và prior-report gate).
- `npx tsc -p tsconfig.db4.json --noEmit`: pass.
- ESLint và Prettier trên toàn bộ TS thay đổi: pass; Python `py_compile`: pass.
- Scoped `git diff --check`: pass trong worktree cô lập. Không chạy reset DB,
  migration, API app hoặc full NestJS suite vì chỉ sửa offline runner.
- Fresh code review phát hiện: parent pin chưa bind; payload repair còn resident
  qua validator; cap sau allocation; test Python nằm sau unittest.main. Đã sửa.
  Regression chứng minh metadata không giữ payload, mixed parent pin bị chặn và
  R2 repair dùng original R1 dependency. Không còn finding Important đã biết.

## VPS và gate còn thiếu

- Run frozen: `db4-smoke-20261011-8a2c475`; root cohort:
  `/opt/langoo/storage/db4-batches/db4-d2-jlpt-n1-n5-20261010-0208649`.
- Report thử streaming dưới 420 MiB cgroup / 256 MiB Node heap / 90% CPU
  bị dừng bởi `RuntimeMaxSec=600` trước hoàn tất; không phải OOM. CPU dùng 4:20.759.
- Lượt có checkpoint/progress:
  `langoo-db4-report-checkpoint-20261011.service`, 420 MiB cgroup, swap disabled,
  CPU quota 100%, runtime max 30 phút. Đang qua các shard preflight; quan sát
  khoảng 156–226 MiB cgroup. Các số này là quan sát, chưa phải peak cuối.
- Chưa có kết quả Muse repair hoặc R2 ở thời điểm lập tài liệu. Không suy ra
  chất lượng semantic từ test wiring hoặc memory profile.
- Expansion planner và Pilot A/B audit coordinator chưa triển khai. Shadow
  1.000, promotion, DB4-D6 import/journal/rollback và DB4-D7 serving tiếp tục đóng.
- Mọi việc trên VPS trong lượt này là isolated runner sidecar/offline artifact;
  không thay `/opt/langoo/app`, không ghi mapping DB hoặc deploy API.

## Quyết định trong phạm vi plan

- Giữ một source pin cho toàn repair chain. Muốn đổi code giữa các wave cần
  adapter migration/policy riêng; không ngầm chạy job parent dưới code khác.
- Semantic preservation bảo thủ: giữ cả reason/confidence đã parse. Có thể làm
  repair bị defer dù model diễn đạt lại cùng ý; đổi lại không nhận rewrite claim
  là sửa format. Raw/provenance được giữ để audit sau.
- Tăng timeout offline report từ 10 lên 30 phút vì RAM đã thấp và tiến độ có
  từng shard; không tăng dispatch budget hoặc worker count.

## 2026-10-11 — Commit và phục hồi nền

- Code foundation recovery đã commit/push `8db060c`; DB4/FE WIP khác giữ nguyên.
- Bổ sung coordinator `--recover-r1 --wait-for-report`: đợi report đầy đủ có hash,
  run binding/denominator và gate đóng, rồi tạo repair cho R1 bị invalid đang có.
  Không dispatch thêm original R1. Timeout đợi 30 phút; lỗi report dừng trước Muse.
- Kiểm tra bổ sung: ops Python 6/6, `py_compile` pass; sửa này chuẩn bị commit/push.
- Release runner mới được cài riêng trên VPS; cần kiểm pin/working tree trước
  dispatch. Tình trạng job thật được ghi ở mục tiếp theo khi đã launch.

## 2026-10-11 — DB4-D4/D5 — Runner recovery đã cài và job nền đã khởi động

- Git: foundation `8db060c`, coordinator recovery `82c4fa1` đã push lên `main`.
  Remote HEAD đã xác nhận `82c4fa18c19510f44b0a5ba86ff2561f5b7aebdc`.
- Release riêng: `/opt/langoo/services/db4-batch/releases/82c4fa1`. Đã kiểm tra
  Git HEAD và working tree sạch dưới user `langoo`; code root-owned/read-only,
  chỉ cấu hình Git safe.directory cho đúng release này. Không thay app runtime.
- Job: `langoo-db4-recover-20261011-82c4fa1.service`, systemd transient service,
  user `langoo`, RAM tối đa 600 MiB, không swap, CPU 100%, runtime tối đa 2 giờ.
  Chạy nền tiếp khi máy cá nhân đóng; unit transient không tự khởi động sau reboot.
- Tham số: `--recover-r1 --repair-cap 1 --r1-cap 1 --r2-cap 1 --workers 1
--timeout 240 --wait-for-report <prior-report-manifest>`. Không bật auto-repair.
- Prior report identity:
  `3a2d7de0ad6209f6acbe1c3249862fc0a86e0adaea57ee2bc1b474b02482733e`.
  Job xác minh report/hash/denominator/gate trước tạo wave, không dispatch original
  R1 thêm. Chỉ sửa một output invalid đã lưu; R2 tối đa một nếu effective R1 đủ gate.
- Xác minh thật: unit active/running, journal `wait_prior_report`. Report offline
  cũ đã qua preflight/validation và vào `report_shard:dev-02` lúc kiểm tra.
  Đây là trạng thái đang chạy, chưa phải report cuối hay Muse reply mới.
- Kiểm tra trước triển khai: ops tests 6/6 pass; CLI `--help` chạy được dưới user
  dịch vụ. Các gate expansion/Pilot A/B/shadow 1.000/apply/serving vẫn còn thiếu.
- Theo dõi: `systemctl status langoo-db4-recover-20261011-82c4fa1.service` và
  `journalctl -u langoo-db4-recover-20261011-82c4fa1.service -n 30 --no-pager`.
  Khi coordinator đang ở child preflight, artifact/ledger là nguồn trạng thái;
  stdout của child được coordinator thu lại, không stream realtime ra journal.
