import { createHash } from 'node:crypto';

export const RUBRIC_VERSION = 'm11.5-v1';

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

export function textKey(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

export function readingKey(text) {
  return textKey(text).replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

const VOWEL_BY_KANA = new Map();
for (const [vowel, chars] of [
  ['a', 'あかさたなはまやらわがざだばぱぁゃ'],
  ['i', 'いきしちにひみりぎじぢびぴぃ'],
  ['u', 'うくすつぬふむゆるぐずづぶぷぅゅ'],
  ['e', 'えけせてねへめれげぜでべぺぇ'],
  ['o', 'おこそとのほもよろをごぞどぼぽぉょ'],
]) {
  for (const ch of chars) VOWEL_BY_KANA.set(ch, vowel);
}

/** Fold equivalent Japanese long-vowel notations (おう/おお/おー, えい/ええ/えー, etc.). */
export function longVowelKey(text) {
  const hira = Array.from(readingKey(text));
  const out = [];
  for (let i = 0; i < hira.length; i++) {
    const ch = hira[i];
    const prev = out[out.length - 1];
    const prevVowel = prev ? VOWEL_BY_KANA.get(prev) : null;
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

export function editDistance(a, b) {
  const xs = Array.from(a);
  const ys = Array.from(b);
  const dp = Array.from({ length: xs.length + 1 }, (_, i) => i);
  for (let j = 1; j <= ys.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= xs.length; i++) {
      const temp = dp[i];
      dp[i] =
        xs[i - 1] === ys[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[i - 1], dp[i]);
      prev = temp;
    }
  }
  return dp[xs.length];
}

export function hasBadControlChars(text) {
  const s = String(text ?? '');
  if (s.includes('\uFFFD')) return true;
  for (const ch of Array.from(s)) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

export function derivePosBucket(languageCode, pos, attributes = {}, lemma = '') {
  const lang = languageCode === 'ja' ? 'ja' : 'en';
  const normalizedPos = textKey(pos || 'unknown') || 'unknown';
  if (lang === 'ja' && normalizedPos === 'adjective') {
    const rawJson = JSON.stringify(attributes ?? {}).toLowerCase();
    if (rawJson.includes('adj-na')) return 'ja:adj-na';
    if (rawJson.includes('adj-i') || rawJson.includes('adj-ix')) return 'ja:adj-i';
    const cleanLemma = String(lemma ?? '').normalize('NFKC').trim();
    return cleanLemma.endsWith('い') ? 'ja:adj-i' : 'ja:adj-na';
  }
  return `${lang}:${normalizedPos}`;
}

export function toQuestionSegments(row) {
  return {
    before: row.sentenceBefore,
    highlight: row.skill === 'context_cloze' ? null : row.targetSurface,
    after: row.sentenceAfter,
  };
}

export function validateBankCandidate(input) {
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

  if (!['context_cloze', 'context_meaning', 'kanji_reading', 'kanji_orthography'].includes(skill)) {
    return { ok: false, reason: 'unsupported_skill' };
  }
  const rawSentence = String(sentence ?? '').normalize('NFKC').trim();
  if (!rawSentence || hasBadControlChars(rawSentence)) {
    return { ok: false, reason: 'invalid_chars' };
  }

  const expectedMarkerTarget =
    skill === 'kanji_reading' || skill === 'kanji_orthography'
      ? String(written ?? '').normalize('NFKC').trim()
      : String(lemma ?? '').normalize('NFKC').trim();

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
        ? new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(outsideNorm)
        : outsideNorm.includes(targetNorm);
    if (leaked) return { ok: false, reason: 'target_leaked' };
  }
  if (skill === 'kanji_orthography') {
    const allWritings = [expectedMarkerTarget, ...(Array.isArray(knownWritings) ? knownWritings : [])]
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
    const allReadings = [
      String(reading ?? ''),
      ...(Array.isArray(knownReadings) ? knownReadings : []),
    ]
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
  const sentenceHash = sha256(cleanFull);

  if (skill === 'context_cloze') {
    const lemmaKey = textKey(expectedMarkerTarget);
    const cleanedExcluded = [
      ...new Set(
        (Array.isArray(excludedWords) ? excludedWords : [])
          .map((w) => textKey(w))
          .filter((w) => w.length > 0 && w.length <= 64 && w !== lemmaKey && !hasBadControlChars(w)),
      ),
    ].slice(0, 20);
    return {
      ok: true,
      senseId: String(senseId),
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
      senseId: String(senseId),
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

  const canonicalReading = String(reading ?? '').normalize('NFKC').trim();
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
    const normalized = [];

    for (const raw of distractors) {
      const d = String(raw ?? '').normalize('NFKC').trim();
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
      senseId: String(senseId),
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

  // kanji_orthography
  const blockedWritten = new Set(
    [expectedMarkerTarget, ...knownWritings].map((w) => textKey(w)),
  );
  const baseWrittenLen = Array.from(expectedMarkerTarget).length;
  const maxOrthoDist = baseWrittenLen <= 2 ? 1 : 2;
  const normalizedOrtho = [];

  for (const raw of distractors) {
    const d = String(raw ?? '').normalize('NFKC').trim();
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
    senseId: String(senseId),
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
