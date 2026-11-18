import { publicQuizAnswer, quizCreditScore } from './quiz-feedback';
it('never exposes internal per-pair credit through the saved user answer', () => {
  expect(
    publicQuizAnswer({ pairs: [], _quiz_credit: { earned: 2, possible: 4 } }),
  ).toEqual({ pairs: [] });
});
it('weights questions equally and separates partial credit from whole correctness', () => {
  expect(
    quizCreditScore([
      {
        userAnswer: { _quiz_credit: { earned: 2, possible: 4 } },
        isCorrect: false,
      },
      { userAnswer: {}, isCorrect: true },
    ]),
  ).toBe(75);
});
