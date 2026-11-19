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

function isValidMediaBaseUrl(val: string): boolean {
  try {
    const url = new URL(val);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password || /[?#]/.test(val)) return false;
    return true;
  } catch {
    return false;
  }
}

/** URL reset cố định: tuyệt đối, không query/hash; HTTP chỉ cho loopback dev/test. */
function isValidPasswordResetUrl(val: string): boolean {
  try {
    const url = new URL(val);
    if (url.username || url.password || /[?#]/.test(val)) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1'
    );
  } catch {
    return false;
  }
}

/**
 * Schema biến môi trường (validate bằng zod khi app khởi động).
 *
 * Lưu ý giai đoạn:
 * - M0 chỉ BẮT BUỘC các biến hạ tầng (DB, cổng, log).
 * - Biến của các milestone sau (JWT, AI...) khai báo optional và sẽ được
 *   siết chặt dần khi milestone đó bắt đầu (không đổi ngoài phạm vi M0).
 */
export const envSchema = z
  .object({
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

    // CORS cho web FE: danh sách origin cách nhau dấu phẩy; trống = dùng
    // DEFAULT_CORS_ORIGINS (localhost mọi cổng + langoo.org + www.langoo.org + admin.langoo.org).
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

    // M2.3 B — Password recovery qua Resend. Đủ cả ba biến mới bật endpoint;
    // thiếu bất kỳ biến nào thì API trả 503 AUTH_PASSWORD_RESET_UNAVAILABLE.
    AUTH_PASSWORD_RESET_URL: z.preprocess(
      emptyToUndefined,
      z.string().optional(),
    ),
    RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    AUTH_PASSWORD_RESET_FROM: z.preprocess(
      emptyToUndefined,
      z.string().optional(),
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
    // M10.1 — timeout/stream: timeout provider (mặc định 60s), giới hạn token và
    // mức suy luận cho model reasoning (chỉ gửi khi cấu hình).
    AI_CHAT_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1_000).max(300_000).optional(),
    ),
    AI_CHAT_MAX_TOKENS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(32_000).optional(),
    ),
    AI_CHAT_REASONING_EFFORT: z.preprocess(
      emptyToUndefined,
      z
        .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
        .optional(),
    ),
    AI_DAILY_REQUEST_LIMIT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    // Quiz (M11): quota riêng + cooldown chống spam sinh quiz.
    AI_QUIZ_DAILY_LIMIT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    AI_QUIZ_COOLDOWN_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).optional(),
    ),
    AI_QUIZ_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
    AI_QUIZ_VALIDATOR_MODEL: z.preprocess(
      emptyToUndefined,
      z.string().optional(),
    ),
    // Transport riêng cho quiz ngữ cảnh (OpenAI-compatible); bỏ trống = dùng
    // AI_API_KEY/AI_BASE_URL chung với chat.
    AI_QUIZ_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    AI_QUIZ_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().optional(),
    ),
    AI_QUIZ_REASONING_EFFORT: z.preprocess(
      emptyToUndefined,
      z
        .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
        .optional(),
    ),
    AI_QUIZ_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1_000).max(300_000).optional(),
    ),

    // M11.5 — Worker nền 24/7 sinh & chấm chéo câu hỏi cho từ lẻ user lưu (DeepSeek + GLM).
    QUIZ_BANK_WORKER_ENABLED: z.preprocess(
      booleanEnv,
      z.boolean().default(false),
    ),
    QUIZ_BANK_GENERATOR_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().optional(),
    ),
    QUIZ_BANK_GENERATOR_API_KEY: z.preprocess(
      emptyToUndefined,
      z.string().optional(),
    ),
    QUIZ_BANK_GENERATOR_MODEL: z.preprocess(
      emptyToUndefined,
      z.string().optional(),
    ),
    QUIZ_BANK_VALIDATOR_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().optional(),
    ),
    QUIZ_BANK_VALIDATOR_API_KEY: z.preprocess(
      emptyToUndefined,
      z.string().optional(),
    ),
    QUIZ_BANK_VALIDATOR_MODEL: z.preprocess(
      emptyToUndefined,
      z.string().optional(),
    ),

    // M12.1 — Enable mandatory AI consent after FE rollout. Withdrawals always apply.
    PRIVACY_AI_CONSENT_REQUIRED: z.preprocess(
      booleanEnv,
      z.boolean().default(false),
    ),

    // M12 — Hardening.
    RATE_LIMIT_ENABLED: z.preprocess(booleanEnv, z.boolean().default(true)),
    SCHEDULER_ENABLED: z.preprocess(booleanEnv, z.boolean().default(true)),
    CHAT_RETENTION_DAYS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).default(180),
    ),
    DB_POOL_MAX: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(100).optional(),
    ),
    DB_POOL_IDLE_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1_000).max(600_000).optional(),
    ),
    DB_POOL_CONNECTION_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1_000).max(60_000).optional(),
    ),

    // M13 — lưu trữ ảnh feedback (local dev; s3 là backlog).
    STORAGE_PROVIDER: z.preprocess(
      emptyToUndefined,
      z.enum(['local', 's3']).default('local'),
    ),
    STORAGE_DIR: z.preprocess(emptyToUndefined, z.string().optional()),

    // M14.3 — Public base URL cho ảnh minh họa concept (R2/CDN).
    MEDIA_BASE_URL: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine(
          isValidMediaBaseUrl,
          'phải là HTTPS URL hợp lệ không chứa user, search hoặc hash',
        )
        .default('https://media.langoo.org'),
    ),
  })
  .superRefine((data, ctx) => {
    const resetUrl = data.AUTH_PASSWORD_RESET_URL;
    if (resetUrl !== undefined) {
      if (!isValidPasswordResetUrl(resetUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_PASSWORD_RESET_URL'],
          message:
            'phải là URL tuyệt đối không query/hash; HTTP chỉ cho loopback dev/test',
        });
      } else if (
        data.NODE_ENV === 'production' &&
        new URL(resetUrl).protocol !== 'https:'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_PASSWORD_RESET_URL'],
          message: 'phải dùng HTTPS trong production',
        });
      }
    }

    if (!data.QUIZ_BANK_WORKER_ENABLED) return;
    const requiredFields = [
      'QUIZ_BANK_GENERATOR_BASE_URL',
      'QUIZ_BANK_GENERATOR_API_KEY',
      'QUIZ_BANK_GENERATOR_MODEL',
      'QUIZ_BANK_VALIDATOR_BASE_URL',
      'QUIZ_BANK_VALIDATOR_API_KEY',
      'QUIZ_BANK_VALIDATOR_MODEL',
    ] as const;
    for (const field of requiredFields) {
      if (!data[field] || data[field].trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `bắt buộc khi QUIZ_BANK_WORKER_ENABLED=true`,
        });
      }
    }
    if (
      data.QUIZ_BANK_GENERATOR_MODEL &&
      data.QUIZ_BANK_VALIDATOR_MODEL &&
      data.QUIZ_BANK_GENERATOR_MODEL.trim().toLowerCase() ===
        data.QUIZ_BANK_VALIDATOR_MODEL.trim().toLowerCase()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['QUIZ_BANK_VALIDATOR_MODEL'],
        message:
          'QUIZ_BANK_VALIDATOR_MODEL phải khác QUIZ_BANK_GENERATOR_MODEL để chấm chéo độc lập',
      });
    }
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
