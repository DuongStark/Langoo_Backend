import { withUtcTimezone } from './connection-url';

describe('withUtcTimezone', () => {
  it('adds UTC startup option without changing unrelated parameters', () => {
    const result = new URL(
      withUtcTimezone(
        'postgres://user:pass@localhost/langoo_test?sslmode=require&application_name=jest',
      ),
    );
    expect(result.searchParams.get('sslmode')).toBe('require');
    expect(result.searchParams.get('application_name')).toBe('jest');
    expect(result.searchParams.get('options')).toContain('-c timezone=UTC');
  });

  it('appends UTC after a conflicting timezone option', () => {
    const result = new URL(
      withUtcTimezone(
        'postgres://localhost/langoo_test?options=-c%20timezone%3DAsia%2FBangkok%20-c%20statement_timeout%3D5000',
      ),
    );
    expect(result.searchParams.get('options')).toBe(
      '-c timezone=Asia/Bangkok -c statement_timeout=5000 -c timezone=UTC',
    );
  });

  it.each([
    '-c timezone=UTC -c timezone=Asia/Bangkok',
    '-c timezone=UTC -c timezone=Asia/Bangkok -c timezone=Europe/Paris',
    '-c timezone=UTC -c statement_timeout=5000',
  ])(
    'UTC remains the final assignment and normalization is idempotent (%s)',
    (options) => {
      const url = new URL(
        'postgres://localhost/langoo_test?application_name=jest',
      );
      url.searchParams.set('options', options);
      const once = withUtcTimezone(url.toString());
      expect(new URL(once).searchParams.get('options')).toBe(
        `${options} -c timezone=UTC`,
      );
      expect(withUtcTimezone(once)).toBe(once);
      expect(new URL(once).searchParams.get('application_name')).toBe('jest');
    },
  );

  it.each([
    '-c timezone=UTC',
    '-ctimezone=UTC',
    '-c statement_timeout=5000 -c TimeZone=UTC',
  ])(
    'does not append another flag after a final UTC assignment (%s)',
    (options) => {
      const url = new URL('postgres://localhost/langoo_test');
      url.searchParams.set('options', options);
      expect(
        new URL(withUtcTimezone(url.toString())).searchParams.get('options'),
      ).toBe(options);
    },
  );
});
