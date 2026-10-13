import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Rng } from '../../srs/scheduler/fuzz';
import {
  GeneratedQuizQuestion,
  QuizSourceItem,
  KanjiPair,
} from '../providers/ai-quiz.provider';
import { QuestionStyle, textKey, readingKey } from './quiz-contract';

export interface KanjiTarget {
  item: QuizSourceItem;
  pair: KanjiPair;
  distractors: string[];
}

export function createKanjiPool(
  items: QuizSourceItem[],
  style: QuestionStyle,
): KanjiTarget[] {
  const result: KanjiTarget[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.languageCode !== 'ja') continue;
    for (const pair of item.kanjiPairs ?? []) {
      if (
        !pair.eligible ||
        !/\p{Script=Han}/u.test(pair.written) ||
        !/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(pair.reading)
      )
        continue;
      const valid = item.kanjiPairs ?? [];
      const readings = new Set(
        valid
          .filter((p) => textKey(p.written) === textKey(pair.written))
          .map((p) => readingKey(p.reading)),
      );
      if (style === 'kanji_reading' && readings.size !== 1) continue;
      const identity = `${item.senseId}:${pair.written}:${pair.reading}`;
      if (seen.has(identity)) continue;
      const excluded = new Set(
        valid
          .filter((p) =>
            style === 'kanji_reading'
              ? textKey(p.written) === textKey(pair.written)
              : readingKey(p.reading) === readingKey(pair.reading),
          )
          .map((p) =>
            style === 'kanji_reading'
              ? readingKey(p.reading)
              : textKey(p.written),
          ),
      );
      const distractors = new Map<string, string>();
      for (const other of items) {
        if (other.languageCode !== 'ja' || other.senseId === item.senseId)
          continue;
        for (const candidate of other.kanjiPairs ?? []) {
          if (!candidate.eligible) continue;
          if (
            !/\p{Script=Han}/u.test(candidate.written) ||
            !/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(
              candidate.reading,
            )
          )
            continue;
          // A homophone can be another correct spelling. Conservatively omit it.
          if (
            style === 'kanji_orthography' &&
            (other.kanjiPairs ?? []).some(
              (p) =>
                p.written === candidate.written &&
                readingKey(p.reading) === readingKey(pair.reading),
            )
          )
            continue;
          const text =
            style === 'kanji_reading' ? candidate.reading : candidate.written;
          const key =
            style === 'kanji_reading' ? readingKey(text) : textKey(text);
          if (excluded.has(key)) continue;
          distractors.set(key, text);
        }
        if (distractors.size >= 24) break;
      }
      if (
        distractors.size < 3 ||
        (style === 'kanji_orthography' &&
          (!item.meaningVi.trim() ||
            valid.some(
              (p) =>
                readingKey(p.reading) === readingKey(pair.reading) &&
                textKey(item.meaningVi).includes(textKey(p.written)),
            )))
      )
        continue;
      seen.add(identity);
      result.push({ item, pair, distractors: [...distractors.values()] });
    }
  }
  return result;
}

export function assertKanjiPool(
  targets: KanjiTarget[],
  style: QuestionStyle,
): void {
  if (targets.length === 0) {
    throw new DomainException(
      'QUIZ_NOT_ENOUGH_ITEMS',
      'Cần một từ Nhật có cặp Kanji–kana rõ ràng và 3 phương án sai hợp lệ',
      HttpStatus.CONFLICT,
      { style, available: 0, required: 4 },
    );
  }
}

export function shuffled<T>(entries: T[], rng: Rng): T[] {
  const result = [...entries];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function buildKanjiQuestion(
  targets: KanjiTarget[],
  style: QuestionStyle,
  ordinal: number,
  rng: Rng,
): GeneratedQuizQuestion {
  assertKanjiPool(targets, style);
  const { item, pair, distractors } = targets[ordinal % targets.length];
  const answer = style === 'kanji_reading' ? pair.reading : pair.written;
  const options = shuffled(
    [answer, ...shuffled(distractors, rng).slice(0, 3)],
    rng,
  ).map((text, index) => ({ index, text }));
  return {
    questionType: 'multiple_choice',
    questionStyle: style,
    // JLPT 問題1/2: chỉ hiển thị từ, không kèm câu chỉ dẫn. Khi có câu ngữ cảnh,
    // provider render đè prompt bằng chính câu đó (FE tô khung context.target).
    prompt: style === 'kanji_reading' ? pair.written : pair.reading,
    options,
    correctAnswer: {
      index: options.findIndex((o) => o.text === answer),
      text: answer,
    },
    explanation: `「${pair.written}」 (${pair.reading}): ${item.meaningVi}`,
    languageId: item.languageId,
    conceptId: item.conceptId,
    itemId: item.itemId,
    kanjiTarget: {
      senseId: item.senseId,
      written: pair.written,
      reading: pair.reading,
      validWritten: [
        ...new Set(
          (item.kanjiPairs ?? [])
            .filter((p) => readingKey(p.reading) === readingKey(pair.reading))
            .map((p) => p.written),
        ),
      ],
      validReadings: [
        ...new Set(
          (item.kanjiPairs ?? [])
            .filter((p) => textKey(p.written) === textKey(pair.written))
            .map((p) => p.reading),
        ),
      ],
    },
    context: null,
    evidence: null,
  };
}
