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
