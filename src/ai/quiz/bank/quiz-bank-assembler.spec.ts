import { QuizSourceItem } from '../../providers/ai-quiz.provider';
import { BankQuestionRow } from './quiz-bank.repository';
import {
  assembleQuizFromBank,
  evaluateBankEligibility,
  hasCustomMeaningOverride,
} from './quiz-bank-assembler';

function makeItem(
  partial: Partial<QuizSourceItem> & {
    senseId: string;
    lemma: string;
    meaningVi: string;
  },
): QuizSourceItem {
  return {
    itemId: `item-${partial.senseId}`,
    faceId: `face-${partial.senseId}`,
    conceptId: `concept-${partial.senseId}`,
    languageId: partial.languageId ?? 1,
    languageCode: (partial.languageId ?? 1) === 2 ? 'ja' : 'en',
    reading: null,
    romanization: null,
    pos: 'noun',
    glossEn: [],
    kanjiPairs: [],
    ...partial,
  };
}

function makeBankRow(
  partial: Partial<BankQuestionRow> & {
    id: bigint;
    senseId: bigint;
    skill: BankQuestionRow['skill'];
  },
): BankQuestionRow {
  return {
    languageId: partial.languageId ?? 1,
    variantNo: partial.variantNo ?? 1,
    rubricVersion: 'm11.5-v1',
    sentenceBefore: 'Before ',
    targetSurface: 'word',
    sentenceAfter: ' after.',
    sentenceHash: `hash-${partial.id.toString()}`,
    canonicalAnswer: 'word',
    fixedDistractors: [],
    posBucket: 'en:noun',
    excludedWords: [],
    origin: 'generated',
    verification: 'machine_reviewed',
    ...partial,
  };
}

describe('quiz-bank-assembler', () => {
  it('detects custom user meaning overrides vs dictionary glosses', () => {
    expect(hasCustomMeaningOverride('vé tàu', 'vé, vé tàu')).toBe(false);
    expect(hasCustomMeaningOverride('Vé', 'vé')).toBe(false);
    expect(hasCustomMeaningOverride('ghi chú cá nhân khác hẳn', 'vé tàu')).toBe(
      true,
    );
    expect(
      hasCustomMeaningOverride(
        'ghi chú nghĩa cá nhân hoàn toàn riêng biệt',
        'a',
      ),
    ).toBe(true);
    expect(hasCustomMeaningOverride('ghi chú nghĩa cá nhân', 'cá')).toBe(true);
    expect(
      hasCustomMeaningOverride('nghĩa tự nhập khi từ điển trống', null),
    ).toBe(false);
  });

  it('evaluates eligibility with unavailable Kanji on EN and deduplicates post-fallback meaning slots on small empty-bank decks', () => {
    const fiveNouns = [1, 2, 3, 4, 5].map((n) =>
      makeItem({
        senseId: String(n),
        lemma: `noun${n}`,
        meaningVi: `nghĩa ${n}`,
        languageId: 1,
        pos: 'noun',
      }),
    );

    const enKanjiCheck = evaluateBankEligibility({
      items: fiveNouns,
      bankRows: [],
      languageId: 1,
      skills: ['kanji_reading', 'context_cloze'],
      requestedCount: 5,
    });
    const kanjiEntry = enKanjiCheck.by_skill.find(
      (s) => s.skill === 'kanji_reading',
    );
    expect(kanjiEntry?.source_policy).toBe('unavailable');
    expect(kanjiEntry?.eligible_targets).toBe(0);

    // 5 JA words with Kanji, empty bank, requesting 10 questions across 2 skills -> both fallback to 'meaning', max unique is 5!
    const fiveJa = [1, 2, 3, 4, 5].map((n) =>
      makeItem({
        senseId: String(100 + n),
        lemma: `漢字${n}`,
        meaningVi: `nghĩa nhật ${n}`,
        languageId: 2,
        languageCode: 'ja',
        pos: 'noun',
        kanjiPairs: [
          { written: `漢字${n}`, reading: `かんじ${n}`, eligible: true },
        ],
      }),
    );
    const overAsk = evaluateBankEligibility({
      items: fiveJa,
      bankRows: [],
      languageId: 2,
      skills: ['kanji_reading', 'context_cloze'],
      requestedCount: 10,
    });
    expect(overAsk.feasible).toBe(false);
    expect(overAsk.suggested_count).toBe(5);

    const exactAsk = evaluateBankEligibility({
      items: fiveJa,
      bankRows: [],
      languageId: 2,
      skills: ['kanji_reading', 'context_cloze'],
      requestedCount: 5,
    });
    expect(exactAsk.feasible).toBe(true);
    expect(exactAsk.suggested_count).toBe(5);
  });

  it('enforces pos_bucket (ja:adj-i vs ja:adj-na) and excludedWords on context_cloze, falling back to context_meaning when same-bucket distractors are insufficient', () => {
    const items: QuizSourceItem[] = [
      makeItem({
        senseId: '1',
        lemma: '静か',
        meaningVi: 'yên tĩnh',
        languageId: 2,
        languageCode: 'ja',
        pos: 'adjective',
        lexemeAttributes: { pos_tags: ['adj-na'] },
      }),
      makeItem({
        senseId: '2',
        lemma: '高い',
        meaningVi: 'cao, đắt',
        languageId: 2,
        languageCode: 'ja',
        pos: 'adjective',
        lexemeAttributes: { pos_tags: ['adj-i'] },
      }),
      makeItem({
        senseId: '3',
        lemma: '安い',
        meaningVi: 'rẻ',
        languageId: 2,
        languageCode: 'ja',
        pos: 'adjective',
        lexemeAttributes: { pos_tags: ['adj-i'] },
      }),
      makeItem({
        senseId: '4',
        lemma: '広い',
        meaningVi: 'rộng',
        languageId: 2,
        languageCode: 'ja',
        pos: 'adjective',
        lexemeAttributes: { pos_tags: ['adj-i'] },
      }),
    ];

    const bankRows: BankQuestionRow[] = [
      makeBankRow({
        id: 11n,
        senseId: 1n,
        languageId: 2,
        skill: 'context_cloze',
        sentenceBefore: '図書館はとても',
        targetSurface: '静か',
        sentenceAfter: 'な場所です。',
        canonicalAnswer: '静か',
        posBucket: 'ja:adj-na',
      }),
      makeBankRow({
        id: 12n,
        senseId: 1n,
        languageId: 2,
        skill: 'context_meaning',
        sentenceBefore: '夜の公園はとても',
        targetSurface: '静か',
        sentenceAfter: 'です。',
        canonicalAnswer: '静か',
        posBucket: 'ja:adj-na',
      }),
    ];

    // Sense 1 is the ONLY ja:adj-na in the deck (others are ja:adj-i), so context_cloze MUST downgrade to context_meaning!
    const res = assembleQuizFromBank({
      items,
      bankRows,
      recentBankIds: new Set(),
      languageId: 2,
      skills: ['context_cloze'],
      questionCount: 1,
      drawIndex: () => 0,
    });
    expect(res.questions).toHaveLength(1);
    expect(res.metadata.questions[0].skill).toBe('context_meaning');
    expect(res.metadata.questions[0].segments).toEqual({
      before: '夜の公園はとても',
      highlight: '静か',
      after: 'です。',
    });
  });

  it('rotates away from recentBankIds, prevents duplicate sentenceHash across skills, hides cloze highlight, and skips bank when custom meaning overrides dictionary', () => {
    const items: QuizSourceItem[] = [
      makeItem({
        senseId: '10',
        lemma: 'ticket',
        meaningVi: 'vé',
        dictGlossVi: 'vé',
        pos: 'noun',
      }),
      makeItem({
        senseId: '11',
        lemma: 'pass',
        meaningVi: 'thẻ đi lại',
        dictGlossVi: 'thẻ đi lại',
        pos: 'noun',
      }),
      makeItem({
        senseId: '12',
        lemma: 'airport',
        meaningVi: 'sân bay',
        dictGlossVi: 'sân bay',
        pos: 'noun',
      }),
      makeItem({
        senseId: '13',
        lemma: 'hotel',
        meaningVi: 'khách sạn',
        dictGlossVi: 'khách sạn',
        pos: 'noun',
      }),
      makeItem({
        senseId: '14',
        lemma: 'museum',
        meaningVi: 'bảo tàng',
        dictGlossVi: 'bảo tàng',
        pos: 'noun',
      }),
    ];

    const sharedHash = 'same-sentence-hash'.padEnd(64, '0');
    const distinctHash = 'diff-sentence-hash'.padEnd(64, '0');

    const bankRows: BankQuestionRow[] = [
      makeBankRow({
        id: 101n,
        senseId: 10n,
        skill: 'context_cloze',
        variantNo: 1,
        sentenceBefore: 'Buy your ',
        targetSurface: 'ticket',
        sentenceAfter: ' at the station.',
        sentenceHash: sharedHash,
        canonicalAnswer: 'ticket',
        posBucket: 'en:noun',
        excludedWords: ['pass'],
      }),
      makeBankRow({
        id: 102n,
        senseId: 10n,
        skill: 'context_cloze',
        variantNo: 2,
        sentenceBefore: 'Show the ',
        targetSurface: 'ticket',
        sentenceAfter: ' at the entrance.',
        sentenceHash: distinctHash,
        canonicalAnswer: 'ticket',
        posBucket: 'en:noun',
        excludedWords: ['pass'],
      }),
    ];

    // Variant 101 was used recently -> must pick variant 102, and exclude 'pass' from 3 distractors!
    const res = assembleQuizFromBank({
      items,
      bankRows,
      recentBankIds: new Set(['101']),
      languageId: 1,
      skills: ['context_cloze'],
      questionCount: 1,
      drawIndex: () => 0,
    });
    expect(res.metadata.questions[0].bankQuestionId).toBe('102');
    expect(res.metadata.questions[0].segments).toEqual({
      before: 'Show the ',
      highlight: null,
      after: ' at the entrance.',
    });
    expect(res.questions[0].context).toBeNull();
    const optionTexts = (
      res.questions[0].options as { index: number; text: string }[]
    ).map((o) => o.text);
    expect(optionTexts).toContain('ticket');
    expect(optionTexts).not.toContain('pass');
    expect(optionTexts).toHaveLength(4);
  });
});
