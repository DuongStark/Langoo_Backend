import {
  derivePosBucket,
  longVowelKey,
  toQuestionSegments,
  validateBankCandidate,
} from './quiz-bank-gate';

describe('quiz-bank-gate', () => {
  it('derives pos_bucket separating Japanese i-adjectives from na-adjectives', () => {
    expect(derivePosBucket('en', 'noun', {}, 'ticket')).toBe('en:noun');
    expect(derivePosBucket('en', 'verb', {}, 'run')).toBe('en:verb');
    expect(
      derivePosBucket('ja', 'adjective', { pos_tags: ['adj-i'] }, '高い'),
    ).toBe('ja:adj-i');
    expect(
      derivePosBucket('ja', 'adjective', { pos_tags: ['adj-na'] }, '静か'),
    ).toBe('ja:adj-na');
    expect(derivePosBucket('ja', 'adjective', {}, '忙しい')).toBe('ja:adj-i');
    expect(derivePosBucket('ja', 'adjective', {}, '便利')).toBe('ja:adj-na');
  });

  it('validates context_cloze lemma form, blocks article/target leaks, and hides highlight in segments', () => {
    const badArticle = validateBankCandidate({
      senseId: '101',
      languageCode: 'en',
      skill: 'context_cloze',
      lemma: 'apple',
      pos: 'noun',
      sentence: 'She ate an 【apple】 after lunch.',
      excludedWords: ['pear'],
    });
    expect(badArticle).toEqual({ ok: false, reason: 'en_article_leak' });

    const leaked = validateBankCandidate({
      senseId: '101',
      languageCode: 'en',
      skill: 'context_cloze',
      lemma: 'ticket',
      pos: 'noun',
      sentence: 'Buy your 【ticket】 at the ticket counter.',
      excludedWords: ['pass'],
    });
    expect(leaked).toEqual({ ok: false, reason: 'target_leaked' });

    const good = validateBankCandidate({
      senseId: '101',
      languageCode: 'en',
      skill: 'context_cloze',
      lemma: 'ticket',
      pos: 'noun',
      sentence: 'Please show your 【ticket】 at the gate.',
      excludedWords: ['Pass', 'fare', 'TICKET', ''],
    });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.sentenceBefore).toBe('Please show your ');
    expect(good.targetSurface).toBe('ticket');
    expect(good.sentenceAfter).toBe(' at the gate.');
    expect(good.excludedWords).toEqual(['pass', 'fare']);
    expect(toQuestionSegments(good)).toEqual({
      before: 'Please show your ',
      highlight: null,
      after: ' at the gate.',
    });
  });

  it('validates kanji_reading and kanji_orthography distractors and produces highlight segments', () => {
    expect(longVowelKey('せんせい')).toBe(longVowelKey('せんせえ'));
    expect(longVowelKey('がっこう')).toBe(longVowelKey('がっこー'));

    const dupPhonetic = validateBankCandidate({
      senseId: '202',
      languageCode: 'ja',
      skill: 'kanji_reading',
      lemma: '先生',
      pos: 'noun',
      written: '先生',
      reading: 'せんせい',
      knownReadings: ['せんせい'],
      sentence: '新しい【先生】に挨拶しました。',
      distractors: ['せんせえ', 'せんさい', 'しんせい'],
    });
    expect(dupPhonetic).toEqual({
      ok: false,
      reason: 'invalid_reading_distractors',
    });

    const goodReading = validateBankCandidate({
      senseId: '202',
      languageCode: 'ja',
      skill: 'kanji_reading',
      lemma: '宿題',
      pos: 'noun',
      written: '宿題',
      reading: 'しゅくだい',
      knownReadings: ['しゅくだい'],
      sentence: '寝る前に今日の【宿題】を全部終わらせました。',
      distractors: ['しゅうだい', 'しゅくたい', 'じゅくだい'],
    });
    expect(goodReading.ok).toBe(true);
    if (!goodReading.ok) return;
    expect(toQuestionSegments(goodReading)).toEqual({
      before: '寝る前に今日の',
      highlight: '宿題',
      after: 'を全部終わらせました。',
    });

    const goodOrtho = validateBankCandidate({
      senseId: '202',
      languageCode: 'ja',
      skill: 'kanji_orthography',
      lemma: '食堂',
      pos: 'noun',
      written: '食堂',
      reading: 'しょくどう',
      knownWritings: ['食堂'],
      sentence: '昼休みに会社の【食堂】でカレーを食べました。',
      distractors: ['食掌', '食常', '食賞'],
    });
    expect(goodOrtho.ok).toBe(true);
    if (!goodOrtho.ok) return;
    expect(goodOrtho.targetSurface).toBe('しょくどう');
    expect(goodOrtho.canonicalAnswer).toBe('食堂');
    expect(toQuestionSegments(goodOrtho)).toEqual({
      before: '昼休みに会社の',
      highlight: 'しょくどう',
      after: 'でカレーを食べました。',
    });
  });
});
