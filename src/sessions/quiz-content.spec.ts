import { gradeQuizAnswer } from './quiz-content';

describe('gradeQuizAnswer', () => {
  it('multiple_choice: đúng theo index, sai theo index khác', () => {
    const correct = { index: 2, text: 'chạy' };

    expect(
      gradeQuizAnswer('multiple_choice', correct, { optionIndex: 2 }),
    ).toMatchObject({ isCorrect: true, rating: 3 });
    expect(
      gradeQuizAnswer('multiple_choice', correct, { optionIndex: 0 }),
    ).toMatchObject({ isCorrect: false, rating: 1 });
    expect(
      gradeQuizAnswer('multiple_choice', correct, { optionIndex: -1 }),
    ).toBeNull();
    expect(gradeQuizAnswer('multiple_choice', correct, {})).toBeNull();
  });

  it('fill_blank: chấp nhận mọi biến thể trong accepted, có trim/lowercase', () => {
    const correct = { accepted: ['走る', 'はしる', 'hashiru'] };

    expect(
      gradeQuizAnswer('fill_blank', correct, { answerText: ' 走る ' }),
    ).toMatchObject({ isCorrect: true });
    expect(
      gradeQuizAnswer('fill_blank', correct, { answerText: 'HASHIRU' }),
    ).toMatchObject({ isCorrect: true });
    expect(
      gradeQuizAnswer('fill_blank', correct, { answerText: '食べる' }),
    ).toMatchObject({ isCorrect: false });
    expect(
      gradeQuizAnswer('fill_blank', correct, { answerText: '   ' }),
    ).toBeNull();
  });

  it('matching: đúng khi toàn bộ cặp khớp, sai 1 cặp là sai cả câu', () => {
    const correct = {
      mapping: [
        { left_index: 0, right_index: 2 },
        { left_index: 1, right_index: 0 },
      ],
    };

    expect(
      gradeQuizAnswer('matching', correct, {
        pairs: [
          { left_index: 0, right_index: 2 },
          { left_index: 1, right_index: 0 },
        ],
      }),
    ).toMatchObject({ isCorrect: true, rating: 3 });

    expect(
      gradeQuizAnswer('matching', correct, {
        pairs: [
          { left_index: 0, right_index: 2 },
          { left_index: 1, right_index: 1 },
        ],
      }),
    ).toMatchObject({ isCorrect: false, rating: 1 });
  });

  it('matching: từ chối thiếu cặp, trùng left, hoặc index sai kiểu', () => {
    const correct = {
      mapping: [
        { left_index: 0, right_index: 1 },
        { left_index: 1, right_index: 0 },
      ],
    };

    expect(gradeQuizAnswer('matching', correct, {})).toBeNull();
    expect(
      gradeQuizAnswer('matching', correct, {
        pairs: [{ left_index: 0, right_index: 1 }],
      }),
    ).toBeNull();
    expect(
      gradeQuizAnswer('matching', correct, {
        pairs: [
          { left_index: 0, right_index: 1 },
          { left_index: 0, right_index: 0 },
        ],
      }),
    ).toBeNull();
  });
});
