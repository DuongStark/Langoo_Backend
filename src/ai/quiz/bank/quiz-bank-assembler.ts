import { HttpStatus } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DomainException } from '../../../common/errors/domain.exception';
import {
  GeneratedQuizQuestion,
  QuizSourceItem,
} from '../../providers/ai-quiz.provider';
import { PublicQuizContext, textKey } from '../quiz-contract';
import { cleanTargets, QUIZ_SKILLS, QuizSkill } from '../quiz-skills';
import {
  QuizEligibilityResponse,
  QuizSkillEligibilityResponse,
} from '../dto/quiz-bank.dto';
import {
  derivePosBucket,
  QUIZ_M115_VERSION,
  QuizSentenceSegments,
  toQuestionSegments,
} from './quiz-bank-gate';
import { BankQuestionRow } from './quiz-bank.repository';

export interface M115QuestionMetadata {
  ordinal: number;
  skill: QuizSkill;
  requestedSkill: QuizSkill;
  style: 'meaning' | 'kanji_reading' | 'kanji_orthography' | 'matching';
  context: PublicQuizContext | null;
  segments: QuizSentenceSegments | null;
  bankQuestionId: string | null;
  qualityFlags: string[];
  targetSenseIds: string[];
}

export interface M115QuizMetadata {
  version: typeof QUIZ_M115_VERSION;
  languageId: number;
  skills: QuizSkill[];
  idempotencyKey?: string;
  targetCount: number;
  questions: M115QuestionMetadata[];
}

export interface AssembledQuizResult {
  questions: GeneratedQuizQuestion[];
  metadata: M115QuizMetadata;
  missingSenseIds: bigint[];
}

function splitMeaningParts(value: string): string[] {
  return value
    .split(/[,;/・\n()（）]+/)
    .map((part) => textKey(part))
    .filter((part) => part.length > 0);
}

function containsWholeMultiwordPhrase(
  haystack: string,
  phrase: string,
): boolean {
  if (!phrase.includes(' ') || phrase.length < 5) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * Returns true only when dictionary has a non-empty VI gloss AND the user's
 * saved meaning_vi is disjoint from that dictionary gloss (custom note/override).
 */
export function hasCustomMeaningOverride(
  userMeaningVi: string,
  dictGlossVi?: string | null,
): boolean {
  if (!dictGlossVi || !dictGlossVi.trim()) return false;
  const userNorm = textKey(userMeaningVi);
  const dictNorm = textKey(dictGlossVi);
  if (!userNorm || !dictNorm) return false;
  if (userNorm === dictNorm) return false;

  const userParts = splitMeaningParts(userMeaningVi);
  const dictParts = splitMeaningParts(dictGlossVi);
  const dictSet = new Set(dictParts);
  if (userParts.some((part) => dictSet.has(part))) {
    return false;
  }
  for (const u of userParts) {
    for (const d of dictParts) {
      if (
        containsWholeMultiwordPhrase(d, u) ||
        containsWholeMultiwordPhrase(u, d)
      ) {
        return false;
      }
    }
  }
  return true;
}

function hasEligibleKanji(item: QuizSourceItem): boolean {
  return (
    item.languageId === 2 &&
    (item.kanjiPairs ?? []).some(
      (p) => p.eligible && /\p{Script=Han}/u.test(p.written) && !!p.reading,
    )
  );
}

function distinctMeaningDistractors(
  target: QuizSourceItem,
  pool: QuizSourceItem[],
  drawIndex: (max: number) => number,
): string[] {
  const seen = new Set([textKey(target.meaningVi)]);
  const candidates: string[] = [];
  for (const other of pool) {
    if (
      other.senseId === target.senseId ||
      (target.conceptId !== null && other.conceptId === target.conceptId)
    ) {
      continue;
    }
    const mk = textKey(other.meaningVi);
    if (!mk || seen.has(mk)) continue;
    seen.add(mk);
    candidates.push(other.meaningVi);
  }
  return pickRandomSubset(candidates, 3, drawIndex);
}

function validClozeDistractors(
  target: QuizSourceItem,
  bankRow: BankQuestionRow,
  pool: QuizSourceItem[],
  drawIndex: (max: number) => number,
): string[] {
  const targetBucket =
    bankRow.posBucket ||
    derivePosBucket(
      target.languageCode ?? (target.languageId === 2 ? 'ja' : 'en'),
      target.pos,
      target.lexemeAttributes,
      target.lemma,
    );
  const excluded = new Set(bankRow.excludedWords.map((w) => textKey(w)));
  const targetGlossEn = new Set((target.glossEn ?? []).map((g) => textKey(g)));
  const seenLemmas = new Set([textKey(target.lemma)]);
  const targetMeaning = textKey(target.meaningVi);

  const candidates: string[] = [];
  for (const other of pool) {
    if (
      other.senseId === target.senseId ||
      (target.conceptId !== null && other.conceptId === target.conceptId)
    ) {
      continue;
    }
    const lk = textKey(other.lemma);
    if (!lk || seenLemmas.has(lk) || excluded.has(lk)) continue;
    if (textKey(other.meaningVi) === targetMeaning) continue;
    if ((other.glossEn ?? []).some((g) => targetGlossEn.has(textKey(g)))) {
      continue;
    }
    const otherBucket = derivePosBucket(
      other.languageCode ?? (other.languageId === 2 ? 'ja' : 'en'),
      other.pos,
      other.lexemeAttributes,
      other.lemma,
    );
    if (otherBucket !== targetBucket) continue;
    seenLemmas.add(lk);
    candidates.push(other.lemma);
  }
  return pickRandomSubset(candidates, 3, drawIndex);
}

function pickRandomSubset<T>(
  list: T[],
  count: number,
  drawIndex: (max: number) => number,
): T[] {
  if (list.length < count) return [];
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = drawIndex(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function placeOptions(
  correctText: string,
  wrongTexts: string[],
  drawIndex: (max: number) => number,
): {
  options: { index: number; text: string }[];
  correctAnswer: Record<string, unknown>;
} {
  const correctIndex = drawIndex(4);
  const texts = [...wrongTexts];
  texts.splice(correctIndex, 0, correctText);
  return {
    options: texts.map((text, index) => ({ index, text })),
    correctAnswer: {
      index: correctIndex,
      text: correctText,
      rubric: QUIZ_M115_VERSION,
    },
  };
}

function buildPublicContext(row: BankQuestionRow): PublicQuizContext {
  const full = `${row.sentenceBefore}${row.targetSurface}${row.sentenceAfter}`;
  const start = Array.from(row.sentenceBefore).length;
  const end = start + Array.from(row.targetSurface).length;
  return {
    sentence: full,
    target: {
      start,
      end,
      text: row.targetSurface,
    },
    origin: row.origin,
    attribution: null,
  };
}

function localizedMeaningItems(items: QuizSourceItem[]): QuizSourceItem[] {
  return items.flatMap((item) => {
    const meaning = textKey(item.meaningVi);
    const vietnamese = item.dictGlossVi?.trim();
    const isKnownFallback =
      meaning === textKey(item.dictGlossEn ?? '') ||
      (!vietnamese && meaning === textKey(item.lemma));
    if (
      item.languageId !== 2 ||
      !isKnownFallback ||
      meaning === textKey(vietnamese ?? '')
    ) {
      return [item];
    }
    return vietnamese ? [{ ...item, meaningVi: vietnamese }] : [];
  });
}

function unambiguousItems(items: QuizSourceItem[]): QuizSourceItem[] {
  const meaningsByLemma = new Map<string, Set<string>>();
  for (const item of items) {
    const lk = textKey(item.lemma);
    const set = meaningsByLemma.get(lk) ?? new Set<string>();
    set.add(textKey(item.meaningVi));
    meaningsByLemma.set(lk, set);
  }
  return items.filter(
    (item) => (meaningsByLemma.get(textKey(item.lemma))?.size ?? 0) === 1,
  );
}

export function evaluateBankEligibility(input: {
  items: QuizSourceItem[];
  bankRows: BankQuestionRow[];
  languageId: number;
  skills: QuizSkill[];
  requestedCount: number;
  sourceComplete?: boolean;
}): QuizEligibilityResponse {
  const clean = cleanTargets(input.items, input.languageId);
  const meaningItems = localizedMeaningItems(clean);
  const unambiguous = unambiguousItems(meaningItems);
  const distinctMeanings = new Set(clean.map((i) => textKey(i.meaningVi))).size;
  const localizedMeaningCount = new Set(
    meaningItems.map((item) => textKey(item.meaningVi)),
  ).size;
  const anyKanji = clean.some(hasEligibleKanji);

  const bankBySenseSkill = new Map<string, BankQuestionRow[]>();
  for (const row of input.bankRows) {
    const key = `${row.senseId.toString()}:${row.skill}`;
    const arr = bankBySenseSkill.get(key) ?? [];
    arr.push(row);
    bankBySenseSkill.set(key, arr);
  }

  const activeSkills = input.skills.filter((s) => {
    if (s === 'usage' || s === 'paraphrase') return false;
    if (
      (s === 'kanji_reading' || s === 'kanji_orthography') &&
      (input.languageId !== 2 || !anyKanji)
    ) {
      return false;
    }
    return true;
  });

  const requestedPerSkill = new Map<QuizSkill, number>();
  for (const s of input.skills) requestedPerSkill.set(s, 0);
  if (activeSkills.length > 0) {
    for (let i = 0; i < input.requestedCount; i++) {
      const s = activeSkills[i % activeSkills.length];
      requestedPerSkill.set(s, (requestedPerSkill.get(s) ?? 0) + 1);
    }
  }

  const bySkill: QuizSkillEligibilityResponse[] = input.skills.map((skill) => {
    const requested = requestedPerSkill.get(skill) ?? 0;
    if (skill === 'usage' || skill === 'paraphrase') {
      return {
        skill,
        requested,
        eligible_targets: 0,
        source_policy: 'unavailable',
      };
    }
    if (skill === 'kanji_reading' || skill === 'kanji_orthography') {
      if (input.languageId !== 2 || !anyKanji) {
        return {
          skill,
          requested,
          eligible_targets: 0,
          source_policy: 'unavailable',
        };
      }
      const kanjiCount = clean.filter(hasEligibleKanji).length;
      return {
        skill,
        requested,
        eligible_targets: distinctMeanings >= 4 ? kanjiCount : 0,
        source_policy: 'ai_distractors',
      };
    }
    if (skill === 'matching') {
      const matchReady =
        localizedMeaningCount >= 4 && unambiguous.length >= 4
          ? unambiguous.length
          : 0;
      return {
        skill,
        requested,
        eligible_targets: matchReady,
        source_policy: 'collection_only',
      };
    }
    return {
      skill,
      requested,
      eligible_targets:
        skill === 'context_cloze'
          ? distinctMeanings >= 4
            ? clean.length
            : 0
          : localizedMeaningCount >= 4
            ? meaningItems.length
            : 0,
      source_policy: 'collection_only',
    };
  });

  const reasons: string[] = [];
  if (input.skills.includes('paraphrase')) {
    reasons.push('CURATED_PARAPHRASE_SOURCE_NOT_READY');
  }
  if (input.skills.includes('usage')) {
    reasons.push('USAGE_SKILL_DEFERRED_PHASE_2');
  }

  if (activeSkills.length === 0 || distinctMeanings < 4) {
    reasons.push('INSUFFICIENT_ELIGIBLE_SOURCE');
    return {
      feasible: false,
      eligible_target_count: clean.length,
      requested_count: input.requestedCount,
      suggested_count: null,
      by_skill: bySkill,
      reasons,
      source_complete: input.sourceComplete ?? true,
      level_filter_supported: false,
      sample_sources_supported: false,
    };
  }

  // Dry-run max achievable unique post-fallback questions (up to requestedCount)
  const dryRun = tryAssembleSlots({
    clean,
    meaningItems,
    unambiguous,
    bankRows: input.bankRows,
    recentBankIds: new Set(),
    languageId: input.languageId,
    activeSkills,
    maxCount: input.requestedCount,
    drawIndex: () => 0,
  });

  const achievable = dryRun.questions.length;
  const feasible = achievable >= input.requestedCount;
  if (!feasible) {
    reasons.push('INSUFFICIENT_ELIGIBLE_SOURCE');
  }

  return {
    feasible,
    eligible_target_count: clean.length,
    requested_count: input.requestedCount,
    suggested_count: achievable > 0 ? achievable : null,
    by_skill: bySkill,
    reasons,
    source_complete: input.sourceComplete ?? true,
    level_filter_supported: false,
    sample_sources_supported: false,
  };
}

export function assembleQuizFromBank(input: {
  items: QuizSourceItem[];
  bankRows: BankQuestionRow[];
  recentBankIds: Set<string>;
  recentSenseIds?: Set<string>;
  languageId: number;
  skills: QuizSkill[];
  questionCount: number;
  idempotencyKey?: string;
  drawIndex?: (max: number) => number;
}): AssembledQuizResult {
  const drawIndex = input.drawIndex ?? ((max: number) => randomInt(max));
  const rawClean = cleanTargets(input.items, input.languageId);
  const recentSenses = input.recentSenseIds ?? new Set<string>();

  // Shuffle within fresh vs recently-tested tiers so large decks rotate across all words
  const freshItems = rawClean.filter((i) => !recentSenses.has(i.senseId));
  const seenItems = rawClean.filter((i) => recentSenses.has(i.senseId));
  const shuffle = (arr: QuizSourceItem[]): QuizSourceItem[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = drawIndex(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const clean = input.drawIndex
    ? [...freshItems, ...seenItems]
    : [...shuffle(freshItems), ...shuffle(seenItems)];
  const meaningItems = localizedMeaningItems(clean);
  const unambiguous = unambiguousItems(meaningItems);
  const distinctMeanings = new Set(clean.map((i) => textKey(i.meaningVi))).size;
  const anyKanji = clean.some(hasEligibleKanji);

  const activeSkills = input.skills.filter((s) => {
    if (!(QUIZ_SKILLS as readonly string[]).includes(s)) return false;
    if (s === 'usage' || s === 'paraphrase') return false;
    if (
      (s === 'kanji_reading' || s === 'kanji_orthography') &&
      (input.languageId !== 2 || !anyKanji)
    ) {
      return false;
    }
    return true;
  });

  if (activeSkills.length === 0 || distinctMeanings < 4) {
    throw new DomainException(
      'QUIZ_NOT_ENOUGH_ITEMS',
      'Bộ sưu tập cần ít nhất 4 từ có nghĩa phân biệt phù hợp với dạng bài đã chọn',
      HttpStatus.CONFLICT,
      { available: clean.length, required: 4 },
    );
  }

  const built = tryAssembleSlots({
    clean,
    meaningItems,
    unambiguous,
    bankRows: input.bankRows,
    recentBankIds: input.recentBankIds,
    languageId: input.languageId,
    activeSkills,
    maxCount: input.questionCount,
    drawIndex,
  });

  if (built.questions.length < input.questionCount) {
    throw new DomainException(
      'QUIZ_NOT_ENOUGH_ITEMS',
      'Bộ sưu tập không đủ từ cho số câu hỏi yêu cầu',
      HttpStatus.CONFLICT,
      {
        available: built.questions.length,
        required: input.questionCount,
      },
    );
  }

  const coveredSenses = new Set(
    input.bankRows.map((r) => r.senseId.toString()),
  );
  const missingSenseIds = clean
    .filter((item) => !coveredSenses.has(item.senseId))
    .map((item) => BigInt(item.senseId));

  return {
    questions: built.questions,
    metadata: {
      version: QUIZ_M115_VERSION,
      languageId: input.languageId,
      skills: activeSkills,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      targetCount: built.uniqueTargetSenses.size,
      questions: built.questionMetas,
    },
    missingSenseIds,
  };
}

function tryAssembleSlots(params: {
  clean: QuizSourceItem[];
  meaningItems: QuizSourceItem[];
  unambiguous: QuizSourceItem[];
  bankRows: BankQuestionRow[];
  recentBankIds: Set<string>;
  languageId: number;
  activeSkills: QuizSkill[];
  maxCount: number;
  drawIndex: (max: number) => number;
}): {
  questions: GeneratedQuizQuestion[];
  questionMetas: M115QuestionMetadata[];
  uniqueTargetSenses: Set<string>;
} {
  const {
    clean,
    meaningItems,
    unambiguous,
    bankRows,
    recentBankIds,
    activeSkills,
    maxCount,
    drawIndex,
  } = params;

  const bankBySenseSkill = new Map<string, BankQuestionRow[]>();
  for (const row of bankRows) {
    const key = `${row.senseId.toString()}:${row.skill}`;
    const list = bankBySenseSkill.get(key) ?? [];
    list.push(row);
    bankBySenseSkill.set(key, list);
  }

  // Sort each (sense, skill) variant list so unseen variants come BEFORE recentBankIds
  for (const [key, list] of bankBySenseSkill.entries()) {
    list.sort((a, b) => {
      const aRecent = recentBankIds.has(a.id.toString()) ? 1 : 0;
      const bRecent = recentBankIds.has(b.id.toString()) ? 1 : 0;
      if (aRecent !== bRecent) return aRecent - bRecent;
      return a.variantNo - b.variantNo;
    });
    bankBySenseSkill.set(key, list);
  }

  const usedSenseSkill = new Set<string>();
  const usedSenseCount = new Map<string, number>();
  const usedSentenceHashes = new Set<string>();
  const uniqueTargetSenses = new Set<string>();
  const questions: GeneratedQuizQuestion[] = [];
  const questionMetas: M115QuestionMetadata[] = [];

  const canTakeSense = (senseId: string, effectiveSkill: QuizSkill): boolean =>
    !usedSenseSkill.has(`${senseId}:${effectiveSkill}`) &&
    (usedSenseCount.get(senseId) ?? 0) < 2;

  // Prefer unused senses (count === 0) before reusing a sense for a 2nd skill (count === 1)
  const prioritizeUnused = (
    pool: QuizSourceItem[],
    effectiveSkill: QuizSkill,
  ): QuizSourceItem[] => {
    const unused: QuizSourceItem[] = [];
    const secondPass: QuizSourceItem[] = [];
    for (const item of pool) {
      if (!canTakeSense(item.senseId, effectiveSkill)) continue;
      if ((usedSenseCount.get(item.senseId) ?? 0) === 0) unused.push(item);
      else secondPass.push(item);
    }
    return [...unused, ...secondPass];
  };

  const markSense = (senseId: string, effectiveSkill: QuizSkill) => {
    usedSenseSkill.add(`${senseId}:${effectiveSkill}`);
    usedSenseCount.set(senseId, (usedSenseCount.get(senseId) ?? 0) + 1);
    uniqueTargetSenses.add(senseId);
  };

  const pickBankVariant = (
    senseId: string,
    skill: BankQuestionRow['skill'],
  ): BankQuestionRow | null => {
    const list = bankBySenseSkill.get(`${senseId}:${skill}`) ?? [];
    return (
      list.find((row) => !usedSentenceHashes.has(row.sentenceHash)) ?? null
    );
  };

  const flagsFor = (
    item: QuizSourceItem,
    row?: BankQuestionRow | null,
  ): string[] => {
    const flags: string[] = [];
    if (item.glossViMachine) flags.push('machine_gloss');
    if (row && row.verification === 'machine_reviewed') {
      flags.push('bank_machine_reviewed');
    }
    return flags;
  };

  const tryBuildBankKanji = (
    requestedSkill: 'kanji_reading' | 'kanji_orthography',
    ordinal: number,
  ): boolean => {
    for (const item of prioritizeUnused(clean, requestedSkill)) {
      if (!hasEligibleKanji(item)) {
        continue;
      }
      const row = pickBankVariant(item.senseId, requestedSkill);
      if (!row || row.fixedDistractors.length !== 3) continue;

      const { options, correctAnswer } = placeOptions(
        row.canonicalAnswer,
        row.fixedDistractors,
        drawIndex,
      );
      const context = buildPublicContext(row);
      const segments = toQuestionSegments(row);
      usedSentenceHashes.add(row.sentenceHash);
      markSense(item.senseId, requestedSkill);

      questions.push({
        questionType: 'multiple_choice',
        prompt:
          requestedSkill === 'kanji_reading'
            ? 'Chọn cách đọc đúng của từ được đánh dấu trong câu.'
            : 'Chọn cách viết Kanji đúng cho từ được đánh dấu trong câu.',
        options,
        correctAnswer,
        explanation: null,
        languageId: item.languageId,
        conceptId: item.conceptId,
        itemId: item.itemId,
        questionStyle: requestedSkill,
        context,
      });
      questionMetas.push({
        ordinal,
        skill: requestedSkill,
        requestedSkill,
        style: requestedSkill,
        context,
        segments,
        bankQuestionId: row.id.toString(),
        qualityFlags: flagsFor(item, row),
        targetSenseIds: [item.senseId],
      });
      return true;
    }
    return false;
  };

  const tryBuildCloze = (
    requestedSkill: QuizSkill,
    ordinal: number,
  ): boolean => {
    for (const item of prioritizeUnused(clean, 'context_cloze')) {
      if (hasCustomMeaningOverride(item.meaningVi, item.dictGlossVi)) {
        continue;
      }
      const row = pickBankVariant(item.senseId, 'context_cloze');
      if (!row) continue;
      const wrong = validClozeDistractors(item, row, clean, drawIndex);
      if (wrong.length < 3) continue;

      const { options, correctAnswer } = placeOptions(
        row.canonicalAnswer,
        wrong,
        drawIndex,
      );
      const segments = toQuestionSegments(row);
      usedSentenceHashes.add(row.sentenceHash);
      markSense(item.senseId, 'context_cloze');

      questions.push({
        questionType: 'multiple_choice',
        prompt: 'Chọn từ phù hợp điền vào chỗ trống.',
        options,
        correctAnswer,
        explanation: null,
        languageId: item.languageId,
        conceptId: item.conceptId,
        itemId: item.itemId,
        questionStyle: 'meaning',
        context: null,
      });
      questionMetas.push({
        ordinal,
        skill: 'context_cloze',
        requestedSkill,
        style: 'meaning',
        context: null,
        segments,
        bankQuestionId: row.id.toString(),
        qualityFlags: flagsFor(item, row),
        targetSenseIds: [item.senseId],
      });
      return true;
    }
    return false;
  };

  const tryBuildContextMeaning = (
    requestedSkill: QuizSkill,
    ordinal: number,
  ): boolean => {
    for (const item of prioritizeUnused(meaningItems, 'context_meaning')) {
      if (hasCustomMeaningOverride(item.meaningVi, item.dictGlossVi)) {
        continue;
      }
      const row =
        pickBankVariant(item.senseId, 'context_meaning') ??
        pickBankVariant(item.senseId, 'context_cloze');
      if (!row) continue;
      const wrong = distinctMeaningDistractors(item, meaningItems, drawIndex);
      if (wrong.length < 3) continue;

      const asMeaningRow: BankQuestionRow = {
        ...row,
        skill: 'context_meaning',
        targetSurface: item.lemma,
      };
      const { options, correctAnswer } = placeOptions(
        item.meaningVi,
        wrong,
        drawIndex,
      );
      const context = buildPublicContext(asMeaningRow);
      const segments = toQuestionSegments(asMeaningRow);
      usedSentenceHashes.add(row.sentenceHash);
      markSense(item.senseId, 'context_meaning');

      questions.push({
        questionType: 'multiple_choice',
        prompt: 'Chọn nghĩa đúng của từ được đánh dấu trong câu.',
        options,
        correctAnswer,
        explanation: null,
        languageId: item.languageId,
        conceptId: item.conceptId,
        itemId: item.itemId,
        questionStyle: 'meaning',
        context,
      });
      questionMetas.push({
        ordinal,
        skill: 'context_meaning',
        requestedSkill,
        style: 'meaning',
        context,
        segments,
        bankQuestionId: row.id.toString(),
        qualityFlags: flagsFor(item, row),
        targetSenseIds: [item.senseId],
      });
      return true;
    }
    return false;
  };

  const tryBuildMeaning = (
    requestedSkill: QuizSkill,
    ordinal: number,
  ): boolean => {
    for (const item of prioritizeUnused(unambiguous, 'meaning')) {
      const wrong = distinctMeaningDistractors(item, meaningItems, drawIndex);
      if (wrong.length < 3) continue;

      const { options, correctAnswer } = placeOptions(
        item.meaningVi,
        wrong,
        drawIndex,
      );
      markSense(item.senseId, 'meaning');

      const label =
        item.reading && item.reading !== item.lemma
          ? `${item.lemma} (${item.reading})`
          : item.lemma;

      questions.push({
        questionType: 'multiple_choice',
        prompt: `Chọn nghĩa đúng của từ "${label}".`,
        options,
        correctAnswer,
        explanation: null,
        languageId: item.languageId,
        conceptId: item.conceptId,
        itemId: item.itemId,
        questionStyle: 'meaning',
        context: null,
      });
      questionMetas.push({
        ordinal,
        skill: 'meaning',
        requestedSkill,
        style: 'meaning',
        context: null,
        segments: null,
        bankQuestionId: null,
        qualityFlags: flagsFor(item, null),
        targetSenseIds: [item.senseId],
      });
      return true;
    }
    return false;
  };

  const tryBuildMatching = (
    requestedSkill: QuizSkill,
    ordinal: number,
  ): boolean => {
    const chosen: QuizSourceItem[] = [];
    const seenMeaning = new Set<string>();
    for (const item of prioritizeUnused(unambiguous, 'matching')) {
      const mk = textKey(item.meaningVi);
      if (seenMeaning.has(mk)) continue;
      seenMeaning.add(mk);
      chosen.push(item);
      if (chosen.length === 4) break;
    }
    if (chosen.length < 4) return false;

    const rightMeanings = chosen.map((c) => c.meaningVi);
    for (let i = rightMeanings.length - 1; i > 0; i--) {
      const j = drawIndex(i + 1);
      [rightMeanings[i], rightMeanings[j]] = [
        rightMeanings[j],
        rightMeanings[i],
      ];
    }
    const options = [
      ...chosen.map((c, index) => ({
        index,
        text: c.lemma,
        side: 'left' as const,
      })),
      ...rightMeanings.map((text, index) => ({
        index,
        text,
        side: 'right' as const,
      })),
    ];
    const correctAnswer = {
      rubric: QUIZ_M115_VERSION,
      mapping: chosen.map((c, leftIdx) => ({
        left_index: leftIdx,
        right_index: rightMeanings.indexOf(c.meaningVi),
      })),
    };
    for (const c of chosen) markSense(c.senseId, 'matching');

    questions.push({
      questionType: 'matching',
      prompt: 'Nối mỗi từ với nghĩa tiếng Việt tương ứng.',
      options,
      correctAnswer,
      explanation: null,
      languageId: chosen[0].languageId,
      conceptId: chosen[0].conceptId,
      itemId: chosen[0].itemId,
      questionStyle: 'matching',
      context: null,
    });
    questionMetas.push({
      ordinal,
      skill: 'matching',
      requestedSkill,
      style: 'matching',
      context: null,
      segments: null,
      bankQuestionId: null,
      qualityFlags: chosen.some((c) => c.glossViMachine)
        ? ['machine_gloss']
        : [],
      targetSenseIds: chosen.map((c) => c.senseId),
    });
    return true;
  };

  for (let slotIndex = 0; slotIndex < maxCount; slotIndex++) {
    const requestedSkill = activeSkills[slotIndex % activeSkills.length];
    const ordinal = questions.length + 1;
    let built = false;

    if (requestedSkill === 'matching') {
      built =
        tryBuildMatching(requestedSkill, ordinal) ||
        tryBuildMeaning(requestedSkill, ordinal);
    } else if (
      requestedSkill === 'kanji_reading' ||
      requestedSkill === 'kanji_orthography'
    ) {
      built =
        tryBuildBankKanji(requestedSkill, ordinal) ||
        tryBuildContextMeaning(requestedSkill, ordinal) ||
        tryBuildMeaning(requestedSkill, ordinal);
    } else if (requestedSkill === 'context_cloze') {
      built =
        tryBuildCloze(requestedSkill, ordinal) ||
        tryBuildContextMeaning(requestedSkill, ordinal) ||
        tryBuildMeaning(requestedSkill, ordinal);
    } else if (requestedSkill === 'context_meaning') {
      built =
        tryBuildContextMeaning(requestedSkill, ordinal) ||
        tryBuildMeaning(requestedSkill, ordinal);
    } else {
      built = tryBuildMeaning(requestedSkill, ordinal);
    }

    if (!built) break;
  }

  return { questions, questionMetas, uniqueTargetSenses };
}
