export const CANONICAL_POS_VALUES = [
  'adjective',
  'adverb',
  'auxiliary',
  'conjunction',
  'counter',
  'determiner',
  'expression',
  'interjection',
  'noun',
  'particle',
  'prefix',
  'pronoun',
  'suffix',
  'unknown',
  'verb',
] as const;

export type CanonicalPos = (typeof CANONICAL_POS_VALUES)[number];

const POS_ALIAS_MAP: ReadonlyMap<string, CanonicalPos> = new Map<
  string,
  CanonicalPos
>([
  // noun
  ['noun', 'noun'],
  ['n', 'noun'],
  ['danh tu', 'noun'],
  ['danh từ', 'noun'],
  ['dt', 'noun'],
  ['名詞', 'noun'],
  ['n-adv', 'noun'],
  ['n-t', 'noun'],
  ['n-pref', 'noun'],
  ['n-suf', 'noun'],
  ['vs', 'noun'],
  ['pn', 'noun'],

  // verb
  ['verb', 'verb'],
  ['v', 'verb'],
  ['vi', 'verb'],
  ['vt', 'verb'],
  ['dong tu', 'verb'],
  ['động từ', 'verb'],
  ['đt', 'verb'],
  ['動詞', 'verb'],
  ['v1', 'verb'],
  ['v5', 'verb'],
  ['v5r', 'verb'],
  ['v5u', 'verb'],
  ['v5k', 'verb'],
  ['v5s', 'verb'],
  ['v5t', 'verb'],
  ['v5m', 'verb'],
  ['v5n', 'verb'],
  ['v5b', 'verb'],
  ['v5g', 'verb'],
  ['vs-i', 'verb'],
  ['vs-s', 'verb'],
  ['vk', 'verb'],
  ['vn', 'verb'],

  // adjective
  ['adjective', 'adjective'],
  ['adj', 'adjective'],
  ['a', 'adjective'],
  ['adj-i', 'adjective'],
  ['adj-na', 'adjective'],
  ['adj-no', 'adjective'],
  ['adj-pn', 'adjective'],
  ['adj-t', 'adjective'],
  ['adj-f', 'adjective'],
  ['tinh tu', 'adjective'],
  ['tính từ', 'adjective'],
  ['tt', 'adjective'],
  ['形容詞', 'adjective'],
  ['形容動詞', 'adjective'],
  ['連体詞', 'adjective'],

  // adverb
  ['adverb', 'adverb'],
  ['adv', 'adverb'],
  ['adv-to', 'adverb'],
  ['trang tu', 'adverb'],
  ['trạng từ', 'adverb'],
  ['pho tu', 'adverb'],
  ['phó từ', 'adverb'],
  ['副詞', 'adverb'],

  // pronoun
  ['pronoun', 'pronoun'],
  ['pron', 'pronoun'],
  ['dai tu', 'pronoun'],
  ['đại từ', 'pronoun'],
  ['代名詞', 'pronoun'],

  // conjunction
  ['conjunction', 'conjunction'],
  ['conj', 'conjunction'],
  ['lien tu', 'conjunction'],
  ['liên từ', 'conjunction'],
  ['接続詞', 'conjunction'],

  // interjection
  ['interjection', 'interjection'],
  ['int', 'interjection'],
  ['intj', 'interjection'],
  ['than tu', 'interjection'],
  ['thán từ', 'interjection'],
  ['感動詞', 'interjection'],

  // auxiliary
  ['auxiliary', 'auxiliary'],
  ['aux', 'auxiliary'],
  ['aux-v', 'auxiliary'],
  ['aux-adj', 'auxiliary'],
  ['tro dong tu', 'auxiliary'],
  ['trợ động từ', 'auxiliary'],
  ['助動詞', 'auxiliary'],

  // particle
  ['particle', 'particle'],
  ['part', 'particle'],
  ['prt', 'particle'],
  ['tro tu', 'particle'],
  ['trợ từ', 'particle'],
  ['助詞', 'particle'],

  // counter
  ['counter', 'counter'],
  ['ctr', 'counter'],
  ['luong tu', 'counter'],
  ['lượng từ', 'counter'],
  ['助数詞', 'counter'],

  // determiner
  ['determiner', 'determiner'],
  ['det', 'determiner'],
  ['han dinh tu', 'determiner'],
  ['hạn định từ', 'determiner'],

  // expression
  ['expression', 'expression'],
  ['exp', 'expression'],
  ['expr', 'expression'],
  ['phrase', 'expression'],
  ['idiom', 'expression'],
  ['cum tu', 'expression'],
  ['cụm từ', 'expression'],
  ['thanh ngu', 'expression'],
  ['thành ngữ', 'expression'],
  ['表現', 'expression'],

  // prefix
  ['prefix', 'prefix'],
  ['pref', 'prefix'],
  ['tien to', 'prefix'],
  ['tiền tố', 'prefix'],
  ['接頭辞', 'prefix'],

  // suffix
  ['suffix', 'suffix'],
  ['suf', 'suffix'],
  ['hau to', 'suffix'],
  ['hậu tố', 'suffix'],
  ['接尾辞', 'suffix'],

  // unknown
  ['unknown', 'unknown'],
]);

const SUPPORTED_SOURCE_TYPES = new Set([
  '',
  'word',
  'vocab',
  'vocabulary',
  'từ vựng',
  'tu vung',
]);

const KANA_ONLY_PATTERN = /^[\u3040-\u309F\u30A0-\u30FFー・\s]+$/;
const INLINE_BRACKET_SUFFIX_PATTERN =
  /^(.+?)\s*[（([【]([^）)\]】]{1,40})[）)\]】]$/;

export interface ExtractedWordMetadata {
  word: string;
  inlinePos: CanonicalPos | null;
  inlineReading: string | null;
}

/** Chuẩn hóa mặt chữ: NFKC + trim + gom khoảng trắng. */
export function normalizeImportWord(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/**
 * Tách thông minh mặt chữ có đính kèm từ loại hoặc cách đọc kana trong ngoặc ở cuối
 * (vd `"bank (n)"` -> `word="bank", inlinePos="noun"`;
 * `"性質（せいしつ）"` -> `word="性質", inlineReading="せいしつ"`).
 */
export function extractInlineWordMetadata(raw: string): ExtractedWordMetadata {
  const normalized = normalizeImportWord(raw);
  const match = INLINE_BRACKET_SUFFIX_PATTERN.exec(normalized);
  if (!match) {
    return { word: normalized, inlinePos: null, inlineReading: null };
  }
  const head = match[1].trim();
  const inner = match[2].trim();
  if (!head || !inner) {
    return { word: normalized, inlinePos: null, inlineReading: null };
  }

  const parsedPos = normalizeImportPos(inner);
  if (parsedPos !== null) {
    return { word: head, inlinePos: parsedPos, inlineReading: null };
  }

  if (isKanaOnly(inner) && !isKanaOnly(head)) {
    return { word: head, inlinePos: null, inlineReading: inner };
  }

  return { word: normalized, inlinePos: null, inlineReading: null };
}

/** Kiểm tra `source_type` (vd cột Type của Mazii) có phải từ vựng không. */
export function isSupportedImportSourceType(raw?: string | null): boolean {
  if (raw === undefined || raw === null) return true;
  const normalized = raw.normalize('NFKC').trim().toLowerCase();
  return SUPPORTED_SOURCE_TYPES.has(normalized);
}

/**
 * Ánh xạ từ loại nhập tự do (EN/VI/JA, viết tắt) về 15 giá trị chuẩn
 * của `core.lexeme.pos`. Trả `null` nếu không nhận diện được (sẽ fallback theo mặt chữ).
 */
export function normalizeImportPos(raw?: string | null): CanonicalPos | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^[([{]+|[)\]}]+$/g, '')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return POS_ALIAS_MAP.get(cleaned) ?? null;
}

/**
 * Tách chuỗi cách đọc (hỗ trợ nhiều cách đọc như Mazii `"ささえる つかえる"`)
 * và chuẩn hóa về Hiragana để so khớp không lệ thuộc Hiragana/Katakana.
 */
export function normalizeImportReadings(raw?: string | null): string[] {
  if (raw === undefined || raw === null) return [];
  const normalized = raw.normalize('NFKC').trim();
  if (!normalized) return [];
  const tokens = normalized
    .split(/[\s,;/・、|]+/)
    .map((token) => normalizeKanaKey(token))
    .filter((token) => token.length > 0);
  return [...new Set(tokens)];
}

/**
 * Chuẩn hóa một chuỗi kana (Hiragana/Katakana) về khóa Hiragana (giữ nguyên dấu trường âm `ー`)
 * để `チャーハン` và `ちゃーはん` luôn khớp nhau.
 */
export function normalizeKanaKey(raw: string): string {
  const trimmed = raw.normalize('NFKC').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/[\u30A1-\u30F6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60),
    )
    .toLowerCase();
}

/**
 * Quy đổi chuỗi kana về dạng Katakana (giữ dấu `ー`) để tra B-tree index `lexeme.reading`
 * cho cả các mục từ lưu reading bằng Katakana (như `炒飯` -> `チャーハン`).
 */
export function toKatakanaKey(raw: string): string {
  const trimmed = raw.normalize('NFKC').trim();
  if (!trimmed) return '';
  return trimmed.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60),
  );
}

/** Kiểm tra chuỗi chỉ gồm Hiragana/Katakana (để chạy thêm nhánh `lexeme.reading`). */
export function isKanaOnly(word: string): boolean {
  return word.length > 0 && KANA_ONLY_PATTERN.test(word);
}
