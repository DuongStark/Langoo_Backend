/**
 * Timezone an toàn cho e2e: chọn offset cố định sao cho giờ địa phương ~12:00,
 * tránh các mốc "hết ngày" (burying, interday learning, daily limit, streak)
 * cắt ngang test khi chạy gần nửa đêm theo timezone của user.
 *
 * Lưu ý: `Etc/GMT+N` là UTC−N (POSIX đảo dấu) — offset dương (đông) dùng `Etc/GMT-N`.
 */
export function safeTestTimezone(now: Date = new Date()): string {
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const offset = Math.max(-12, Math.min(14, Math.round(12 - utcHours)));
  if (offset === 0) {
    return 'UTC';
  }
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}
