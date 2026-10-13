import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainException } from '../../common/errors/domain.exception';
import type { QuizQuestionType } from '../../sessions/quiz-content';

export const QUESTION_STYLES = [
  'meaning',
  'kanji_reading',
  'kanji_orthography',
] as const;
export const CONTEXT_MODES = ['none', 'source', 'source_or_generated'] as const;
export type QuestionStyle = (typeof QUESTION_STYLES)[number];
export type ContextMode = (typeof CONTEXT_MODES)[number];
export const QUIZ_VERSION = 'm11.2-v2';
export const CONTEXT_POLICY = 'kanji-context-v1';

/** Checkbox dạng câu hỏi của người dùng; thứ tự chuẩn để chia slot ổn định. */
export const QUIZ_QUESTION_TYPES = [
  'multiple_choice',
  'fill_blank',
  'matching',
] as const;

export function canonicalQuestionTypes(
  types: readonly string[],
): QuizQuestionType[] {
  return QUIZ_QUESTION_TYPES.filter((type) => types.includes(type));
}

export function textKey(text: string): string {
  return text.normalize('NFKC').trim().toLocaleLowerCase();
}
/** Hiragana/katakana spellings of the same reading must not be two answers. */
export function readingKey(text: string): string {
  return textKey(text).replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60),
  );
}
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export const publicContextSchema = z
  .object({
    // +2 code point cho cặp dấu 【 】 đánh dấu từ mục tiêu.
    sentence: z.string().min(1).max(242),
    target: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        text: z.string().min(1),
      })
      .strict(),
    origin: z.enum(['dictionary', 'generated']),
    attribution: z.string().max(1000).nullable(),
  })
  .strict()
  .superRefine((context, ctx) => {
    if (
      Array.from(context.sentence)
        .slice(context.target.start, context.target.end)
        .join('') !== context.target.text
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid target span',
      });
    }
  });
export type PublicQuizContext = z.infer<typeof publicContextSchema>;

export const evidenceSchema = z
  .object({
    policy: z.literal(CONTEXT_POLICY),
    contextKey: z.string().length(64),
    answerKey: z.string().length(64),
    sentence: z.string().min(1).max(240),
    origin: z.enum(['dictionary', 'generated']),
    attribution: z.string().max(1000).nullable(),
    exampleId: z.string().nullable(),
    sourceHash: z.string().length(64).nullable(),
    generatorModel: z.string().nullable(),
    validatorModel: z.string().min(1),
    accepted: z.literal(true),
  })
  .strict();
export type ContextEvidence = z.infer<typeof evidenceSchema>;

const questionMetaSchema = z
  .object({
    ordinal: z.number().int().positive(),
    style: z.enum([...QUESTION_STYLES, 'matching', 'fill_blank']),
    context: publicContextSchema.nullable(),
    evidence: evidenceSchema.nullable(),
  })
  .strict();
export type QuizQuestionMetadata = z.infer<typeof questionMetaSchema>;
export const metadataSchema = z
  .object({
    version: z.literal(QUIZ_VERSION),
    provider: z.string(),
    questionTypes: z.array(z.enum(QUIZ_QUESTION_TYPES)).min(1).max(3),
    questions: z.array(questionMetaSchema),
    usage: z
      .object({
        tokensIn: z.number().nonnegative(),
        tokensOut: z.number().nonnegative(),
        calls: z.number().int().nonnegative(),
        reused: z.number().int().nonnegative(),
        local: z.number().int().nonnegative(),
        estimated: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

export function readQuestionMetadata(
  generator: unknown,
  ordinal: number,
  type: string,
): QuizQuestionMetadata {
  if (
    typeof generator === 'object' &&
    generator !== null &&
    'version' in generator &&
    generator.version === QUIZ_VERSION
  ) {
    const parsed = metadataSchema.safeParse(generator);
    const question = parsed.success
      ? parsed.data.questions.find((q) => q.ordinal === ordinal)
      : undefined;
    if (
      !question ||
      (type !== 'multiple_choice' && question.style !== type) ||
      (type === 'multiple_choice' &&
        !QUESTION_STYLES.includes(question.style as QuestionStyle))
    ) {
      throw new DomainException(
        'QUIZ_METADATA_INVALID',
        'Metadata câu hỏi không hợp lệ',
        HttpStatus.CONFLICT,
      );
    }
    return question;
  }
  return {
    ordinal,
    style:
      type === 'multiple_choice'
        ? 'meaning'
        : type === 'matching'
          ? 'matching'
          : 'fill_blank',
    context: null,
    evidence: null,
  };
}
