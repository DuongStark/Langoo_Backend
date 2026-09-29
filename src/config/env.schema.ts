import { z } from 'zod';
import { isValidTtl } from './jwt-ttl';

/** Giá trị rỗng trong .env coi như không khai báo (tránh lỗi min/coerce không cần thiết). */
function emptyToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function booleanEnv(value: unknown): unknown {
  const normalized = emptyToUndefined(value);
  if (normalized === undefined || typeof normalized === 'boolean') {
    return normalized;
  }
  if (typeof normalized === 'string') {
    if (['true', '1', 'yes', 'on'].includes(normalized.toLowerCase())) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized.toLowerCase())) {
      return false;
    }
  }
  return normalized;
}

/**
 * Schema biến môi trường (validate bằng zod khi app khởi động).
 *
 * Lưu ý giai đoạn:
 * - M0 chỉ BẮT BUỘC các biến hạ tầng (DB, cổng, log).
 * - Biến của các milestone sau (JWT, AI...) khai báo optional và sẽ được
 *   siết chặt dần khi milestone đó bắt đầu (không đổi ngoài phạm vi M0).
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Kết nối DB: runtime (pooled) và direct (migration/DDL).
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  // Biến xác thực — BẮT BUỘC từ M2 (secret ≥32 ký tự ngẫu nhiên).
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .refine(isValidTtl, 'phải là TTL dương dạng 15m, 900s hoặc 900')
      .default('15m'),
  ),
  JWT_REFRESH_TTL_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(30),
  ),
  ARGON2_MEMORY_COST: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(19456),
  ),
  ARGON2_TIME_COST: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(2),
  ),

  // CORS cho web FE khi deploy (danh sách origin cách nhau dấu phẩy; trống = tắt).
  CORS_ORIGINS: z.preprocess(emptyToUndefined, z.string().optional()),

  // Đăng nhập Google (M2.2): danh sách client ID được chấp nhận (web/iOS/Android,
  // cách nhau dấu phẩy). Trống = tắt endpoint OAuth (trả 503).
  GOOGLE_OAUTH_CLIENT_IDS: z.preprocess(
    emptyToUndefined,
    z.string().optional(),
  ),
  // Chỉ bật sau khi web/iOS/Android đã gửi challenge_id + binding_secret.
  GOOGLE_OAUTH_REQUIRE_CHALLENGE: z.preprocess(
    booleanEnv,
    z.boolean().default(false),
  ),

  // Biến AI — dùng từ M10, optional ở M0.
  AI_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['stub', 'openai', 'gemini']).optional(),
  ),
  AI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  AI_CHAT_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
  // Base URL kiểu OpenAI (chat/completions) — dùng được gateway như OpenCode Zen.
  AI_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  AI_DAILY_REQUEST_LIMIT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Cấu hình biến môi trường không hợp lệ: ${details}`);
  }
  return parsed.data;
}
