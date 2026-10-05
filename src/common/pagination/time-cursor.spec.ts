import { decodePostgresTimeCursor, encodeTimeIdCursor } from './time-cursor';

describe('PostgreSQL time cursor', () => {
  it.each(['123456', '123001', '123000'])(
    'preserves all six timestamp digits (%s)',
    (fraction) => {
      const key = `2026-10-05T12:00:00.${fraction}Z`;
      const raw = encodeTimeIdCursor({
        createdAt: new Date(key),
        createdAtKey: key,
        id: '9223372036854775807',
      });
      expect(decodePostgresTimeCursor(raw, 'bigint')).toEqual({
        createdAt: key,
        id: '9223372036854775807',
      });
    },
  );

  it('accepts legacy millisecond cursors for UUID queues', () => {
    const createdAt = new Date('2026-10-05T12:00:00.123Z');
    const id = '01900000-0000-7000-8000-000000000001';
    expect(
      decodePostgresTimeCursor(encodeTimeIdCursor({ createdAt, id }), 'uuid'),
    ).toEqual({ createdAt: createdAt.toISOString(), id });
  });

  it.each([
    ['2026-02-30T12:00:00.123456Z', '1'],
    ['2026-10-05T12:00:00.123456Z', '9223372036854775808'],
    ['2026-10-05T12:00:00.123456Z', '0'],
  ])('rejects invalid dates/IDs (%s, %s)', (t, i) => {
    const raw = Buffer.from(JSON.stringify({ v: 1, t, i })).toString(
      'base64url',
    );
    expect(() => decodePostgresTimeCursor(raw, 'bigint')).toThrow(
      'Cursor không hợp lệ',
    );
  });
});
