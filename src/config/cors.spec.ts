import {
  DEFAULT_CORS_ORIGINS,
  describeCorsRule,
  parseCorsOrigins,
} from './cors';

describe('parseCorsOrigins', () => {
  it('dùng danh sách mặc định khi biến trống hoặc undefined', () => {
    expect(DEFAULT_CORS_ORIGINS).toEqual([
      'http://localhost:*',
      'https://langoo.org',
      'https://www.langoo.org',
      'https://admin.langoo.org',
    ]);

    for (const raw of [undefined, '', '   ', ', ,']) {
      const rules = parseCorsOrigins(raw);
      expect(rules).not.toBeNull();
      const list = (rules as Array<string | RegExp>).map(describeCorsRule);
      expect(list).toHaveLength(4);
      expect(list[1]).toBe('https://langoo.org');
      expect(list[2]).toBe('https://www.langoo.org');
      expect(list[3]).toBe('https://admin.langoo.org');
      expect(list[0]).toContain('localhost');
    }
  });

  it('tắt CORS khi fallback rỗng và biến trống', () => {
    expect(parseCorsOrigins(undefined, [])).toBeNull();
    expect(parseCorsOrigins('   ', [])).toBeNull();
  });

  it('hiểu "*" thành cho phép mọi origin (phản chiếu origin của request)', () => {
    expect(parseCorsOrigins('*')).toBe(true);
    expect(parseCorsOrigins(' * ')).toBe(true);
    expect(parseCorsOrigins('https://a.dev,*')).toBe(true);
  });

  it('trả danh sách origin đã trim khi không có "*"', () => {
    expect(parseCorsOrigins('https://a.dev, http://localhost:5173')).toEqual([
      'https://a.dev',
      'http://localhost:5173',
    ]);
    expect(parseCorsOrigins('https://a.dev,,')).toEqual(['https://a.dev']);
  });

  it('entry có "*" khớp mọi cổng localhost nhưng không khớp origin khác', () => {
    const rules = parseCorsOrigins('http://localhost:*');
    expect(rules).toHaveLength(1);
    const rule = (rules as Array<string | RegExp>)[0];
    expect(rule).toBeInstanceOf(RegExp);

    const regex = rule as RegExp;
    expect(regex.test('http://localhost:5173')).toBe(true);
    expect(regex.test('http://localhost:3000')).toBe(true);
    expect(regex.test('http://localhost')).toBe(false);
    expect(regex.test('https://localhost:5173')).toBe(false);
    expect(regex.test('http://localhost.evil.dev')).toBe(false);
    expect(regex.test('http://localhost:5173/evil')).toBe(false);
  });

  it('giữ nguyên origin không có "*" (không hiểu là regex)', () => {
    const rules = parseCorsOrigins('https://a.example.com,https://b.co');
    expect(rules).toEqual(['https://a.example.com', 'https://b.co']);
  });
});

describe('describeCorsRule', () => {
  it('in chuỗi nguyên văn và pattern RegExp dạng đọc được', () => {
    expect(describeCorsRule('https://langoo.org')).toBe('https://langoo.org');
    const [rule] = parseCorsOrigins('http://localhost:*') as RegExp[];
    expect(describeCorsRule(rule)).toContain('localhost');
    expect(describeCorsRule(rule)).not.toMatch(/^\^|\$$/);
  });
});
