import {
  hideQuizFeedback,
  publicQuizAnswer,
  quizCreditScore,
} from './quiz-v3-feedback';
it('defers all v3 feedback until completion while preserving legacy behavior', () => {
  expect(hideQuizFeedback({ quiz_version: 'm11.3-v3' }, 'in_progress')).toBe(
    true,
  );
  expect(hideQuizFeedback({ quiz_version: 'm11.3-v3' }, 'completed')).toBe(
    false,
  );
  expect(hideQuizFeedback({}, 'in_progress')).toBe(false);
});
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
