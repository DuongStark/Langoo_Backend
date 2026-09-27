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
});
