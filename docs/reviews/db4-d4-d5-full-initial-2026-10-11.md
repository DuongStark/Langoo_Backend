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
