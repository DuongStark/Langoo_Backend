import { defineConfig } from 'prisma/config';

/**
 * Cấu hình Prisma CLI cho Langoo.
 *
 * LƯU Ý: repo KHÔNG dùng `prisma migrate` / `prisma db push` / `prisma db pull`
 * — schema do `db/migrations/*.sql` quản lý. Vì vậy không cấu hình
 * `datasource.url` ở đây (các lệnh dùng: `prisma generate`, `prisma validate`).
 *
 * Nếu sau này chủ dự án duyệt dùng CLI đọc DB, thêm:
 *   datasource: { url: env('DIRECT_URL') }
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
});
