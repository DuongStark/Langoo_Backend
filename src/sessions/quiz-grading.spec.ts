import { gradeQuizAnswer } from './quiz-content';

it('M11.5 preserves whole-question correctness and separately reports matching pair credit', () => {
  const answer = {
    rubric: 'm11.5-v1',
    mapping: Array.from({ length: 4 }, (_, i) => ({
      left_index: i,
      right_index: i,
    })),
  };
  const result = gradeQuizAnswer('matching', answer, {
    pairs: [
      { left_index: 0, right_index: 0 },
      { left_index: 1, right_index: 1 },
      { left_index: 2, right_index: 3 },
      { left_index: 3, right_index: 2 },
    ],
  });
  expect(result?.isCorrect).toBe(false);
  expect(result?.credit).toEqual({ earned: 2, possible: 4 });
  const legacy = gradeQuizAnswer(
    'matching',
    { mapping: answer.mapping },
    { pairs: answer.mapping },
  );
  expect(legacy?.credit).toBeUndefined();
});
