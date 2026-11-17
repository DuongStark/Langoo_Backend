import { QuizBatchEngine } from './quiz-batch-engine';
import type { AiChatResult } from '../../providers/ai-chat.provider';
import { planQuiz } from './quiz-blueprint';
import {
  AiChatProvider,
  AiChatRequest,
} from '../../providers/ai-chat.provider';
import { gradeQuizAnswer } from '../../../sessions/quiz-content';

describe('M11.3 batch engine', () => {
  const items = Array.from({ length: 4 }, (_, i) => ({
    itemId: `item-${i}`,
    senseId: `${i}`,
    conceptId: null,
    languageId: 1,
    languageCode: 'en',
    lemma: `word${i}`,
    reading: null,
    romanization: null,
    meaningVi: `nghĩa ${i}`,
    pos: 'noun',
  }));
  const slot = () => planQuiz(items, 1, ['context_cloze'], 1).slots;
  function setup(contents: string[]) {
    const chat = jest
      .fn<Promise<AiChatResult>, [AiChatRequest]>()
      .mockImplementation(() =>
        Promise.resolve({
          content: contents.shift() ?? '',
          costUsd: 0,
          tokensIn: 10,
          tokensOut: 5,
          model: 'model',
        }),
      );
    const engine = new QuizBatchEngine({
      transport: { chat } as unknown as AiChatProvider,
      generatorModel: 'gen',
      validatorModel: 'val',
    });
    return { engine, chat };
  }
  const generate = JSON.stringify({
    questions: [{ id: 'q1', sentence: 'Please choose 【word0】 today.' }],
  });
  const valid = JSON.stringify({ results: [{ id: 'q1', valid: true }] });
  it('uses one generation and one independent validation call, never leaks the blank answer', async () => {
    const { engine, chat } = setup([generate, valid]);
    const hook = jest.fn().mockResolvedValue(undefined);
    const questions = await engine.generate(slot(), items, hook);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(hook).toHaveBeenCalledTimes(2);
    expect(questions[0].question.prompt).not.toContain('word0');
    expect(questions[0].context).toBeNull();
    expect(questions[0].question.correctAnswer.text).toBe('word0');
    expect(
      gradeQuizAnswer('multiple_choice', questions[0].question.correctAnswer, {
        optionIndex: questions[0].question.correctAnswer.index as number,
      })?.isCorrect,
    ).toBe(true);
    const payload = chat.mock.calls[0][0].messages[1].content;
    expect(payload).not.toContain('item-');
    expect(payload).not.toContain('senseId');
    expect(chat.mock.calls[1][0].messages[1].content).not.toContain('item-');
  });
  it('discards invalid content and cannot accept generator self-validation', async () => {
    const { engine } = setup([
      generate,
      JSON.stringify({ results: [{ id: 'q1', valid: false }] }),
    ]);
    expect(await engine.generate(slot(), items, jest.fn())).toEqual([]);
  });
  it('reuses only identical verified content across ordinals without another model call', async () => {
    const { engine, chat } = setup([generate, valid]);
    const cached = await engine.generate(slot(), items, jest.fn());
    const newSlot = { ...slot()[0], ordinal: 7 };
    const reused = engine.reuse([newSlot], items, cached);
    expect(reused[0].ordinal).toBe(7);
    expect(reused[0].context).toBeNull();
    expect(chat).toHaveBeenCalledTimes(2);
    const changed = items.map((i, index) =>
      index === 0 ? { ...i, meaningVi: 'changed' } : i,
    );
    expect(
      engine.reuse([{ ...newSlot, targets: [changed[0]] }], changed, cached),
    ).toEqual([]);
  });
  it('rejects unknown IDs and missing or duplicate validator results', async () => {
    const { engine } = setup([
      generate,
      JSON.stringify({ results: [{ id: 'q2', valid: true }] }),
    ]);
    await expect(engine.generate(slot(), items, jest.fn())).rejects.toThrow();
  });
  it('blocks external calls if the privacy hook rejects', async () => {
    const { engine, chat } = setup([generate, valid]);
    await expect(
      engine.generate(slot(), items, () =>
        Promise.reject(new Error('privacy')),
      ),
    ).rejects.toThrow('privacy');
    expect(chat).not.toHaveBeenCalled();
  });
  it('ignores model-added answer fields but never lets them replace the server answer key', async () => {
    const { engine, chat } = setup([
      JSON.stringify({
        results: [{ id: 'q1', valid: true, explanation: 'extra diagnostic' }],
      }),
    ]);
    let assigned = -1;
    chat.mockImplementationOnce((request) => {
      const payload = JSON.parse(request.messages[1].content) as {
        correctIndex: number;
      }[];
      assigned = payload[0].correctIndex;
      return Promise.resolve({
        content: JSON.stringify({
          questions: [
            {
              id: 'q1',
              options: [
                'word0 option A',
                'word0 option B',
                'word0 option C',
                'word0 option D',
              ],
              correctIndex: (assigned + 1) % 4,
              id_note: 'untrusted-source-id',
              valid: true,
            },
          ],
        }),
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        model: 'gen',
      });
    });
    const questions = await engine.generate(
      planQuiz(items, 1, ['usage'], 1).slots,
      items,
      jest.fn(),
    );
    expect(questions[0].question.correctAnswer.index).toBe(assigned);
    expect(JSON.stringify(questions)).not.toContain('untrusted-source-id');
    expect(chat).toHaveBeenCalledTimes(2);
  });
  it('keeps local and other valid questions when one known generated item has malformed fields', async () => {
    const slots = planQuiz(
      items,
      1,
      ['meaning', 'context_cloze', 'usage'],
      3,
    ).slots;
    const target = slots[1].targets[0].lemma;
    const { engine } = setup([
      JSON.stringify({
        questions: [
          { id: 'q2', sentence: `Please choose 【${target}】 today.` },
          { id: 'q3', options: ['only one choice'] },
        ],
      }),
      JSON.stringify({ results: [{ id: 'q2', valid: true }] }),
    ]);
    expect(
      (await engine.generate(slots, items, jest.fn())).map((q) => q.ordinal),
    ).toEqual([1, 2]);
  });
  it('does not coerce a validator string into a trusted boolean', async () => {
    const { engine } = setup([
      generate,
      JSON.stringify({ results: [{ id: 'q1', valid: 'true' }] }),
    ]);
    await expect(engine.generate(slot(), items, jest.fn())).rejects.toThrow();
  });
  it('rejects generated context that cannot be read by the public quiz contract', async () => {
    const { engine, chat } = setup([
      JSON.stringify({
        questions: [
          { id: 'q1', sentence: `${'Long context '.repeat(25)}【word0】.` },
        ],
      }),
    ]);
    const result = await engine.generate(
      planQuiz(items, 1, ['context_meaning'], 1).slots,
      items,
      jest.fn(),
    );
    expect(result).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it('reuses the already certified options even when a fresh random draw would choose other distractors', async () => {
    const source = [
      ...items,
      ...items.slice(1).map((item, i) => ({
        ...item,
        itemId: `more-${i}`,
        senseId: `more-${i}`,
        lemma: `more${i}`,
        meaningVi: `nghĩa khác ${i}`,
      })),
    ];
    let reverse = false;
    const { chat } = setup([generate, valid]);
    const engine = new QuizBatchEngine({
      transport: { chat } as unknown as AiChatProvider,
      generatorModel: 'gen',
      validatorModel: 'val',
      randomIndex: (max) => (reverse ? 0 : max - 1),
    });
    const slots = planQuiz(source, 1, ['context_cloze'], 1).slots;
    const certified = await engine.generate(slots, source, jest.fn());
    reverse = true;
    const reused = engine.reuse(
      [{ ...slots[0], ordinal: 9 }],
      source,
      certified,
    );
    expect(reused).toHaveLength(1);
    expect(reused[0].question.options).toEqual(certified[0].question.options);
    expect(reused[0].question.correctAnswer).toEqual(
      certified[0].question.correctAnswer,
    );
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
