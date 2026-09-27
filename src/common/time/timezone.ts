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

function localDateParts(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: value('year'), month: value('month'), day: value('day') };
}

function startOfLocalDateUtc(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date {
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  // The first estimate can use either side of a DST transition. Re-evaluate
  // the offset at the candidate midnight so the returned instant is stable.
  const estimate = new Date(localMidnightAsUtc);
  const candidate = new Date(
    localMidnightAsUtc - timezoneOffsetMs(estimate, timezone),
  );
  return new Date(localMidnightAsUtc - timezoneOffsetMs(candidate, timezone));
}

/** Mốc 00:00 của ngày địa phương chứa `now`, trả về dưới dạng UTC. */
export function startOfDayUtc(now: Date, timezone: string): Date {
  const { year, month, day } = localDateParts(now, timezone);
  return startOfLocalDateUtc(year, month, day, timezone);
}

/** Mốc 00:00 của ngày kế tiếp theo timezone — dùng cho burying. */
export function nextDayStartUtc(now: Date, timezone: string): Date {
  const { year, month, day } = localDateParts(now, timezone);
  const next = new Date(Date.UTC(year, month - 1, day) + 86_400_000);
  return startOfLocalDateUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timezone,
  );
}

/** Ngày địa phương dạng YYYY-MM-DD (dùng cho streak_day, daily cap XP). */
export function localDateString(now: Date, timezone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(now);
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
