import {
  extractInlineWordMetadata,
  isKanaOnly,
  isSupportedImportSourceType,
  normalizeImportPos,
  normalizeImportReadings,
  normalizeImportWord,
  normalizeKanaKey,
  toKatakanaKey,
} from './pos-normalizer';

describe('pos-normalizer', () => {
  describe('normalizeImportWord', () => {
    it('trims, normalizes NFKC, and collapses internal whitespace', () => {
      expect(normalizeImportWord('  Ａｐｐｌｅ   pie  ')).toBe('Apple pie');
      expect(normalizeImportWord('　性質　')).toBe('性質');
    });
  });

  describe('isSupportedImportSourceType', () => {
    it('accepts omitted, empty, word, vocab, vocabulary, từ vựng', () => {
      expect(isSupportedImportSourceType(undefined)).toBe(true);
      expect(isSupportedImportSourceType(null)).toBe(true);
      expect(isSupportedImportSourceType('')).toBe(true);
      expect(isSupportedImportSourceType('word')).toBe(true);
      expect(isSupportedImportSourceType('WORD')).toBe(true);
      expect(isSupportedImportSourceType('vocab')).toBe(true);
      expect(isSupportedImportSourceType('Từ vựng')).toBe(true);
    });

    it('rejects Mazii non-word types (kanji, grammar, sentence)', () => {
      expect(isSupportedImportSourceType('kanji')).toBe(false);
      expect(isSupportedImportSourceType('grammar')).toBe(false);
      expect(isSupportedImportSourceType('sentence')).toBe(false);
      expect(isSupportedImportSourceType('ngữ pháp')).toBe(false);
    });
  });

  describe('normalizeImportPos', () => {
    it('maps EN abbreviations and full names', () => {
      expect(normalizeImportPos('n')).toBe('noun');
      expect(normalizeImportPos('(n.)')).toBe('noun');
      expect(normalizeImportPos('Noun')).toBe('noun');
      expect(normalizeImportPos('v')).toBe('verb');
      expect(normalizeImportPos('vi.')).toBe('verb');
      expect(normalizeImportPos('vt')).toBe('verb');
      expect(normalizeImportPos('adj')).toBe('adjective');
      expect(normalizeImportPos('adj-na')).toBe('adjective');
      expect(normalizeImportPos('adv')).toBe('adverb');
      expect(normalizeImportPos('pron')).toBe('pronoun');
      expect(normalizeImportPos('conj')).toBe('conjunction');
      expect(normalizeImportPos('intj')).toBe('interjection');
    });

    it('maps Vietnamese and Japanese POS labels', () => {
      expect(normalizeImportPos('danh từ')).toBe('noun');
      expect(normalizeImportPos('động từ')).toBe('verb');
      expect(normalizeImportPos('tính từ')).toBe('adjective');
      expect(normalizeImportPos('trạng từ')).toBe('adverb');
      expect(normalizeImportPos('phó từ')).toBe('adverb');
      expect(normalizeImportPos('名詞')).toBe('noun');
      expect(normalizeImportPos('動詞')).toBe('verb');
      expect(normalizeImportPos('形容詞')).toBe('adjective');
      expect(normalizeImportPos('形容動詞')).toBe('adjective');
      expect(normalizeImportPos('副詞')).toBe('adverb');
    });

    it('returns null for unknown or empty POS values', () => {
      expect(normalizeImportPos(undefined)).toBeNull();
      expect(normalizeImportPos('   ')).toBeNull();
      expect(normalizeImportPos('prep')).toBeNull();
      expect(normalizeImportPos('random-pos')).toBeNull();
    });
  });

  describe('normalizeImportReadings & normalizeKanaKey', () => {
    it('splits multi-reading Mazii Phonetic cells and deduplicates', () => {
      expect(normalizeImportReadings('ささえる つかえる')).toEqual([
        'ささえる',
        'つかえる',
      ]);
      expect(normalizeImportReadings('ささえる、つかえる / ささえる')).toEqual([
        'ささえる',
        'つかえる',
      ]);
    });

    it('normalizes Katakana to Hiragana so チャーハン matches ちゃーはん', () => {
      expect(normalizeImportReadings('チャーハン')).toEqual(['ちゃーはん']);
      expect(normalizeKanaKey('チャーハン')).toBe(
        normalizeKanaKey('ちゃーはん'),
      );
    });

    it('returns empty array for blank readings', () => {
      expect(normalizeImportReadings(undefined)).toEqual([]);
      expect(normalizeImportReadings('  ')).toEqual([]);
    });
  });

  describe('isKanaOnly & toKatakanaKey', () => {
    it('detects kana-only strings vs kanji/latin and converts to Katakana', () => {
      expect(isKanaOnly('せいしつ')).toBe(true);
      expect(isKanaOnly('チャーハン')).toBe(true);
      expect(isKanaOnly('性質')).toBe(false);
      expect(isKanaOnly('食べる')).toBe(false);
      expect(isKanaOnly('bank')).toBe(false);
      expect(toKatakanaKey('ちゃーはん')).toBe('チャーハン');
    });
  });

  describe('extractInlineWordMetadata', () => {
    it('extracts inline POS in brackets at the end of word', () => {
      expect(extractInlineWordMetadata('bank (n)')).toEqual({
        word: 'bank',
        inlinePos: 'noun',
        inlineReading: null,
      });
      expect(extractInlineWordMetadata('run [v.]')).toEqual({
        word: 'run',
        inlinePos: 'verb',
        inlineReading: null,
      });
    });

    it('extracts inline kana reading in brackets for kanji words', () => {
      expect(extractInlineWordMetadata('性質（せいしつ）')).toEqual({
        word: '性質',
        inlinePos: null,
        inlineReading: 'せいしつ',
      });
      expect(extractInlineWordMetadata('支える [ささえる]')).toEqual({
        word: '支える',
        inlinePos: null,
        inlineReading: 'ささえる',
      });
    });

    it('leaves normal words untouched', () => {
      expect(extractInlineWordMetadata('再調整')).toEqual({
        word: '再調整',
        inlinePos: null,
        inlineReading: null,
      });
    });
  });
});
