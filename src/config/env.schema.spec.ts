import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:5432/langoo_test',
  DIRECT_URL: 'postgresql://postgres:pw@127.0.0.1:5432/langoo_test',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789',
};

describe('validateEnv', () => {
  it('nhận cấu hình tối thiểu và áp giá trị mặc định', () => {
    const env = validateEnv(base);
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
});
