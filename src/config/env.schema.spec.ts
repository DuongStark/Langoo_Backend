import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:5432/langoo_test',
  DIRECT_URL: 'postgresql://postgres:pw@127.0.0.1:5432/langoo_test',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789',
};

describe('validateEnv', () => {
  it('nhận cấu hình tối thiểu và áp giá trị mặc định', () => {
    const env = validateEnv(base);
    expect(env).not.toHaveProperty('AI_QUIZ_V3_MODEL');
    expect(env).not.toHaveProperty('AI_QUIZ_V3_CALL_TIMEOUT_MS');
    expect(env).not.toHaveProperty('AI_QUIZ_V3_ENABLED');
    expect(env).not.toHaveProperty('AI_QUIZ_V3_BUDGET_MS');
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(30);
    expect(env.ARGON2_MEMORY_COST).toBe(19456);
    expect(env.ARGON2_TIME_COST).toBe(2);
    expect(env.GOOGLE_OAUTH_REQUIRE_CHALLENGE).toBe(false);
  });

  it('coerce PORT và các biến số từ chuỗi', () => {
    const env = validateEnv({
      ...base,
      PORT: '8080',
      JWT_REFRESH_TTL_DAYS: '30',
      ARGON2_MEMORY_COST: '19456',
      ARGON2_TIME_COST: '2',
    });
    expect(env.PORT).toBe(8080);
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(30);
    expect(env.ARGON2_MEMORY_COST).toBe(19456);
  });

  it('chấp nhận TTL hợp lệ và giữ nguyên định dạng cấu hình', () => {
    for (const ttl of ['15m', '900', '900s', '1h', '1d']) {
      const env = validateEnv({ ...base, JWT_ACCESS_TTL: ttl });
      expect(env.JWT_ACCESS_TTL).toBe(ttl);
    }
  });

  it('từ chối TTL sai hoặc không dương', () => {
    for (const ttl of [
      'invalid',
      '0',
      '0m',
      '-1s',
      '1.5h',
      '1w',
      '999999999999999999999d',
    ]) {
      expect(() => validateEnv({ ...base, JWT_ACCESS_TTL: ttl })).toThrow(
        /JWT_ACCESS_TTL/,
      );
    }
  });

  it('thiếu DATABASE_URL → báo lỗi nêu rõ biến', () => {
    expect(() => validateEnv({ DIRECT_URL: base.DIRECT_URL })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('DATABASE_URL sai định dạng → báo lỗi nêu rõ biến', () => {
    expect(() =>
      validateEnv({ ...base, DATABASE_URL: 'khong-phai-url' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('PORT ngoài khoảng hợp lệ → báo lỗi', () => {
    expect(() => validateEnv({ ...base, PORT: '70000' })).toThrow(/PORT/);
  });

  it('NODE_ENV lạ → báo lỗi', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('biến optional nhận chuỗi rỗng (coi như chưa khai báo)', () => {
    const env = validateEnv({
      ...base,
      JWT_ACCESS_TTL: '',
      AI_API_KEY: '',
      AI_DAILY_REQUEST_LIMIT: '',
      GOOGLE_OAUTH_CLIENT_IDS: '',
    });
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.AI_API_KEY).toBeUndefined();
    expect(env.AI_DAILY_REQUEST_LIMIT).toBeUndefined();
    expect(env.GOOGLE_OAUTH_CLIENT_IDS).toBeUndefined();
  });

  it('GOOGLE_OAUTH_CLIENT_IDS nhận danh sách client id cách nhau dấu phẩy', () => {
    const env = validateEnv({
      ...base,
      GOOGLE_OAUTH_CLIENT_IDS:
        'web-client.apps.googleusercontent.com,ios-client',
    });
    expect(env.GOOGLE_OAUTH_CLIENT_IDS).toBe(
      'web-client.apps.googleusercontent.com,ios-client',
    );
  });

  it('parse cờ bắt buộc Google OAuth challenge', () => {
    expect(
      validateEnv({ ...base, GOOGLE_OAUTH_REQUIRE_CHALLENGE: 'true' })
        .GOOGLE_OAUTH_REQUIRE_CHALLENGE,
    ).toBe(true);
    expect(
      validateEnv({ ...base, GOOGLE_OAUTH_REQUIRE_CHALLENGE: '0' })
        .GOOGLE_OAUTH_REQUIRE_CHALLENGE,
    ).toBe(false);
    expect(() =>
      validateEnv({ ...base, GOOGLE_OAUTH_REQUIRE_CHALLENGE: 'maybe' }),
    ).toThrow(/GOOGLE_OAUTH_REQUIRE_CHALLENGE/);
  });

  it('JWT_ACCESS_SECRET thiếu hoặc quá ngắn → báo lỗi', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: base.DATABASE_URL,
        DIRECT_URL: base.DIRECT_URL,
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      validateEnv({ ...base, JWT_ACCESS_SECRET: 'ngan-qua' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('áp dụng MEDIA_BASE_URL mặc định https://media.langoo.org', () => {
    const env = validateEnv(base);
    expect(env.MEDIA_BASE_URL).toBe('https://media.langoo.org');
  });

  it('chấp nhận MEDIA_BASE_URL HTTPS hợp lệ với đường dẫn prefix', () => {
    const env = validateEnv({
      ...base,
      MEDIA_BASE_URL: 'https://cdn.langoo.org/v1/assets/',
    });
    expect(env.MEDIA_BASE_URL).toBe('https://cdn.langoo.org/v1/assets/');
  });

  it('từ chối MEDIA_BASE_URL không phải HTTPS, có user, query hoặc fragment', () => {
    const invalidUrls = [
      'http://media.langoo.org',
      'ftp://media.langoo.org',
      'https://user:pass@media.langoo.org',
      'https://media.langoo.org?foo=bar',
      'https://media.langoo.org#section',
      'https://media.langoo.org/#',
      'https://media.langoo.org/?',
      'not-a-url',
    ];
    for (const url of invalidUrls) {
      expect(() => validateEnv({ ...base, MEDIA_BASE_URL: url })).toThrow(
        /MEDIA_BASE_URL/,
      );
    }
  });
  it('accepts explicit thinking-off for chat and quiz', () => {
    const env = validateEnv({
      ...base,
      AI_CHAT_REASONING_EFFORT: 'none',
      AI_QUIZ_REASONING_EFFORT: 'none',
    });
    expect(env).toMatchObject({
      AI_CHAT_REASONING_EFFORT: 'none',
      AI_QUIZ_REASONING_EFFORT: 'none',
    });
  });
  it('rejects an invalid quiz reasoning effort', () => {
    expect(() =>
      validateEnv({ ...base, AI_QUIZ_REASONING_EFFORT: 'invalid' }),
    ).toThrow(/AI_QUIZ_REASONING_EFFORT/);
  });
});
