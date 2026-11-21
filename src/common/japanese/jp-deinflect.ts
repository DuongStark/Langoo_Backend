/**
 * M4.9 — Đưa từ tiếng Nhật đã chia thể về các dạng gốc ứng viên (deinflection).
 *
 * Dùng chung cho:
 * - Tra từ điển (`GET /v1/dictionary/search`, `GET /v1/dictionary/suggestions`)
 * - Auto Import List M5.3 (`POST /v1/collections/import`, `POST /v1/collections/:id/items/import`)
 *
 * Port từ `LanGoo-User/src/lib/jp-deinflect.ts` và bổ sung:
 * - Bảng B ★: tính từ đuôi な (`親切な` -> `親切`) và tính từ đuôi い dạng く (`細く` -> `細い`, `まぶしく` -> `まぶしい`)
 * - Bảng §4.3: cụm câu nói `してくれ` / `してください` / `してくれる`, `てくれ` / `てください`
 * - Gợi ý `expectedPos` mềm dùng để xếp hạng ưu tiên (không loại cứng).
 */

const ROWS = [
  'あいうえお',
  'かきくけこ',
  'さしすせそ',
  'たちつてと',
  'なにぬねの',
  'はひふへほ',
  'まみむめも',
  'やいゆえよ',
  'らりるれろ',
  'わいうえお',
  'がぎぐげご',
  'ざじずぜぞ',
  'だぢづでど',
  'ばびぶべぼ',
  'ぱぴぷぺぽ',
] as const;

const U_INDEX = 2;
const E_INDEX = 3;
const O_INDEX = 4;

export type DeinflectExpectedPos = 'noun' | 'verb' | 'adjective' | 'adverb';

export interface DeinflectCandidate {
  word: string;
  expectedPos: DeinflectExpectedPos[];
  /**
   * Mức ưu tiên nhóm ứng viên (số nhỏ ưu tiên cao hơn).
   * Các ứng viên cùng 1 tầng (vd `行った` -> `行う`/`行く`, `降ります` -> `降りる`/`降る`)
   * chia sẻ cùng `tier` để tầng gọi so sánh thêm tần suất / lemma vs form / cách đọc,
   * trong khi ứng viên phải bóc thêm 1 lớp từ dạng từ điển hợp lệ (vd `優れた` -> `優れる` [tier 1]
   * -> `優る` [tier 2]) luôn nằm ở tier sau.
   */
  tier: number;
}

function changeDan(char: string, toIndex: number): string | null {
  for (const row of ROWS) {
    const index = row.indexOf(char);
    if (index >= 0) return index === toIndex ? null : row[toIndex];
  }
  return null;
}

function isEDan(stem: string): boolean {
  const last = stem.at(-1);
  if (!last) return false;
  for (const row of ROWS) {
    const index = row.indexOf(last);
    if (index >= 0) return index === E_INDEX;
  }
  return false;
}

function isADan(stem: string): boolean {
  const last = stem.at(-1);
  if (!last) return false;
  for (const row of ROWS) {
    const index = row.indexOf(last);
    if (index >= 0) return index === 0;
  }
  return false;
}

/** Đổi katakana sang hiragana (giữ nguyên chữ Hán và dấu trường âm `ー`). */
export function katakanaToHiragana(text: string): string {
  return text.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60),
  );
}

const HAS_KANA = /[\u3041-\u309f]/;

const IRREGULAR_STEM: Record<string, string[]> = {
  し: ['する'],
  こ: ['くる'],
  き: ['くる', 'きる'],
  来: ['来る'],
};

function uDan(stem: string): string | null {
  const last = stem.at(-1);
  if (!last) return null;
  const converted = changeDan(last, U_INDEX);
  return converted ? stem.slice(0, -1) + converted : null;
}

function baseCandidates(stem: string): string[] {
  const u = uDan(stem);
  if (u && isADan(stem)) return [u, stem + 'る'];
  return [stem + 'る', ...(u ? [u] : [])];
}

function fromMasuStem(stem: string): string[] {
  const irregular = IRREGULAR_STEM[stem];
  if (irregular) return [...irregular, ...baseCandidates(stem)];
  if (stem.endsWith('し') && stem.length > 1) {
    return [stem.slice(0, -1) + 'する', ...baseCandidates(stem)];
  }
  return baseCandidates(stem);
}

function fromNegativeStem(stem: string): string[] {
  const irregular = IRREGULAR_STEM[stem];
  const u = uDan(stem);
  const extra =
    stem.endsWith('し') && stem.length > 1 ? [stem.slice(0, -1) + 'する'] : [];
  // Gốc hàng e (食べない -> 食べる) chỉ thuộc ichidan, không đổi sang hàng u (食ぶ)
  if (isEDan(stem)) {
    const list = [...(irregular ?? []), ...extra, stem + 'る'];
    return [...new Set(list)];
  }
  const head = irregular ?? (u ? [u] : []);
  const rest = baseCandidates(stem).filter(
    (candidate) => !head.includes(candidate) && !extra.includes(candidate),
  );
  return [...head, ...extra, ...rest];
}

/**
 * Thể て / た đơn (không có âm tiện った/いた/いだ/んだ/した):
 * chỉ dành cho động từ nhóm 2 (ichidan: 食べて -> 食べる, 優れた -> 優れる) và bất quy tắc (来て -> 来る).
 * Không đổi sang hàng u vì godan dùng các quy tắc âm tiện riêng.
 */
function fromTeStem(stem: string): string[] {
  const irregular = IRREGULAR_STEM[stem] ?? [];
  const extra =
    stem.endsWith('し') && stem.length > 1 ? [stem.slice(0, -1) + 'する'] : [];
  return [...new Set([...irregular, ...extra, stem + 'る'])];
}

/** Bị động godan (読まれる -> 読む: gốc hàng a) hoặc khả năng godan -る / ra-nuki (走れる -> 走る, 食べれる -> 食べる). */
function fromReru(stem: string): string[] {
  if (isADan(stem)) {
    const u = uDan(stem);
    return u ? [u] : [];
  }
  return [stem + 'る'];
}

/** Sai khiến godan (読ませる -> 読む, 書かせる -> 書く): chỉ hợp lệ sau gốc hàng a. Không biến 見せる -> 見る. */
function fromSeru(stem: string): string[] {
  if (!isADan(stem)) return [];
  const u = uDan(stem);
  return u ? [u] : [];
}

/** Bị động/khả năng hoặc ý chí ichidan/bất quy tắc (見られる -> 見る, 食べよう -> 食べる, 来られる -> 来る). */
function fromIchidanStem(stem: string): string[] {
  const irregular = IRREGULAR_STEM[stem] ?? [];
  return [...new Set([...irregular, stem + 'る'])];
}

/** Sai khiến ichidan/bất quy tắc/suru (食べさせる -> 食べる, 勉強させる -> 勉強する). */
function fromSaseru(stem: string): string[] {
  const irregular = IRREGULAR_STEM[stem] ?? [];
  const list = [...irregular, stem + 'る'];
  if (stem.length >= 1 && !HAS_KANA.test(stem.at(-1) ?? '')) {
    list.push(stem + 'する');
  }
  return [...new Set(list)];
}

/** Điều kiện れば (食べれば -> 食べる, 作れば -> 作る, すれば -> する, くれば -> くる). */
function fromReba(stem: string): string[] {
  if (stem === 'す') return ['する'];
  if (stem === 'く') return ['くる'];
  return [stem + 'る'];
}

function fromConditional(stem: string): string[] {
  const u = uDan(stem);
  return u ? [u, stem + 'る'] : [stem + 'る'];
}

function fromVolitional(stem: string): string[] {
  const last = stem.at(-1);
  if (!last) return [];
  for (const row of ROWS) {
    const index = row.indexOf(last);
    if (index < 0) continue;
    if (index !== O_INDEX) return [];
    const u = uDan(stem);
    return u ? [u, stem + 'る'] : [stem + 'る'];
  }
  return [];
}

const fromTta = (stem: string): string[] => [
  stem + 'う',
  stem + 'つ',
  stem + 'る',
  stem + 'く',
];
const fromIta = (stem: string): string[] => [stem + 'く', stem + 'いる'];
const fromIda = (stem: string): string[] => [stem + 'ぐ'];
const fromNda = (stem: string): string[] => [
  stem + 'む',
  stem + 'ぶ',
  stem + 'ぬ',
];
const fromShita = (stem: string): string[] =>
  stem ? [stem + 'す', ...(stem.length >= 1 ? [stem + 'する'] : [])] : ['する'];

interface Rule {
  from: string;
  to: (stem: string) => string[];
  expectedPos: DeinflectExpectedPos[];
  /** true với các quy tắc đuôi nhạy cảm hoặc đã là thể từ điển (な, く, れる, せる, てる...) để không đánh nhầm `isTerminal`. */
  isSoftSuffix?: boolean;
  /**
   * Mức ưu tiên của quy tắc (mặc định 0 = chuẩn).
   * - 1: dạng rút gọn khẩu ngữ dễ trùng động từ gốc (vd `てた` rút gọn của `ていた`: `捨てた`/`当てた` ưu tiên `捨てる`/`当てる` trước `捨る`/`当る`).
   * - 2: hậu tố ưu tiên thấp (vd §4.3 cụm câu nói `してくれ`), chỉ dùng khi các quy tắc chính trượt.
   */
  priority?: number;
}

const RULES: Rule[] = [
  // Cụm câu nói có する / て ở giữa (§4.3 — ưu tiên thấp)
  {
    from: 'してください',
    to: (s) => (s.length >= 1 ? [s, s + 'する'] : []),
    expectedPos: ['noun', 'verb'],
    priority: 2,
  },
  {
    from: 'してくれる',
    to: (s) => (s.length >= 1 ? [s, s + 'する'] : []),
    expectedPos: ['noun', 'verb'],
    priority: 2,
  },
  {
    from: 'してくれ',
    to: (s) => (s.length >= 1 ? [s, s + 'する'] : []),
    expectedPos: ['noun', 'verb'],
    priority: 2,
  },
  {
    from: 'てください',
    to: (s) => (s.length >= 1 ? [s + 'て'] : []),
    expectedPos: ['verb'],
    priority: 2,
  },
  {
    from: 'てくれ',
    to: (s) => (s.length >= 1 ? [s + 'て'] : []),
    expectedPos: ['verb'],
    priority: 2,
  },

  // Thể lịch sự
  { from: 'ませんでした', to: (s) => [s + 'ません'], expectedPos: ['verb'] },
  { from: 'ましょう', to: (s) => [s + 'ます'], expectedPos: ['verb'] },
  { from: 'ました', to: (s) => [s + 'ます'], expectedPos: ['verb'] },
  { from: 'ません', to: (s) => [s + 'ます'], expectedPos: ['verb'] },
  { from: 'ます', to: fromMasuStem, expectedPos: ['verb'] },

  // Thể phủ định
  { from: 'なかった', to: (s) => [s + 'ない'], expectedPos: ['verb'] },
  { from: 'なくて', to: (s) => [s + 'ない'], expectedPos: ['verb'] },
  { from: 'なければ', to: (s) => [s + 'ない'], expectedPos: ['verb'] },
  { from: 'なきゃ', to: (s) => [s + 'ない'], expectedPos: ['verb'] },
  { from: 'ない', to: fromNegativeStem, expectedPos: ['verb'] },

  // Thể て / quá khứ (âm tiện)
  { from: 'ったら', to: fromTta, expectedPos: ['verb'] },
  { from: 'って', to: fromTta, expectedPos: ['verb'] },
  { from: 'った', to: fromTta, expectedPos: ['verb'] },
  { from: 'いたら', to: fromIta, expectedPos: ['verb'] },
  { from: 'いて', to: fromIta, expectedPos: ['verb'] },
  { from: 'いた', to: fromIta, expectedPos: ['verb'] },
  { from: 'いで', to: fromIda, expectedPos: ['verb'] },
  { from: 'いだ', to: fromIda, expectedPos: ['verb'] },
  { from: 'んで', to: fromNda, expectedPos: ['verb'] },
  { from: 'んだ', to: fromNda, expectedPos: ['verb'] },
  { from: 'して', to: fromShita, expectedPos: ['verb'] },
  { from: 'した', to: fromShita, expectedPos: ['verb'] },
  { from: 'て', to: fromTeStem, expectedPos: ['verb'] },
  { from: 'た', to: fromTeStem, expectedPos: ['verb'] },
  { from: 'で', to: fromTeStem, expectedPos: ['verb'] },
  { from: 'だ', to: fromTeStem, expectedPos: ['verb'] },

  // Khả năng / bị động / sai khiến
  // Đều kết thúc bằng る (dạng từ điển hợp lệ: 優れる, 生まれる, 見せる, 切れる, 取れる, 売れる...)
  // nên gắn `isSoftSuffix: true` để `isTerminal` không đánh nhầm động từ gốc là "chưa phải thể từ điển".
  {
    from: 'させられる',
    to: (s) => [s + 'させる'],
    expectedPos: ['verb'],
    isSoftSuffix: true,
  },
  {
    from: 'される',
    to: (s) => [s + 'する'],
    expectedPos: ['verb'],
    isSoftSuffix: true,
  },
  {
    from: 'られる',
    to: fromIchidanStem,
    expectedPos: ['verb'],
    isSoftSuffix: true,
  },
  {
    from: 'れる',
    to: fromReru,
    expectedPos: ['verb'],
    isSoftSuffix: true,
  },
  {
    from: 'させる',
    to: fromSaseru,
    expectedPos: ['verb'],
    isSoftSuffix: true,
  },
  {
    from: 'せる',
    to: fromSeru,
    expectedPos: ['verb'],
    isSoftSuffix: true,
  },

  // Điều kiện / ý chí / mệnh lệnh / nhờ vả
  { from: 'ければ', to: (s) => [s + 'い'], expectedPos: ['adjective'] },
  { from: 'れば', to: fromReba, expectedPos: ['verb'] },
  { from: 'ば', to: fromConditional, expectedPos: ['verb'] },
  { from: 'よう', to: fromIchidanStem, expectedPos: ['verb'] },
  { from: 'う', to: fromVolitional, expectedPos: ['verb'] },
  { from: 'なさい', to: (s) => fromMasuStem(s), expectedPos: ['verb'] },
  { from: 'ください', to: (s) => [s + 'て'], expectedPos: ['verb'] },
  { from: 'ろ', to: (s) => [s + 'る'], expectedPos: ['verb'] },

  // Đang/đã làm gì đó (ている) — các đuôi kết thúc る (`ている`/`てる`/`でいる`) gắn `isSoftSuffix: true`
  // để không đánh nhầm động từ gốc kết thúc `てる` (捨てる, 建てる, 慌てる...) là chưa terminal.
  { from: 'ています', to: (s) => [s + 'て'], expectedPos: ['verb'] },
  { from: 'ていた', to: (s) => [s + 'て'], expectedPos: ['verb'] },
  {
    from: 'ている',
    to: (s) => [s + 'て'],
    expectedPos: ['verb'],
    isSoftSuffix: true,
  },
  {
    from: 'てる',
    to: (s) => [s + 'て'],
    expectedPos: ['verb'],
    isSoftSuffix: true,
  },
  {
    from: 'てた',
    to: (s) => [s + 'て'],
    expectedPos: ['verb'],
    priority: 1,
  },
  {
    from: 'でいる',
    to: (s) => [s + 'で'],
    expectedPos: ['verb'],
    isSoftSuffix: true,
  },

  // Tính từ -i và tính từ -na (★ Bảng B mới)
  { from: 'かった', to: (s) => [s + 'い'], expectedPos: ['adjective'] },
  { from: 'くない', to: (s) => [s + 'い'], expectedPos: ['adjective'] },
  { from: 'くて', to: (s) => [s + 'い'], expectedPos: ['adjective'] },
  {
    from: 'く',
    to: (s) => (s.length >= 1 ? [s + 'い'] : []),
    expectedPos: ['adjective'],
    isSoftSuffix: true,
  },
  {
    from: 'な',
    to: (s) => (s.length >= 1 ? [s] : []),
    expectedPos: ['adjective', 'noun'],
    isSoftSuffix: true,
  },

  // Câu lịch sự của danh từ/tính từ (学生です -> 学生)
  {
    from: 'でした',
    to: (s) => (s.length >= 1 ? [s] : []),
    expectedPos: ['noun', 'adjective'],
  },
  {
    from: 'だった',
    to: (s) => (s.length >= 1 ? [s] : []),
    expectedPos: ['noun', 'adjective'],
  },
  {
    from: 'です',
    to: (s) => (s.length >= 1 ? [s] : []),
    expectedPos: ['noun', 'adjective'],
  },
];

/** Từ đã là thể từ điển nếu không còn quy tắc chia động từ/tính từ cứng nào áp được nữa. */
const isTerminal = (word: string) =>
  !RULES.some(
    (rule) =>
      !rule.isSoftSuffix &&
      (rule.priority ?? 0) === 0 &&
      word.length > rule.from.length &&
      word.endsWith(rule.from) &&
      rule.to(word.slice(0, -rule.from.length)).length > 0,
  );

const ROMAJI_SURU =
  /^([a-z]{2,}?)(shimashita|shimasen|shimasu|shinakatta|shinai|shite|shita|suru)$/i;

function withSuruNoun(candidate: DeinflectCandidate): DeinflectCandidate[] {
  if (candidate.word.length > 2 && candidate.word.endsWith('する')) {
    return [
      candidate,
      {
        word: candidate.word.slice(0, -2),
        expectedPos: ['noun', 'adverb'],
        tier: candidate.tier,
      },
    ];
  }
  return [candidate];
}

/**
 * Sinh tối đa `limit` ứng viên dạng gốc tiếng Nhật kèm gợi ý `expectedPos` mềm và `tier` ưu tiên.
 * - Trả `[]` nếu input không có kana (trừ romaji dạng `benkyousuru` -> `benkyou`).
 * - Chỉ nên gọi khi khớp chính xác đã trượt.
 */
export function deinflectJapaneseDetailed(
  input: string,
  limit = 8,
): DeinflectCandidate[] {
  const trimmed = input.normalize('NFKC').trim();
  if (!trimmed) return [];
  const text = katakanaToHiragana(trimmed);

  if (!HAS_KANA.test(text)) {
    const romaji = ROMAJI_SURU.exec(text);
    return romaji ? [{ word: romaji[1], expectedPos: ['noun'], tier: 0 }] : [];
  }

  interface InternalCandidate {
    word: string;
    expectedPos: DeinflectExpectedPos[];
    index: number;
    firstRuleLength: number;
    dictHops: number;
    depth: number;
    lowPriority: number;
  }

  interface FrontierNode {
    word: string;
    lowPriority: number;
    firstRuleLength: number;
    dictHops: number;
  }

  const seen = new Set<string>([text]);
  const results: InternalCandidate[] = [];
  let frontier: FrontierNode[] = [
    { word: text, lowPriority: 0, firstRuleLength: 0, dictHops: 0 },
  ];

  for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
    const next: FrontierNode[] = [];
    for (const node of frontier) {
      // Input gốc (depth === 0) đã trượt khớp chính xác nên bước đầu không tính là "bóc qua 1 dạng từ điển hợp lệ".
      // Từ depth >= 1 trở đi, nếu node đã là dạng từ điển hợp lệ (vd `優れる`, `生まれる`, `捨てる`)
      // mà vẫn tiếp tục bóc sâu hơn (vd `優れる` -> `優る`) thì tăng `dictHops` để luôn xếp sau dạng gốc trực tiếp.
      const stepDictHop = depth > 0 && isTerminal(node.word) ? 1 : 0;
      for (const rule of RULES) {
        if (node.word.length <= rule.from.length) continue;
        if (!node.word.endsWith(rule.from)) continue;
        const stem = node.word.slice(0, -rule.from.length);
        for (const candidate of rule.to(stem)) {
          if (!candidate || seen.has(candidate) || /\s/.test(candidate)) {
            continue;
          }
          // Bỏ ứng viên ngắn hơn 2 ký tự khi input dài hơn
          if (candidate.length < 2 && candidate.length < text.length) continue;
          seen.add(candidate);
          const lowPriority = Math.max(node.lowPriority, rule.priority ?? 0);
          const firstRuleLength =
            depth === 0 ? rule.from.length : node.firstRuleLength;
          const dictHops = node.dictHops + stepDictHop;
          next.push({
            word: candidate,
            lowPriority,
            firstRuleLength,
            dictHops,
          });
          results.push({
            word: candidate,
            expectedPos: rule.expectedPos,
            index: results.length,
            firstRuleLength,
            dictHops,
            depth,
            lowPriority,
          });
        }
      }
    }
    frontier = next;
  }

  const ranked = results
    .map((entry) => ({ ...entry, terminal: isTerminal(entry.word) ? 0 : 1 }))
    .sort(
      (a, b) =>
        a.lowPriority - b.lowPriority ||
        a.terminal - b.terminal ||
        b.firstRuleLength - a.firstRuleLength ||
        a.dictHops - b.dictHops ||
        b.depth - a.depth ||
        a.index - b.index,
    );

  // Gán `tier` tăng dần cho từng cụm (lowPriority, terminal, firstRuleLength, dictHops)
  let nextTier = 1;
  let prevKey: string | null = null;
  let currentTier = 1;
  const sorted: DeinflectCandidate[] = ranked.map((entry) => {
    const key = `${entry.lowPriority}:${entry.terminal}:${entry.firstRuleLength}:${entry.dictHops}`;
    if (prevKey !== key) {
      currentTier = nextTier;
      nextTier += 1;
      prevKey = key;
    }
    return {
      word: entry.word,
      expectedPos: entry.expectedPos,
      tier: currentTier,
    };
  });

  // Danh từ + する từ chính input (応募する -> 応募) luôn đứng đầu tiên ở tier 0
  const directSuru =
    text.length > 2 && text.endsWith('する')
      ? [
          {
            word: text.slice(0, -2),
            expectedPos: ['noun', 'adverb'] as DeinflectExpectedPos[],
            tier: 0,
          },
        ]
      : [];

  const expanded = [...directSuru, ...sorted.flatMap(withSuruNoun)];
  const deduped: DeinflectCandidate[] = [];
  const emitted = new Set<string>([text]);

  for (const item of expanded) {
    if (emitted.has(item.word)) continue;
    if (item.word.length < 2 && item.word.length < text.length) continue;
    emitted.add(item.word);
    deduped.push(item);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

/** Tiện ích chỉ lấy mảng chuỗi dạng gốc ứng viên (giữ đúng thứ tự ưu tiên). */
export function deinflectJapanese(input: string, limit = 8): string[] {
  return deinflectJapaneseDetailed(input, limit).map((c) => c.word);
}
