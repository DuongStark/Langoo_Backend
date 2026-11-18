export const QUIZ_FEEDBACK_AFTER_ANSWER = 'after_answer';

function quizVersion(settings: unknown): unknown {
  return typeof settings === 'object' &&
    settings !== null &&
    'quiz_version' in settings
    ? settings.quiz_version
    : undefined;
}

export function isImmediateQuiz(settings: unknown): boolean {
  return quizVersion(settings) === 'm11.5-v1';
}

export function quizCredit(
  value: unknown,
): { earned: number; possible: number } | null {
  if (typeof value !== 'object' || value === null || !('_quiz_credit' in value))
    return null;
  const c = value._quiz_credit;
  if (
    typeof c !== 'object' ||
    c === null ||
    !('earned' in c) ||
    !('possible' in c) ||
    typeof c.earned !== 'number' ||
    typeof c.possible !== 'number' ||
    !Number.isInteger(c.earned) ||
    !Number.isInteger(c.possible) ||
    c.possible <= 0 ||
    c.earned < 0 ||
    c.earned > c.possible
  )
    return null;
  return { earned: c.earned, possible: c.possible };
}
export function publicQuizAnswer(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== '_quiz_credit'),
  );
}
/** Every question has equal weight; matching reports credit within its question. */
export function quizCreditScore(
  items: { userAnswer: unknown; isCorrect: boolean | null }[],
): number {
  if (!items.length) return 0;
  return Math.round(
    (100 *
      items.reduce((sum, item) => {
        const c = quizCredit(item.userAnswer);
        return sum + (c ? c.earned / c.possible : item.isCorrect ? 1 : 0);
      }, 0)) /
      items.length,
  );
}
export function quizSkillSummary(
  items: { prompt: unknown; userAnswer: unknown; isCorrect: boolean | null }[],
) {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const skill =
      typeof item.prompt === 'object' &&
      item.prompt !== null &&
      'skill' in item.prompt &&
      typeof item.prompt.skill === 'string'
        ? item.prompt.skill
        : 'unknown';
    const group = groups.get(skill) ?? [];
    group.push(item);
    groups.set(skill, group);
  }
  return [...groups].map(([skill, rows]) => ({
    skill,
    question_count: rows.length,
    correct_count: rows.filter((r) => r.isCorrect).length,
    score: quizCreditScore(rows),
  }));
}
