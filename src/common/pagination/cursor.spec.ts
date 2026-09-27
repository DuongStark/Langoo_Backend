import { DomainException } from '../errors/domain.exception';
import { decodeCursor, encodeCursor, ItemCursor } from './cursor';

describe('cursor util', () => {
  it('encode/decode round-trip', () => {
    const cursor: ItemCursor = {
      position: 3,
      id: '01a0dc8a-7191-7e18-93b0-32e8378986fe',
    };
    const encoded = encodeCursor(cursor);

    expect(encoded).not.toContain('{');
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it('cursor không hợp lệ → VALIDATION_FAILED', () => {
    for (const bad of [
      'khong-phai-base64url!!!',
      Buffer.from('{"p":"3","i":"abc"}').toString('base64url'),
      Buffer.from(
        '{"p":0,"i":"01a0dc8a-7191-7e18-93b0-32e8378986fe"}',
      ).toString('base64url'),
      Buffer.from('{"p":3,"i":"khong-phai-uuid"}').toString('base64url'),
      Buffer.from('khong-phai-json').toString('base64url'),
    ]) {
      expect(() => decodeCursor(bad)).toThrow(DomainException);
      try {
        decodeCursor(bad);
      } catch (error) {
        expect((error as DomainException).code).toBe('VALIDATION_FAILED');
      }
    }
  });
});
