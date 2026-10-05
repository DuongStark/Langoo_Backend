import path from 'node:path';
import { readText } from './_shared';
import {
  extractNameEn,
  fuseRadicals,
  parseCjkRadicals,
  parseEnExtracts,
  parseUnihanStrokes,
  parseViRadicals,
} from './radicals';

/**
 * Self-test cho parser DB3 (không cần DB, chạy: `npx tsx scripts/db3/selftest.ts`).
 * Fixtures là trích đoạn thật từ 4 nguồn cho bộ 1 / 24 / 85 / 214.
 */

const FIXTURES = path.resolve(__dirname, 'fixtures', 'radicals');
let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  );
}

const cjk = parseCjkRadicals(readText(path.join(FIXTURES, 'CJKRadicals.txt')));
eq('cjk: đọc đủ 4 bộ mẫu', cjk.size, 4);
eq('cjk: bộ 85 → unified 6C34', cjk.get(85)?.unifiedCodePoint, '6C34');
eq('cjk: bộ 214 → unified 9FA0', cjk.get(214)?.unifiedCodePoint, '9FA0');

const vi = parseViRadicals(
  readText(path.join(FIXTURES, 'vi-kangxi-radicals.wikitext')),
);
eq('vi.wiki: đọc đủ 4 bộ mẫu', vi.size, 4);
eq(
  'vi.wiki: bộ 85 (chữ/biến thể/tên/nghĩa)',
  {
    character: vi.get(85)?.character,
    variants: vi.get(85)?.variants,
    nameVi: vi.get(85)?.nameVi,
    meaningVi: vi.get(85)?.meaningVi,
  },
  {
    character: '水',
    variants: ['氺', '氵'],
    nameVi: 'Thủy',
    meaningVi: 'Nước',
  },
);

const strokes = parseUnihanStrokes(
  readText(path.join(FIXTURES, 'unihan-kTotalStrokes.tsv')),
);
eq('unihan: 水 = 4 nét', strokes.get('6C34'), 4);
eq('unihan: 一 = 1 nét', strokes.get('4E00'), 1);

const en = parseEnExtracts(
  readText(path.join(FIXTURES, 'en-radicals-extracts.json')),
);
eq('en.wiki: đọc đủ 4 extract', en.size, 4);
eq('en.wiki: Radical 1 → "one"', extractNameEn(en.get(1) ?? ''), 'one');
eq('en.wiki: Radical 85 → "water"', extractNameEn(en.get(85) ?? ''), 'water');
eq('en.wiki: Radical 214 → "flute"', extractNameEn(en.get(214) ?? ''), 'flute');
eq(
  'en.wiki: Radical 24 fallback "or radical ten (" → "ten"',
  extractNameEn(en.get(24) ?? ''),
  'ten',
);

const fused = fuseRadicals({ cjk, vi, strokes, en });
eq('fuse: 4 dòng từ fixture', fused.rows.length, 4);
const row85 = fused.rows.find((row) => row.number === 85);
eq(
  'fuse: bộ 85 đủ trường',
  {
    character: row85?.character,
    variants: row85?.variants,
    nameVi: row85?.nameVi,
    meaningVi: row85?.meaningVi,
    nameEn: row85?.nameEn,
    strokeCount: row85?.strokeCount,
  },
  {
    character: '水',
    variants: ['氺', '氵'],
    nameVi: 'Thủy',
    meaningVi: 'Nước',
    nameEn: 'water',
    strokeCount: 4,
  },
);
check(
  'fuse: cảnh báo fixture chưa đủ 214 bộ',
  fused.warnings.some((warning) => warning.includes('4/214')),
  fused.warnings.join(' | ').slice(0, 160),
);

const tricky = parseViRadicals(
  "|43\n|<big>尢, 兀 (尣)</big>\n|'''Uông'''\n|wù\n|x\n|y\n|Nghĩa\n|-\n",
);
eq('vi.wiki: dạng "A, B (C)" tách đúng', tricky.get(43), {
  number: 43,
  character: '尢',
  variants: ['兀', '尣'],
  nameVi: 'Uông',
  meaningVi: 'Nghĩa',
});
const refForm = parseViRadicals(
  '|73\n|<big>曰{{#tag:ref|Dễ nhầm với bộ "nhật" (日)|group=c}}</big>\n' +
    "|'''Viết'''\n|x\n|y\n|z\n|Viết\n|-\n",
);
eq('vi.wiki: bỏ {{#tag:ref}} trong ô chữ', refForm.get(73)?.character, '曰');
const commaForm = parseViRadicals(
  "|58\n|<big>⼹, ⺕, 彐<br>彑</big>\n|'''Ký/Kệ'''\n|x\n|y\n|z\n|Đầu heo\n|-\n",
);
eq(
  'vi.wiki: dạng "A, B C" (br → space) tách đúng',
  {
    character: commaForm.get(58)?.character,
    variants: commaForm.get(58)?.variants,
  },
  { character: '⼹', variants: ['⺕', '彐', '彑'] },
);

const sided = parseViRadicals(
  "|163\n|<big>邑 (~阝)</big>\n|'''Ấp'''\n|x\n|y\n|z\n|Vùng đất\n|-\n" +
    "|170\n|<big>阜 (阝~)</big>\n|'''Phụ'''\n|x\n|y\n|z\n|Gò đất\n|-\n",
);
eq(
  'vi.wiki: marker vị trí ~ không thuộc glyph bộ 163',
  sided.get(163)?.variants,
  ['阝'],
);
eq(
  'vi.wiki: marker vị trí ~ không thuộc glyph bộ 170',
  sided.get(170)?.variants,
  ['阝'],
);

if (failures > 0) {
  console.error(`\nselftest: ${failures} test FAIL`);
  process.exit(1);
}
console.log('\nselftest: OK');
