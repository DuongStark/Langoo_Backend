import { DomainException } from '../common/errors/domain.exception';
import {
  decodeDictionarySearchCursor,
  encodeDictionarySearchCursor,
} from './dictionary-search-cursor';

const cursor = {
  version: 2 as const,
  query: '走',
  lang: 'ja',
  exactRank: 1 as const,
  prefixRank: 0 as const,
  frequencyNullRank: 0 as const,
  frequencyRank: 100,
  surfaceLength: 2,
  lexemeId: '1',
  surfaceKind: 'kanji',
  surface: '走る',
};

describe('dictionary search cursor', () => {
  it('rejects a valid old face-based v1 cursor after per-lexeme ranking changes', () => {
    const old = JSON.parse(
      Buffer.from(encodeDictionarySearchCursor(cursor), 'base64url').toString(
        'utf8',
      ),
    ) as Record<string, unknown>;
    old.v = 1;
    expect(() =>
      decodeDictionarySearchCursor(
        Buffer.from(JSON.stringify(old)).toString('base64url'),
      ),
    ).toThrow(DomainException);
  });
  it('round-trip được toàn bộ khóa sắp xếp', () => {
    const encoded = encodeDictionarySearchCursor(cursor);

    expect(decodeDictionarySearchCursor(encoded)).toEqual(cursor);
  });

  it.each([
    '',
    'not-base64',
    Buffer.from('{"v":1}', 'utf8').toString('base64url'),
  ])('từ chối cursor sai: %s', (value) => {
    expect(() => decodeDictionarySearchCursor(value)).toThrow(DomainException);
  });
});
