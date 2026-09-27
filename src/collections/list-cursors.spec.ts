import {
  decodeCollectionListCursor,
  decodeTagListCursor,
  encodeCollectionListCursor,
  encodeTagListCursor,
} from './list-cursors';
import { DomainException } from '../common/errors/domain.exception';

describe('collection list cursors', () => {
  it('round-trips the collection sort key and profile filter', () => {
    const encoded = encodeCollectionListCursor({
      updatedAt: '2026-09-27T00:00:00.123456Z',
      id: '01a0dc8a-7191-7e18-93b0-32e8378986fe',
      profileId: '01a0dc8a-718f-7acd-a588-2cf077898399',
    });

    expect(decodeCollectionListCursor(encoded)).toEqual({
      updatedAt: '2026-09-27T00:00:00.123456Z',
      id: '01a0dc8a-7191-7e18-93b0-32e8378986fe',
      profileId: '01a0dc8a-718f-7acd-a588-2cf077898399',
    });
  });

  it('round-trips tag name/id and rejects malformed cursors', () => {
    const encoded = encodeTagListCursor({ name: 'M5.1', id: '01' });
    expect(decodeTagListCursor(encoded)).toEqual({ name: 'M5.1', id: '01' });
    expect(() => decodeTagListCursor('not-a-cursor')).toThrow(DomainException);
  });

  it('rejects a collection cursor with a missing filter marker', () => {
    const encoded = Buffer.from(
      JSON.stringify({
        v: 1,
        t: '2026-09-27T00:00:00.000000Z',
        i: '01a0dc8a-7191-7e18-93b0-32e8378986fe',
      }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeCollectionListCursor(encoded)).toThrow(DomainException);
  });

  it('rejects a collection cursor with a non-canonical timestamp', () => {
    const encoded = Buffer.from(
      JSON.stringify({
        v: 1,
        t: '1',
        i: '01a0dc8a-7191-7e18-93b0-32e8378986fe',
        p: null,
      }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeCollectionListCursor(encoded)).toThrow(DomainException);
  });
});
