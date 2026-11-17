import { QuizBatchEngine, ValidatedQuestion } from './quiz-batch-engine';
import { planQuiz, QUIZ_V3 } from './quiz-blueprint';
import { fingerprint } from '../quiz-contract';
import type { QuizSourceItem } from '../../providers/ai-quiz.provider';
import type { AiChatRequest } from '../../providers/ai-chat.provider';

const source = (): QuizSourceItem[] =>
  ['学校', '病院', '電車', '図書館'].map((lemma, i) => ({
    itemId: `item${i}`,
    senseId: `${i}`,
    conceptId: null,
    languageId: 2,
    languageCode: 'ja',
    lemma,
    meaningVi: ['trường', 'bệnh viện', 'tàu điện', 'thư viện'][i],
    reading: ['がっこう', 'びょういん', 'でんしゃ', 'としょかん'][i],
    romanization: null,
    pos: 'noun',
    kanjiPairs: [
      {
        written: lemma,
        reading: ['がっこう', 'びょういん', 'でんしゃ', 'としょかん'][i],
        eligible: true,
      },
    ],
  }));
async function generate(
  skill: 'kanji_reading' | 'kanji_orthography',
  distractors: unknown,
  items = source(),
) {
  const chat = jest.fn(async (request: AiChatRequest) => {
    await request.beforeDispatch?.();
    return {
      content: JSON.stringify({
        sentence: `子どもたちは【${items[0].lemma}】で勉強します。`,
        distractors,
        correctIndex: 0,
        correctAnswer: 'MODEL_ANSWER',
        id: 'model-id',
      }),
      model: 'test',
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0,
    };
  });
  const engine = new QuizBatchEngine({
    transport: { name: 'test', chat },
    generatorModel: 'test',
    singleQuestionMode: true,
    randomIndex: () => 2,
  });
  const accepted: ValidatedQuestion[] = [];
  await engine.generateProgressively(
    planQuiz(items, 2, [skill], 1).slots,
    items,
    () => Promise.resolve('receipt'),
    () => Promise.resolve(),
    () => 30000,
    (q) => {
      accepted.push(q);
      return Promise.resolve();
    },
  );
  return { engine, chat, accepted, items };
}

describe('M11.3 AI-proposed Kanji distractors', () => {
  it.each([
    ['kanji_reading', ['かっこう', 'がこう', 'がっこ'], 'がっこう'],
    ['kanji_orthography', ['学枚', '学枝', '学杖'], '学校'],
  ] as const)(
    '%s keeps the canonical answer and asks for only three wrong choices',
    async (skill, distractors, answer) => {
      const { accepted, chat } = await generate(skill, [...distractors]);
      expect(accepted).toHaveLength(1);
      expect(accepted[0].question.correctAnswer).toMatchObject({
        index: 2,
        text: answer,
      });
      expect(accepted[0].question.options).toEqual([
        { index: 0, text: distractors[0] },
        { index: 1, text: distractors[1] },
        { index: 2, text: answer },
        { index: 3, text: distractors[2] },
      ]);
      expect(accepted[0].sourcePolicy).toBe('ai_distractors');
      expect(accepted[0].verification).toBe('generated_self_checked');
      expect(JSON.stringify(accepted)).not.toContain('MODEL_ANSWER');
      const payload = JSON.parse(
        chat.mock.calls[0][0].messages[1].content,
      ) as Record<string, unknown>;
      expect(payload.canonicalAnswer).toBe(answer);
      expect(payload).not.toHaveProperty('choices');
      expect(payload).not.toHaveProperty('correctIndex');
      expect(chat).toHaveBeenCalledTimes(1);
    },
  );

  it.each(
    [
      ['ガッコウ', 'がこう', 'がっこ'], // canonical kana variant
      ['がこう', 'ガコウ', 'がっこ'], // normalized duplicate
      ['がっこー', 'かっこう', 'がこう'], // same pronunciation as canonical
      ['がっこお', 'かっこう', 'がこう'], // phonetic long vowel
      ['びょういん', 'せんせい', 'でんしゃ'], // unrelated readings
      ['がっこうa', 'がこう', 'がっこ'],
      ['がっ�う', 'がこう', 'がっこ'],
      ['がこう'],
      undefined,
    ].map((distractors) => ({ distractors })),
  )(
    'rejects invalid or distant readings without falling back to old distractors: %j',
    async ({ distractors }) => {
      expect(
        (await generate('kanji_reading', distractors)).accepted,
      ).toHaveLength(0);
    },
  );

  it('rejects ei/ee long-vowel respellings of the correct pronunciation', async () => {
    const items = source();
    items[0] = {
      ...items[0],
      lemma: '学生',
      reading: 'がくせい',
      kanjiPairs: [{ written: '学生', reading: 'がくせい', eligible: true }],
    };
    expect(
      (
        await generate(
          'kanji_reading',
          ['がくせえ', 'がくせー', 'かくせい'],
          items,
        )
      ).accepted,
    ).toHaveLength(0);
  });

  it('blocks another known correct reading even when ineligible for target selection', async () => {
    const items = source();
    items[0].kanjiPairs!.push({
      written: '学校',
      reading: 'がくこう',
      eligible: false,
    });
    expect(
      (await generate('kanji_reading', ['がくこう', 'がこう', 'がっこ'], items))
        .accepted,
    ).toHaveLength(0);
  });

  it('blocks known alternate spellings and homophones from another source', async () => {
    const items = source();
    items.push({
      ...items[0],
      itemId: 'alias',
      senseId: 'alias',
      lemma: '學校',
      kanjiPairs: [{ written: '學校', reading: 'がっこう', eligible: true }],
    });
    expect(
      (await generate('kanji_orthography', ['學校', '学枝', '学杖'], items))
        .accepted,
    ).toHaveLength(0);
  });

  it('blocks okurigana spelling variants even when the alias is absent from source', async () => {
    const items = source();
    items[0] = {
      ...items[0],
      lemma: '入口',
      reading: 'いりぐち',
      kanjiPairs: [{ written: '入口', reading: 'いりぐち', eligible: true }],
    };
    expect(
      (await generate('kanji_orthography', ['入り口', '人口', '入日'], items))
        .accepted,
    ).toHaveLength(0);
  });

  it('rejects unrelated written words despite being valid Japanese words', async () => {
    expect(
      (await generate('kanji_orthography', ['病院', '電車', '図書館']))
        .accepted,
    ).toHaveLength(0);
  });

  it('does not reuse cache from the previous easy Kanji policy', async () => {
    const { engine, accepted, items, chat } = await generate('kanji_reading', [
      'かっこう',
      'がこう',
      'がっこ',
    ]);
    const slots = planQuiz(items, 2, ['kanji_reading'], 1).slots;
    expect(engine.reuse(slots, items, accepted)).toHaveLength(1);
    const payload = JSON.parse(
      chat.mock.calls[0][0].messages[1].content,
    ) as Record<string, unknown>;
    const oldPayload = Object.fromEntries(
      [
        'skill',
        'language',
        'target',
        'reading',
        'sense',
        'pos',
        'dictionaryMeanings',
      ].map((key) => [key, payload[key]]),
    );
    const target = items[0];
    const candidates = structuredClone(accepted);
    candidates[0].reuseKey = fingerprint([
      QUIZ_V3,
      'single-self-check-v1',
      'test',
      undefined,
      oldPayload,
      [
        {
          senseId: target.senseId,
          lemma: target.lemma,
          meaningVi: target.meaningVi,
          reading: target.reading,
          languageId: target.languageId,
        },
      ],
    ]);
    expect(engine.reuse(slots, items, candidates)).toHaveLength(0);
  });
});
