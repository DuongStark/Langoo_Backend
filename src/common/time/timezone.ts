/**
 * Tiện ích timezone — tính mốc ngày địa phương bằng Intl (không thêm thư viện).
 * DB lưu UTC; "ngày học"/daily limit tính theo `user_settings.timezone`.
 */

function timezoneOffsetMs(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Mốc 00:00 của ngày địa phương chứa `now`, trả về dưới dạng UTC. */
export function startOfDayUtc(now: Date, timezone: string): Date {
  const offset = timezoneOffsetMs(now, timezone);
  const local = new Date(now.getTime() + offset);
  const localMidnightAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  // Kiểm tra lại offset tại chính mốc nửa đêm (an toàn với DST).
  const candidate = new Date(localMidnightAsUtc - offset);
  return new Date(localMidnightAsUtc - timezoneOffsetMs(candidate, timezone));
}

/** Mốc 00:00 của ngày kế tiếp theo timezone — dùng cho burying. */
export function nextDayStartUtc(now: Date, timezone: string): Date {
  return startOfDayUtc(new Date(now.getTime() + 86_400_000), timezone);
}
