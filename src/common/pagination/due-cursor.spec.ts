import { DomainException } from '../errors/domain.exception';
import { decodeDueCursor, encodeDueCursor, DueCursorValue } from './cursor';

describe('due cursor (SRS)', () => {
  const cursor: DueCursorValue = {
    bucket: 1,
    dueAt: '2026-09-27T09:00:00.000Z',
    srsId: '42',
  };

  it('encode/decode round-trip', () => {
    const encoded = encodeDueCursor(cursor);
    expect(decodeDueCursor(encoded)).toEqual(cursor);
  });

  it('cursor không hợp lệ → VALIDATION_FAILED', () => {
    const bads = [
      'khong-phai-base64url!!!',
      Buffer.from('{"b":9,"t":"2026-09-27T09:00:00.000Z","i":"42"}').toString(
        'base64url',
      ),
      Buffer.from('{"b":1,"t":"khong-phai-ngay","i":"42"}').toString(
        'base64url',
      ),
      Buffer.from('{"b":1,"t":"2026-09-27T09:00:00.000Z","i":"abc"}').toString(
        'base64url',
      ),
      Buffer.from(
        '{"b":1,"t":"2026-09-27T09:00:00.000Z","i":"9223372036854775808"}',
      ).toString('base64url'),
      Buffer.from('khong-phai-json').toString('base64url'),
    ];
    for (const bad of bads) {
      expect(() => decodeDueCursor(bad)).toThrow(DomainException);
      try {
        decodeDueCursor(bad);
      } catch (error) {
        expect((error as DomainException).code).toBe('VALIDATION_FAILED');
      }
    }
  });
});
