# DB4-D4/D5 — Chạy toàn bộ initial generation trên VPS

Ngày: 2026-10-11. Yêu cầu: “cho chạy hết đi”.

## Phạm vi và thay đổi

- Cohort frozen 1.000 sense: xử lý toàn bộ 966 có candidate, giữ 34 no-candidate.
  R1 toàn queue còn lại, R2 chỉ cho effective R1 đạt gate; 8 workers/account.
- Thêm `scripts/ops/db4-batch/continue-shadow.py` và tests; consumer runbook/plan
  đã ghi phạm vi mới. Orchestrator riêng giữ mapping release `82c4fa1` bất biến
  theo repair pin. Không sửa runner/D1/D3/raw/schedule hoặc app runtime.
- Chờ recovery service thành công, lấy final result/report có hash binding,
  kiểm denominator/gate/pin, sau đó nối original R1 → conditional R2 → report.
  Không lấy repair wave tùy tiện theo thứ tự file. Transport parked/failed,
  report tamper, pin mismatch đều dừng trước dispatch. Không retry unknown.
- Đây là phạm vi initial generation theo yêu cầu mới; chưa triển khai expansion
  hoặc Pilot A/B. Report không được coi là đạt gate chất lượng. Apply/serving đóng.

## Kiểm tra và trạng thái

- Ops unittest: 16/16 pass (10 regression mới, gồm review fixes RED → GREEN).
- Python py_compile pass. Không cần reset DB hoặc chạy API suite.
- Fresh review có 2 Important: systemd transient completion/GC và stop signal
  trong lúc kiểm report. Đã sửa một pass: bind final result vào đúng InvocationID
  của current boot, hỗ trợ active/exited; kiểm STOP trước dispatch từng phase.
  Không còn finding Important chưa xử lý. Scoped diff-check/Git/deploy ghi dưới đây.
- Git: code local trong worktree cô lập; chưa commit/push bản bổ sung lúc lập.
- VPS: recovery smoke đang chạy; full continuation chưa launch lúc lập.

## Gate còn thiếu

- Kết quả thật của all-ready run, expansion, Pilot A/B, promotion, DB4-D6/D7.
- Không suy ra chất lượng semantic từ tests orchestration hoặc số reply đã nhận.

## 2026-10-11 — DB4-D4/D5 — Đã commit/push và khởi động full continuation

- Code/tests/plan/runbook đã commit/push `145ec65`. Không gom WIP DB4/FE khác.
- Orchestrator đã cài root-owned/read-only tại
  `/opt/langoo/services/db4-batch/orchestrators/145ec65/continue-shadow.py`.
  SHA256 local/VPS cùng
  `7e9d0ffeb588a78fd9422c1dce4836d0ae4cc735e250efe5300b5795373a4f82`.
  CLI chạy được dưới user `langoo`. Mapping release vẫn là `82c4fa1` sạch/bất biến.
- Unit `langoo-db4-full-initial-20261011-145ec65.service` đã launch và xác nhận
  active/running. Journal stage `wait_predecessor`, predecessor
  `langoo-db4-recover-20261011-82c4fa1.service`, InvocationID chính xác
  `4ee41f4e26154978916a78be808436da`. Predecessor hiện ở R1 repair preflight;
  chưa có bằng chứng mới rằng full R1 đã dispatch tại thời điểm ghi.
- Tham số full: 8 workers, timeout 240s/request, phase cap bằng readyCount,
  wait predecessor tối đa 3 giờ; runtime unit tối đa 24 giờ. Resource limits:
  MemoryHigh 550 MiB, MemoryMax 650 MiB, swap 0, CPU 100%, không auto-restart.
  Native account/run locks, no-resend và source integrity vẫn giữ.
- Sandbox unit: NoNewPrivileges, PrivateTmp, ProtectSystem=strict; chỉ ghi artifact
  root và native lock directory, cookie file mount read-only. Không thay app/DB.
- Offline report cũ đã exit 0, elapsed 26:40.84, CPU 11:28.550,
  max RSS 191,448 KiB theo `/usr/bin/time`; không OOM.
  Số này chỉ là profile report cũ, không phải latency/yield full Muse batch.
- Gates expansion/Pilot A/B/promotion/apply/serving vẫn chưa mở. 34 no-candidate
  không được tự tạo mapping để lấp denominator. Invalid/unknown có thể còn sau run.
- Theo dõi: `systemctl status langoo-db4-full-initial-20261011-145ec65.service`
  và `journalctl -u langoo-db4-full-initial-20261011-145ec65.service -n 30 --no-pager`.
  Ledger/report nằm trong frozen artifact root đã nêu ở recovery review/runbook.
  Khi đang chờ hoặc child preflight, journal không phản ánh số Muse calls mới;
  cần đọc ledger/status để thống kê. Job chạy tiếp khi SSH/máy cá nhân đóng,
  transient unit không tự sống lại sau VPS reboot.

## 2026-10-11 — DB4-D4/D5 — Phục hồi transport sau 121 lượt R1 mới

- Batch 8 workers đã gửi 121 R1 mới. Effective validation: 108 validated,
  10 invalid_output, 4 transport_unknown, 844 pending trong 966 ready targets.
  118 distinct senses có reply (119 raw replies gồm original + repair của một
  sense); 57 sense đủ R2 gate, R2 chưa dispatch. D1 pass không là semantic audit.
- Breaker mở vì `consecutive_transport_failures`; bốn lượt unknown ghi
  `GatewayError`, status -1, phase generate. Không đủ evidence quy lỗi cho rate
  limit hoặc khẳng định 8 workers là nguyên nhân. Job đang report sau khi park.
- Native `vm.health` probe riêng đã thành công trong 4.360 ms; artifact lưu ở
  diagnostics của run, không overwrite M10.5 probe gốc hoặc in cookie/exception URL.
  Đây là evidence kết nối phục hồi, chưa chứng minh generation đã ổn định.
- Cấu hình riêng `langoo-db4-transport-canary-20261011.service`: giữ pin `82c4fa1`,
  clear breaker một lần sau health probe, workers 1 và max-dispatches 1. Không
  resend unknown/completed. Gate ExecStartPost kiểm chính ledger: đúng một intent
  sau breaker clear, reply saved của đúng job, không mở breaker mới. Exit 0 của
  native CLI không đủ. Type oneshot để post gate chạy sau generation/validation.
- OnSuccess chỉ nối `langoo-db4-full-resume4-20261011.service` nếu gate đó đạt;
  orchestrator `145ec65` giữ immutable release/repair pin, chạy pending R1 với
  4 workers → conditional R2 → final report. Native vẫn kiểm breaker/preflight.
  Giảm concurrency là lựa chọn phục hồi tải kết nối, chưa là benchmark tối ưu.
- Canary time cap 2 giờ; full runtime 24 giờ; RAM max 650 MiB, swap 0, CPU 100%,
  no auto-restart, cookie read-only. Không enable tự chạy sau reboot vì prior
  completion được bind vào InvocationID/current boot của smoke recovery.
- Kiểm tra: ops unittest 18/18; gồm timing post gate RED→GREEN và actual post
  command trên 5 ledger fixtures (saved đúng job, saved khác job, unknown, breaker,
  nhiều intent). `systemd-analyze verify` sẽ kiểm lại hai unit trước cài.
- Trạng thái lúc ghi: cấu hình đã lưu local, chuẩn bị commit/push/cài; chưa có
  kết quả canary. Gate expansion/Pilot A/B/promotion/apply/serving vẫn đóng.
