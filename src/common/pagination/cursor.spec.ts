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

  it('round-trips descending direction while preserving legacy ascending shape', () => {
    const cursor = {
      position: 3,
      id: '01a0dc8a-7191-7e18-93b0-32e8378986fe',
      order: 'desc',
    } satisfies ItemCursor;
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    const legacy = encodeCursor({ position: 3, id: cursor.id });
    expect(
      JSON.parse(Buffer.from(legacy, 'base64url').toString('utf8')),
    ).toEqual({ p: 3, i: cursor.id });
    for (const o of ['DESC', 'invalid', null, 1]) {
      const raw = Buffer.from(
        JSON.stringify({ p: 3, i: cursor.id, o }),
      ).toString('base64url');
      expect(() => decodeCursor(raw)).toThrow(DomainException);
    }
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
