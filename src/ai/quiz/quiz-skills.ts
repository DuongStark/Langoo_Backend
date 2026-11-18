import { QuizSourceItem } from '../providers/ai-quiz.provider';

export const QUIZ_SKILLS = [
  'meaning',
  'matching',
  'kanji_reading',
  'kanji_orthography',
  'context_cloze',
  'context_meaning',
  'usage',
  'paraphrase',
] as const;
export type QuizSkill = (typeof QUIZ_SKILLS)[number];
export function cleanTargets(
  raw: QuizSourceItem[],
  languageId: number,
): QuizSourceItem[] {
  const seen = new Set<string>();
  return raw.filter((item) => {
    if (
      item.languageId !== languageId ||
      !item.lemma.trim() ||
      !item.meaningVi.trim()
    )
      return false;
    const key = `${item.languageId}:${item.senseId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
