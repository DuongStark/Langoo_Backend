/** Giá trị cho option `origin` của `app.enableCors`. */
export type CorsOriginOption = true | string[];

/**
 * Chuyển biến `CORS_ORIGINS` thành option `origin`:
 * - undefined / rỗng / chỉ có dấu phẩy: `null` (tắt CORS);
 * - có `*`: `true` — phản chiếu origin của request, dùng được cùng `credentials`;
 * - còn lại: danh sách origin đã trim, bỏ phần tử rỗng.
 */
export function parseCorsOrigins(
  raw: string | undefined,
): CorsOriginOption | null {
  if (raw === undefined) {
    return null;
  }
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  if (origins.length === 0) {
    return null;
  }
  return origins.includes('*') ? true : origins;
}
