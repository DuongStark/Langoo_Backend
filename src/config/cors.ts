/** Một origin được phép: chuỗi chính xác, hoặc RegExp khi entry chứa `*`. */
export type CorsOriginRule = string | RegExp;

/** Giá trị cho option `origin` của `app.enableCors`. */
export type CorsOriginOption = true | CorsOriginRule[];

/**
 * Danh sách origin mặc định khi `CORS_ORIGINS` không được cấu hình:
 * dev local (mọi cổng của localhost) và hai domain web chính thức.
 */
export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:*',
  'https://langoo.org',
  'https://www.langoo.org',
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Entry chứa `*` (ví dụ `http://localhost:*`) thành RegExp; phần `*` khớp một
 * đoạn không chứa `/` — đủ cho cổng dev bất kỳ hoặc subdomain.
 */
function toRule(entry: string): CorsOriginRule {
  if (!entry.includes('*')) {
    return entry;
  }
  const pattern = entry
    .split('*')
    .map((part) => escapeRegExp(part))
    .join('[^/]+');
  return new RegExp(`^${pattern}$`);
}

/** Mô tả rule để ghi log (RegExp in ra pattern gốc, không kèm `^...$`). */
export function describeCorsRule(rule: CorsOriginRule): string {
  if (!(rule instanceof RegExp)) {
    return rule;
  }
  return rule.source.replace(/^\^/, '').replace(/\$$/, '');
}

/**
 * Chuyển biến `CORS_ORIGINS` thành option `origin`:
 * - undefined / rỗng / chỉ có dấu phẩy: dùng `fallback` (mặc định là
 *   `DEFAULT_CORS_ORIGINS`);
 * - có `*` đứng riêng một entry: `true` — phản chiếu origin của request, dùng
 *   được cùng `credentials` (chỉ nên dùng khi dev);
 * - còn lại: danh sách origin đã trim, bỏ phần tử rỗng; entry có `*` thành
 *   RegExp nên `http://localhost:*` khớp mọi cổng;
 * - `fallback` rỗng: `null` (tắt CORS).
 */
export function parseCorsOrigins(
  raw: string | undefined,
  fallback: readonly string[] = DEFAULT_CORS_ORIGINS,
): CorsOriginOption | null {
  const entries = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  const effective = entries.length > 0 ? entries : [...fallback];
  if (effective.length === 0) {
    return null;
  }
  return effective.includes('*') ? true : effective.map(toRule);
}
