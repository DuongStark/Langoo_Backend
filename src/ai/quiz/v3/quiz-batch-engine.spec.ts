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
});
