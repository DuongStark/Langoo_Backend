import { fingerprint, readingKey, textKey } from '../quiz-contract';

export const QUIZ_M115_VERSION = 'm11.5-v1';
export const BANK_RUBRIC_VERSION = 'm11.5-v1';

export const BANK_SKILLS = [
  'kanji_reading',
  'kanji_orthography',
  'context_cloze',
  'context_meaning',
] as const;

export type BankSkill = (typeof BANK_SKILLS)[number];

export interface QuizSentenceSegments {
  before: string;
  highlight: string | null;
  after: string;
}

export interface BankCandidateInput {
  senseId: string;
  languageCode: 'en' | 'ja';
  skill: BankSkill;
  lemma: string;
  pos?: string | null;
  attributes?: unknown;
  written?: string | null;
  reading?: string | null;
  knownReadings?: string[];
  knownWritings?: string[];
  sentence: string;
  distractors?: string[];
  excludedWords?: string[];
}

export interface BankValidatedCandidate {
  ok: true;
  senseId: string;
  skill: BankSkill;
  sentenceBefore: string;
  targetSurface: string;
  sentenceAfter: string;
  sentenceHash: string;
  canonicalAnswer: string;
  fixedDistractors: string[];
  posBucket: string;
  excludedWords: string[];
}

export type BankValidationResult =
  BankValidatedCandidate | { ok: false; reason: string };

const VOWEL_BY_KANA = new Map<string, string>();
for (const [vowel, chars] of [
  ['a', 'あかさたなはまやらわがざだばぱぁゃ'],
  ['i', 'いきしちにひみりぎじぢびぴぃ'],
  ['u', 'うくすつぬふむゆるぐずづぶぷぅゅ'],
  ['e', 'えけせてねへめれげぜでべぺぇ'],
  ['o', 'おこそとのほもよろをごぞどぼぽぉょ'],
] as const) {
  for (const ch of chars) VOWEL_BY_KANA.set(ch, vowel);
}

/** Fold equivalent Japanese long-vowel spellings so せんせい / せんせえ / せんせー collide. */
export function longVowelKey(text: string): string {
  const hira = Array.from(readingKey(text));
  const out: string[] = [];
  for (const ch of hira) {
    const prev = out[out.length - 1];
    const prevVowel = prev ? VOWEL_BY_KANA.get(prev) : undefined;
    if (ch === 'ー' && prevVowel) {
      out.push('ː');
      continue;
    }
    if (prevVowel === 'o' && (ch === 'う' || ch === 'お')) {
      out.push('ː');
      continue;
    }
    if (prevVowel === 'e' && (ch === 'い' || ch === 'え')) {
      out.push('ː');
      continue;
    }
    if (
      (prevVowel === 'a' && ch === 'あ') ||
      (prevVowel === 'i' && ch === 'い') ||
      (prevVowel === 'u' && ch === 'う')
    ) {
      out.push('ː');
      continue;
    }
    out.push(ch);
  }
  return out.join('');
}

export function editDistance(a: string, b: string): number {
  const xs = Array.from(a);
  const ys = Array.from(b);
  const dp = Array.from({ length: xs.length + 1 }, (_, i) => i);
  for (let j = 1; j <= ys.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= xs.length; i++) {
      const temp = dp[i];
      dp[i] =
        xs[i - 1] === ys[j - 1] ? prev : 1 + Math.min(prev, dp[i - 1], dp[i]);
      prev = temp;
    }
  }
  return dp[xs.length];
}

export function hasBadControlChars(text: string): boolean {
  if (text.includes('\uFFFD')) return true;
  for (const ch of Array.from(text)) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

export function derivePosBucket(
  languageCode: string | undefined,
  pos: string | null | undefined,
  attributes?: unknown,
  lemma?: string,
): string {
  const lang = languageCode === 'ja' ? 'ja' : 'en';
  const normalizedPos = textKey(pos ?? 'unknown') || 'unknown';
  if (lang === 'ja' && normalizedPos === 'adjective') {
    const rawJson = JSON.stringify(attributes ?? {}).toLowerCase();
    if (rawJson.includes('adj-na')) return 'ja:adj-na';
    if (rawJson.includes('adj-i') || rawJson.includes('adj-ix')) {
      return 'ja:adj-i';
    }
    const cleanLemma = (lemma ?? '').normalize('NFKC').trim();
    return cleanLemma.endsWith('い') ? 'ja:adj-i' : 'ja:adj-na';
  }
  return `${lang}:${normalizedPos}`;
}

export function toQuestionSegments(row: {
  skill: string;
  sentenceBefore: string;
  targetSurface: string;
  sentenceAfter: string;
}): QuizSentenceSegments {
  return {
    before: row.sentenceBefore,
    highlight: row.skill === 'context_cloze' ? null : row.targetSurface,
    after: row.sentenceAfter,
  };
}

export function validateBankCandidate(
  input: BankCandidateInput,
): BankValidationResult {
  const {
    senseId,
    languageCode,
    skill,
    lemma,
    pos,
    attributes,
    written,
    reading,
    knownReadings = [],
    knownWritings = [],
    sentence,
    distractors = [],
    excludedWords = [],
  } = input;

  if (!(BANK_SKILLS as readonly string[]).includes(skill)) {
    return { ok: false, reason: 'unsupported_skill' };
  }
  const rawSentence = (sentence ?? '').normalize('NFKC').trim();
  if (!rawSentence || hasBadControlChars(rawSentence)) {
    return { ok: false, reason: 'invalid_chars' };
  }

  const expectedMarkerTarget = (
    skill === 'kanji_reading' || skill === 'kanji_orthography'
      ? (written ?? '')
      : (lemma ?? '')
  )
    .normalize('NFKC')
    .trim();

  if (!expectedMarkerTarget) {
    return { ok: false, reason: 'missing_target' };
  }

  const marker = `【${expectedMarkerTarget}】`;
  const parts = rawSentence.split(marker);
  if (parts.length !== 2) {
    return { ok: false, reason: 'marker_mismatch' };
  }
  const [sentenceBefore, sentenceAfter] = parts;
  if (
    sentenceBefore.includes('【') ||
    sentenceBefore.includes('】') ||
    sentenceAfter.includes('【') ||
    sentenceAfter.includes('】')
  ) {
    return { ok: false, reason: 'stray_brackets' };
  }

  const cleanFull = `${sentenceBefore}${expectedMarkerTarget}${sentenceAfter}`;
  const charLen = Array.from(cleanFull).length;
  if (charLen < 6 || charLen > 240) {
    return { ok: false, reason: 'sentence_length' };
  }

  const outsideRaw = `${sentenceBefore} ${sentenceAfter}`;
  const outsideNorm = textKey(outsideRaw);
  if (skill === 'context_cloze') {
    const targetNorm = textKey(expectedMarkerTarget);
    const escaped = targetNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const leaked =
      languageCode === 'en'
        ? new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(
            outsideNorm,
          )
        : outsideNorm.includes(targetNorm);
    if (leaked) return { ok: false, reason: 'target_leaked' };
  }
  if (skill === 'kanji_orthography') {
    const allWritings = [expectedMarkerTarget, ...knownWritings]
      .map((w) => textKey(w))
      .filter(Boolean);
    if (allWritings.some((w) => outsideNorm.includes(w))) {
      return { ok: false, reason: 'target_leaked' };
    }
  }
  if (skill === 'kanji_reading') {
    if (/[A-Za-z]/.test(outsideRaw)) {
      return { ok: false, reason: 'target_leaked' };
    }
    const allReadings = [reading ?? '', ...knownReadings]
      .map((r) => readingKey(r))
      .filter((r) => Array.from(r).length >= 2);
    const outsideReading = readingKey(outsideRaw);
    if (allReadings.some((r) => outsideReading.includes(r))) {
      return { ok: false, reason: 'target_leaked' };
    }
  }

  if (
    skill === 'context_cloze' &&
    languageCode === 'en' &&
    /(?:^|\s)an?\s+$/i.test(sentenceBefore)
  ) {
    return { ok: false, reason: 'en_article_leak' };
  }

  const posBucket = derivePosBucket(languageCode, pos, attributes, lemma);
  const sentenceHash = fingerprint(cleanFull);

  if (skill === 'context_cloze') {
    const lemmaKey = textKey(expectedMarkerTarget);
    const cleanedExcluded = [
      ...new Set(
        excludedWords
          .map((w) => textKey(w))
          .filter(
            (w) =>
              w.length > 0 &&
              w.length <= 64 &&
              w !== lemmaKey &&
              !hasBadControlChars(w),
          ),
      ),
    ].slice(0, 20);
    return {
      ok: true,
      senseId,
      skill,
      sentenceBefore,
      targetSurface: expectedMarkerTarget,
      sentenceAfter,
      sentenceHash,
      canonicalAnswer: expectedMarkerTarget,
      fixedDistractors: [],
      posBucket,
      excludedWords: cleanedExcluded,
    };
  }

  if (skill === 'context_meaning') {
    return {
      ok: true,
      senseId,
      skill,
      sentenceBefore,
      targetSurface: expectedMarkerTarget,
      sentenceAfter,
      sentenceHash,
      canonicalAnswer: expectedMarkerTarget,
      fixedDistractors: [],
      posBucket,
      excludedWords: [],
    };
  }

  const canonicalReading = (reading ?? '').normalize('NFKC').trim();
  if (!/\p{Script=Han}/u.test(expectedMarkerTarget) || !canonicalReading) {
    return { ok: false, reason: 'ineligible_kanji_pair' };
  }

  if (!Array.isArray(distractors) || distractors.length !== 3) {
    return { ok: false, reason: `invalid_${skill}_distractors` };
  }

  if (skill === 'kanji_reading') {
    const blockedPhonetic = new Set(
      [canonicalReading, ...knownReadings].map((r) => longVowelKey(r)),
    );
    const blockedReading = new Set(
      [canonicalReading, ...knownReadings].map((r) => readingKey(r)),
    );
    const baseKey = readingKey(canonicalReading);
    const baseLen = Array.from(baseKey).length;
    const normalized: string[] = [];

    for (const raw of distractors) {
      const d = (raw ?? '').normalize('NFKC').trim();
      if (
        !d ||
        hasBadControlChars(d) ||
        !/^[\u3041-\u3096\u30a1-\u30faー]+$/u.test(d)
      ) {
        return { ok: false, reason: 'invalid_reading_distractors' };
      }
      const rk = readingKey(d);
      const pk = longVowelKey(d);
      if (
        blockedReading.has(rk) ||
        blockedPhonetic.has(pk) ||
        Math.abs(Array.from(rk).length - baseLen) > 2 ||
        editDistance(rk, baseKey) > 2
      ) {
        return { ok: false, reason: 'invalid_reading_distractors' };
      }
      blockedReading.add(rk);
      blockedPhonetic.add(pk);
      normalized.push(d);
    }

    return {
      ok: true,
      senseId,
      skill,
      sentenceBefore,
      targetSurface: expectedMarkerTarget,
      sentenceAfter,
      sentenceHash,
      canonicalAnswer: canonicalReading,
      fixedDistractors: normalized,
      posBucket,
      excludedWords: [],
    };
  }

  const blockedWritten = new Set(
    [expectedMarkerTarget, ...knownWritings].map((w) => textKey(w)),
  );
  const baseWrittenLen = Array.from(expectedMarkerTarget).length;
  const maxOrthoDist = baseWrittenLen <= 2 ? 1 : 2;
  const normalizedOrtho: string[] = [];

  for (const raw of distractors) {
    const d = (raw ?? '').normalize('NFKC').trim();
    const dk = textKey(d);
    if (
      !d ||
      hasBadControlChars(d) ||
      !/\p{Script=Han}/u.test(d) ||
      !/^[\p{Script=Han}\u3041-\u3096\u30a1-\u30faー々〆ヶ]+$/u.test(d) ||
      blockedWritten.has(dk) ||
      (d.includes(expectedMarkerTarget) && d !== expectedMarkerTarget) ||
      Math.abs(Array.from(d).length - baseWrittenLen) > 1 ||
      editDistance(d, expectedMarkerTarget) > maxOrthoDist
    ) {
      return { ok: false, reason: 'invalid_orthography_distractors' };
    }
    blockedWritten.add(dk);
    normalizedOrtho.push(d);
  }

  return {
    ok: true,
    senseId,
    skill,
    sentenceBefore,
    targetSurface: canonicalReading,
    sentenceAfter,
    sentenceHash,
    canonicalAnswer: expectedMarkerTarget,
    fixedDistractors: normalizedOrtho,
    posBucket,
    excludedWords: [],
  };
}
