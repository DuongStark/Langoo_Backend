import { QuizQuestionMetadata } from './quiz-contract';
interface QuizQuestionRow {
  questionType: string;
  prompt: string;
  options: unknown;
}
function promptKind(questionType: string): string {
  return questionType === 'fill_blank'
    ? 'typing'
    : questionType === 'matching'
      ? 'matching'
      : 'multiple_choice';
}
export function buildItemPrompt(
  question: QuizQuestionRow,
  metadata: QuizQuestionMetadata,
): Record<string, unknown> {
  const prompt: Record<string, unknown> = {
    kind: promptKind(question.questionType),
    text: question.prompt,
    question_style: metadata.style,
    context: metadata.context,
    segments: metadata.segments ?? null,
    ...(metadata.skill
      ? { skill: metadata.skill, quality_flags: metadata.qualityFlags ?? [] }
      : {}),
  };
  const options = question.options;
  if (question.questionType === 'multiple_choice' && Array.isArray(options)) {
    prompt.options = options;
  }
  if (question.questionType === 'matching' && Array.isArray(options)) {
    const entries = options.filter(
      (entry): entry is { index: number; text: string; side?: string } =>
        typeof entry === 'object' && entry !== null,
    );
    const pick = (side: string): { index: number; text: string }[] =>
      entries
        .filter((entry) => entry.side === side)
        .map((entry) => ({ index: entry.index, text: entry.text }));
    prompt.left = pick('left');
    prompt.right = pick('right');
  }
  return prompt;
}
