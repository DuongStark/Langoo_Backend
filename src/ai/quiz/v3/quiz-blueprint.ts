import { QuizSourceItem } from '../../providers/ai-quiz.provider';
import { createKanjiPool } from '../kanji-generator';
import { readingKey, textKey } from '../quiz-contract';

export const QUIZ_V3 = 'm11.3-v3';
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
export interface QuizSlot {
  ordinal: number;
  skill: QuizSkill;
  targets: QuizSourceItem[];
}
export interface QuizPlan {
  feasible: boolean;
  targetCount: number;
  requestedCount: number;
  bySkill: { skill: QuizSkill; requested: number; eligibleTargets: number }[];
  slots: QuizSlot[];
}

/** Deliberate kana errors; no dictionary truth is inferred from these strings. */
export function readingDistractors(
  reading: string,
  validReadings: string[],
): string[] {
  const forbidden = new Set(validReadings.map(readingKey));
  const result = new Map<string, string>();
  const add = (text: string) => {
    const key = readingKey(text);
    if (
      text &&
      !forbidden.has(key) &&
      /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(text)
    )
      result.set(key, text);
  };
  const pairs = [
    'かが',
    'きぎ',
    'くぐ',
    'けげ',
    'こご',
    'さざ',
    'しじ',
    'すず',
    'せぜ',
    'そぞ',
    'ただ',
    'ちぢ',
    'つづ',
    'てで',
    'とど',
    'はば',
    'ひび',
    'ふぶ',
    'へべ',
    'ほぼ',
    'ばぱ',
    'びぴ',
    'ぶぷ',
    'べぺ',
    'ぼぽ',
    'やゃ',
    'ゆゅ',
    'よょ',
    'つっ',
  ];
  const chars = Array.from(reading);
  for (let i = 0; i < chars.length; i++) {
    for (const [a, b] of pairs) {
      if (chars[i] === a || chars[i] === b)
        add(chars.map((c, j) => (j === i ? (c === a ? b : a) : c)).join(''));
    }
    if ('っーうい'.includes(chars[i]) && chars.length > 1)
      add(chars.filter((_, j) => j !== i).join(''));
  }
  return [...result.values()].slice(0, 12);
}

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

export function inSetChoices(
  item: QuizSourceItem,
  items: QuizSourceItem[],
  skill: QuizSkill,
  limit = 3,
): QuizSourceItem[] {
  const targetLemma = textKey(item.lemma);
  const targetMeaning = textKey(item.meaningVi);
  const seen = new Set([
    textKey(skill === 'context_cloze' ? item.lemma : item.meaningVi),
  ]);
  const choices: QuizSourceItem[] = [];
  for (const candidate of items) {
    if (
      candidate.senseId === item.senseId ||
      textKey(candidate.lemma) === targetLemma ||
      textKey(candidate.meaningVi) === targetMeaning
    )
      continue;
    if (
      skill === 'context_cloze' &&
      (!item.pos || !candidate.pos || item.pos !== candidate.pos)
    )
      continue;
    const text =
      skill === 'context_cloze' ? candidate.lemma : candidate.meaningVi;
    if (seen.has(textKey(text))) continue;
    seen.add(textKey(text));
    choices.push(candidate);
    if (choices.length === limit) break;
  }
  return choices;
}

function pool(items: QuizSourceItem[], skill: QuizSkill): QuizSourceItem[] {
  if (skill === 'paraphrase') return []; // Curated candidate source/level gates must be met before enabling.
  if (skill === 'usage') return items;
  if (skill === 'kanji_reading')
    return items.filter(
      (item) =>
        item.languageCode === 'ja' &&
        (item.kanjiPairs ?? []).some(
          (p) =>
            p.eligible &&
            /\p{Script=Han}/u.test(p.written) &&
            readingDistractors(
              p.reading,
              (item.kanjiPairs ?? [])
                .filter((v) => textKey(v.written) === textKey(p.written))
                .map((v) => v.reading),
            ).length >= 3,
        ),
    );
  if (skill === 'kanji_orthography') {
    const eligible = new Set(
      createKanjiPool(items, skill).map((t) => t.item.senseId),
    );
    return items.filter((i) => eligible.has(i.senseId));
  }
  const eligible = items.filter((item) => {
    if (inSetChoices(item, items, skill).length < 3) return false;
    // Meaning/matching without a context cannot disambiguate identical lemmas.
    return (
      skill === 'context_cloze' ||
      skill === 'context_meaning' ||
      !items.some(
        (other) =>
          other.senseId !== item.senseId &&
          textKey(other.lemma) === textKey(item.lemma),
      )
    );
  });
  if (skill !== 'matching') return eligible;
  const meanings = new Set<string>();
  const lemmas = new Set<string>();
  return eligible.filter((item) => {
    const meaning = textKey(item.meaningVi),
      lemma = textKey(item.lemma);
    if (meanings.has(meaning) || lemmas.has(lemma)) return false;
    meanings.add(meaning);
    lemmas.add(lemma);
    return true;
  });
}

/** Max-flow considers overlap between skill pools; targets have capacity two,
 * target+skill capacity one. Matching consumes four distinct targets per slot. */
export function planQuiz(
  raw: QuizSourceItem[],
  languageId: number,
  skills: QuizSkill[],
  count: number,
): QuizPlan {
  const items = cleanTargets(raw, languageId);
  const uniqueSkills = [...new Set(skills)];
  const bySkill = uniqueSkills.map((skill, i) => ({
    skill,
    requested:
      Math.floor(count / uniqueSkills.length) +
      (i < count % uniqueSkills.length ? 1 : 0),
    eligibleTargets: 0,
  }));
  const slots: QuizSlot[] = [];
  let ordinal = 1;
  // Round robin makes adjacent skill blocks less predictable; final content leak check remains mandatory.
  for (let round = 0; slots.length < count && uniqueSkills.length; round++)
    for (const entry of bySkill)
      if (round < entry.requested)
        slots.push({ ordinal: ordinal++, skill: entry.skill, targets: [] });
  type Edge = { to: number; rev: number; cap: number; initial: number };
  const graph: Edge[][] = [[], []];
  const node = () => {
    graph.push([]);
    return graph.length - 1;
  };
  const link = (from: number, to: number, cap: number): Edge => {
    const edge = { to, rev: graph[to].length, cap, initial: cap };
    graph[from].push(edge);
    graph[to].push({
      to: from,
      rev: graph[from].length - 1,
      cap: 0,
      initial: 0,
    });
    return edge;
  };
  const itemNodes = items.map(() => node());
  itemNodes.forEach((n) => link(n, 1, 2));
  const allocations: { edge: Edge; item: QuizSourceItem; skill: QuizSkill }[] =
    [];
  let required = 0;
  for (const entry of bySkill) {
    const candidates = pool(items, entry.skill);
    entry.eligibleTargets = candidates.length;
    const demand = entry.requested * (entry.skill === 'matching' ? 4 : 1);
    required += demand;
    const skillNode = node();
    link(0, skillNode, demand);
    for (const item of candidates)
      allocations.push({
        edge: link(skillNode, itemNodes[items.indexOf(item)], 1),
        item,
        skill: entry.skill,
      });
  }
  let flow = 0;
  while (flow < required) {
    const seen = new Set<number>();
    const push = (n: number): boolean => {
      if (n === 1) return true;
      if (seen.has(n)) return false;
      seen.add(n);
      for (const edge of graph[n])
        if (edge.cap > 0 && push(edge.to)) {
          edge.cap--;
          graph[edge.to][edge.rev].cap++;
          return true;
        }
      return false;
    };
    if (!push(0)) break;
    flow++;
  }
  const feasible =
    count >= uniqueSkills.length &&
    count > 0 &&
    count <= 50 &&
    bySkill.length > 0 &&
    flow === required;
  if (feasible)
    for (const entry of bySkill) {
      const selected = allocations
        .filter((a) => a.skill === entry.skill && a.edge.cap === 0)
        .map((a) => a.item);
      for (const slot of slots.filter((s) => s.skill === entry.skill))
        slot.targets = selected.splice(0, slot.skill === 'matching' ? 4 : 1);
    }
  return {
    feasible,
    targetCount: items.length,
    requestedCount: count,
    bySkill,
    slots: feasible ? slots : [],
  };
}
