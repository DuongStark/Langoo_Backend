import {
  buildSessionItem,
  CardContent,
  DistractorPool,
  gradeAnswer,
} from './session-content';
import { Rng } from '../srs/scheduler/fuzz';

/** RNG tất định: luôn trả 0 → Fisher-Yates không đảo (dễ assert). */
const zeroRng: Rng = { next: () => 0 };
/** RNG "đảo vừa phải" để kiểm tra tính ngẫu nhiên có thật. */
const halfRng: Rng = { next: () => 0.5 };

const cardJa: CardContent = {
  direction: 'recognize',
  language: { id: 2, code: 'ja', nameVi: 'Tiếng Nhật' },
  lemma: '走る',
  reading: 'はしる',
  romanization: null,
  meaningVi: 'chạy',
  forms: ['走る', 'はしる'],
};

const cardEnRecall: CardContent = {
  direction: 'recall',
  language: { id: 1, code: 'en', nameVi: 'Tiếng Anh' },
  lemma: 'run',
  reading: null,
  romanization: null,
  meaningVi: 'chạy',
  forms: ['run', 'running'],
};

const pool: DistractorPool = {
  words: ['食べる', '飲む', '行く', '走る'],
  meanings: ['ăn', 'uống', 'đi', 'chạy'],
};

describe('buildSessionItem', () => {
  it('flashcard: recognize hỏi từ → đáp án nghĩa; recall hỏi nghĩa → đáp án từ', () => {
    const recognize = buildSessionItem(cardJa, 'flashcard', pool, zeroRng);
    expect(recognize.prompt).toMatchObject({
      kind: 'flashcard',
      direction: 'recognize',
      question: { kind: 'word', text: '走る', reading: 'はしる' },
    });
    expect(recognize.correctAnswer).toMatchObject({
      kind: 'meaning',
      text: 'chạy',
    });

    const recall = buildSessionItem(cardEnRecall, 'flashcard', pool, zeroRng);
    expect(recall.prompt).toMatchObject({
      kind: 'flashcard',
      direction: 'recall',
      question: { kind: 'meaning', text: 'chạy' },
    });
    expect(recall.correctAnswer).toMatchObject({ kind: 'word', text: 'run' });
  });

  it('multiple_choice: 4 lựa chọn duy nhất, chứa đáp án đúng, index trỏ đúng', () => {
    const item = buildSessionItem(cardJa, 'multiple_choice', pool, halfRng, 4);
    const prompt = item.prompt as {
      kind: string;
      options: { index: number; text: string }[];
    };
    const answer = item.correctAnswer as { index: number; text: string };

    expect(prompt.kind).toBe('multiple_choice');
    expect(prompt.options).toHaveLength(4);
    const texts = prompt.options.map((option) => option.text);
    expect(new Set(texts).size).toBe(4);
    expect(texts).toContain('chạy');
    expect(prompt.options[answer.index].text).toBe('chạy');
    expect(answer.text).toBe('chạy');
  });

  it('recall dùng lựa chọn là TỪ cùng ngôn ngữ, không lẫn nghĩa', () => {
    const item = buildSessionItem(
      cardEnRecall,
      'multiple_choice',
      pool,
      halfRng,
    );
    const texts = (item.prompt as { options: { text: string }[] }).options.map(
      (option) => option.text,
    );
    expect(texts).toContain('run');
    expect(texts).not.toContain('chạy');
  });

  it('matching: cùng cấu trúc options nhưng kind = matching', () => {
    const item = buildSessionItem(cardJa, 'matching', pool, halfRng);
    expect((item.prompt as { kind: string }).kind).toBe('matching');
    expect((item.prompt as { options: unknown[] }).options).toHaveLength(4);
  });

  it('typing recognize: hỏi từ → gõ nghĩa (chỉ chấp nhận nghĩa)', () => {
    const item = buildSessionItem(cardJa, 'typing', pool, zeroRng);
    expect(
      (item.prompt as { question: { kind: string; text: string } }).question,
    ).toMatchObject({ kind: 'word', text: '走る' });
    expect((item.correctAnswer as { accepted: string[] }).accepted).toEqual([
      'chạy',
    ]);
  });

  it('typing recall: hỏi nghĩa → gõ từ, accepted gồm lemma/forms, chuẩn hoá và duy nhất', () => {
    const item = buildSessionItem(cardEnRecall, 'typing', pool, zeroRng);
    const accepted = (item.correctAnswer as { accepted: string[] }).accepted;
    expect(accepted).toEqual(expect.arrayContaining(['run', 'running']));
    expect(new Set(accepted).size).toBe(accepted.length);
  });

  it('thiếu distractor → options tối thiểu vẫn chứa đáp án đúng', () => {
    const item = buildSessionItem(
      cardJa,
      'multiple_choice',
      { words: [], meanings: [] },
      zeroRng,
    );
    const prompt = item.prompt as { options: { text: string }[] };
    expect(prompt.options.map((option) => option.text)).toEqual(['chạy']);
  });
});

describe('gradeAnswer', () => {
  it('flashcard: rating >= 3 là đúng; thiếu rating → null', () => {
    expect(gradeAnswer('flashcard', {}, { rating: 3 })).toMatchObject({
      isCorrect: true,
      rating: 3,
    });
    expect(gradeAnswer('flashcard', {}, { rating: 1 })).toMatchObject({
      isCorrect: false,
      rating: 1,
    });
    expect(gradeAnswer('flashcard', {}, {})).toBeNull();
  });

  it('multiple_choice/matching: so index, đúng → rating 3, sai → rating 1', () => {
    expect(
      gradeAnswer('multiple_choice', { index: 2 }, { optionIndex: 2 }),
    ).toMatchObject({
      isCorrect: true,
      rating: 3,
      userAnswer: { option_index: 2 },
    });
    expect(
      gradeAnswer('matching', { index: 2 }, { optionIndex: 0 }),
    ).toMatchObject({ isCorrect: false, rating: 1 });
    expect(gradeAnswer('multiple_choice', { index: 2 }, {})).toBeNull();
  });

  it('typing: chuẩn hoá trim/lower, nhiều đáp án chấp nhận, sai → false', () => {
    const accepted = { accepted: ['走る', 'はしる', 'run'] };
    expect(
      gradeAnswer('typing', accepted, { answerText: '  RUN ' }),
    ).toMatchObject({
      isCorrect: true,
      rating: 3,
    });
    expect(
      gradeAnswer('typing', accepted, { answerText: 'はしる' }),
    ).toMatchObject({
      isCorrect: true,
    });
    expect(
      gradeAnswer('typing', accepted, { answerText: 'あるく' }),
    ).toMatchObject({
      isCorrect: false,
      rating: 1,
    });
    expect(gradeAnswer('typing', accepted, {})).toBeNull();
  });

  it('sai kiểu dữ liệu (optionIndex âm, answerText rỗng) → null', () => {
    expect(
      gradeAnswer('multiple_choice', { index: 0 }, { optionIndex: -1 }),
    ).toBeNull();
    expect(
      gradeAnswer('typing', { accepted: ['x'] }, { answerText: '   ' }),
    ).toBeNull();
  });
});
