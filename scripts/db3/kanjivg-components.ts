/**
 * DB3 — import thành phần kanji từ KanjiVG (cây `kvg:element`) vào `core.kanji_component`.
 *
 * Nguồn: KanjiVG — CC BY-SA 3.0, Ulrich Apel (https://kanjivg.tagaini.net/).
 * Mỗi SVG có cây nhóm `<g kvg:element=...>` lồng nhau; `kvg:original` (dạng gốc),
 * `kvg:variant`, `kvg:position`, `kvg:radical`, `kvg:phon`, `kvg:part`;
 * số nét lấy từ id path `kvg:<code>-sN`.
 *
 * Chạy:
 *   tsx scripts/db3/kanjivg-components.ts --svg-dir <dir> [--limit N] [--sample 学]
 *   tsx scripts/db3/kanjivg-components.ts --svg-dir <dir> --apply \
 *       --allow-db <db> [--database-url postgresql://…] [--manifest <file>]
 *
 * Ghi: `core.kanji_component` (idempotent theo kanji: xoá rồi chèn trong transaction).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const SOURCE = {
  code: 'kanjivg',
  name: 'KanjiVG — stroke order diagrams',
  license: 'CC BY-SA 3.0',
  attribution: 'KanjiVG by Ulrich Apel (https://kanjivg.tagaini.net/)',
  url: 'https://github.com/KanjiVG/kanjivg',
};

interface ComponentNode {
  component: string;
  original: string | null;
  is_variant: boolean;
  position: string | null;
  is_radical: boolean;
  is_phonetic: boolean;
  part: number | null;
  strokes: number[];
  children: ComponentNode[];
}

interface ComponentRow {
  kanji_literal: string;
  ord: number;
  parent_ord: number | null;
  depth: number;
  component: string;
  original: string | null;
  is_variant: boolean;
  is_radical: boolean;
  is_phonetic: boolean;
  position: string | null;
  part: number | null;
  strokes: number[];
  stroke_count: number;
}

function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Tham số lạ: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(key, 'true');
      continue;
    }
    flags.set(key, next);
    i += 1;
  }
  return flags;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(Number(dec)),
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : null;
}

/** Parse phần `<g id="kvg:StrokePaths_…">…</g>` thành cây thành phần. */
export function parseKanjiVg(xml: string): ComponentNode | null {
  const start = xml.indexOf('<g id="kvg:StrokePaths_');
  if (start < 0) return null;
  const body = xml.slice(start);
  const stack: ComponentNode[] = [];
  let root: ComponentNode | null = null;
  const tagPattern = /<g\b[^>]*>|<\/g>|<path\b[^>]*>|<text\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(body)) !== null) {
    const tag = match[0];
    if (tag.startsWith('</g')) {
      const finished = stack.pop();
      if (finished && stack.length === 0) root = finished;
      continue;
    }
    if (tag.startsWith('<text')) continue;
    if (tag.startsWith('<path')) {
      const id = attr(tag, 'id');
      const strokeMatch = id ? id.match(/-s(\d+)$/) : null;
      if (strokeMatch && stack.length > 0)
        stack[stack.length - 1].strokes.push(Number(strokeMatch[1]));
      continue;
    }
    const element = attr(tag, 'kvg:element');
    if (element === null) {
      // Group không có kvg:element (vd wrapper stroke paths) → giữ nguyên chỗ.
      if (stack.length === 0) continue;
      const passthrough: ComponentNode = {
        component: '',
        original: null,
        is_variant: false,
        position: null,
        is_radical: false,
        is_phonetic: false,
        part: null,
        strokes: [],
        children: [],
      };
      // Đẩy node rỗng để giữ đúng cặp mở/đóng; gắn vào cha để subtree không mồ côi.
      if (stack.length > 0) stack[stack.length - 1].children.push(passthrough);
      stack.push(passthrough);
      continue;
    }
    const node: ComponentNode = {
      component: element,
      original: attr(tag, 'kvg:original'),
      is_variant: attr(tag, 'kvg:variant') === 'true',
      position: attr(tag, 'kvg:position'),
      is_radical: attr(tag, 'kvg:radical') !== null,
      is_phonetic: attr(tag, 'kvg:phon') !== null,
      part: attr(tag, 'kvg:part') ? Number(attr(tag, 'kvg:part')) : null,
      strokes: [],
      children: [],
    };
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else root = node;
    stack.push(node);
  }
  return root;
}

function flatten(root: ComponentNode): ComponentRow[] {
  const rows: ComponentRow[] = [];
  const visit = (
    node: ComponentNode,
    parentOrd: number | null,
    depth: number,
  ) => {
    if (node.component === '') {
      node.children.forEach((child) => visit(child, parentOrd, depth));
      return;
    }
    const ord = rows.length;
    const strokes = [...new Set(node.strokes)].sort((a, b) => a - b);
    rows.push({
      kanji_literal: '',
      ord,
      parent_ord: parentOrd,
      depth,
      component: node.component,
      original: node.original,
      is_variant: node.is_variant,
      is_radical: node.is_radical,
      is_phonetic: node.is_phonetic,
      position: node.position,
      part: node.part,
      strokes,
      stroke_count: strokes.length,
    });
    node.children.forEach((child) => visit(child, ord, depth + 1));
  };
  visit(root, null, 0);
  return rows;
}

export function componentsForFile(filePath: string): ComponentRow[] {
  const xml = readFileSync(filePath, 'utf8');
  const root = parseKanjiVg(xml);
  if (!root) return [];
  const kanji = root.component;
  return flatten(root).map((row) => ({ ...row, kanji_literal: kanji }));
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const svgDir = flags.get('svg-dir');
  if (!svgDir) throw new Error('Thiếu --svg-dir');
  const limit = flags.has('limit') ? Number(flags.get('limit')) : undefined;
  const sampleChar = flags.get('sample');
  const apply = flags.has('apply');
  const allowDb = flags.get('allow-db');
  const databaseUrl =
    flags.get('database-url') ?? process.env.DATABASE_URL ?? '';
  if (apply && !allowDb)
    throw new Error(
      'Apply cần --allow-db <database> (khớp database trong URL)',
    );

  const files = readdirSync(svgDir)
    .filter((name) => /^[0-9a-f]{5,6}\.svg$/i.test(name))
    .sort();
  const selected = limit ? files.slice(0, limit) : files;

  if (sampleChar) {
    for (const row of componentsForFile(path.join(svgDir, `${sampleChar}.svg`)))
      console.log(
        `  ${row.ord} d${row.depth} parent=${row.parent_ord} ${row.component}${row.original ? `(${row.original})` : ''} pos=${row.position ?? '-'} rad=${row.is_radical} phon=${row.is_phonetic} part=${row.part ?? '-'} strokes=[${row.strokes.join(',')}]`,
      );
    return;
  }

  const perKanjiMap = new Map<string, ComponentRow[]>();
  const skipped: string[] = [];
  const duplicateLiterals: string[] = [];
  for (const name of selected) {
    const rows = componentsForFile(path.join(svgDir, name));
    if (rows.length === 0) {
      skipped.push(name);
      continue;
    }
    const literal = rows[0].kanji_literal;
    if (perKanjiMap.has(literal)) {
      duplicateLiterals.push(`${name}→${literal}`);
      continue;
    }
    perKanjiMap.set(literal, rows);
  }
  const perKanji = [...perKanjiMap.values()];
  console.log('== DB3 kanjivg-components ==');
  console.log(
    `  files: ${selected.length} | kanji parse được: ${perKanji.length} | bỏ: ${skipped.length} | trùng literal: ${duplicateLiterals.length}`,
  );
  if (duplicateLiterals.length)
    console.log(
      `  trùng (bỏ qua): ${duplicateLiterals.slice(0, 5).join(', ')}…`,
    );
  console.log(
    `  rows: ${perKanji.reduce((sum, rows) => sum + rows.length, 0)}`,
  );
  if (skipped.length)
    console.log(
      `  bỏ (không có StrokePaths): ${skipped.slice(0, 5).join(', ')}…`,
    );

  if (!apply) {
    console.log('  (dry-run — thêm --apply --allow-db <db> để ghi)');
    return;
  }
  if (!databaseUrl) throw new Error('Thiếu --database-url hoặc DATABASE_URL');
  const dbName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (dbName !== allowDb)
    throw new Error(`--allow-db ${allowDb} ≠ database ${dbName} của URL`);
  const host = new URL(databaseUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host))
    throw new Error(`Chỉ cho phép DB local, nhận host ${host}`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let inserted = 0;
  const batchSize = 200;
  try {
    for (let offset = 0; offset < perKanji.length; offset += batchSize) {
      const batch = perKanji.slice(offset, offset + batchSize);
      await client.query('BEGIN');
      try {
        const literals = batch.map((rows) => rows[0].kanji_literal);
        await client.query(
          'DELETE FROM core.kanji_component WHERE kanji_literal = ANY($1::text[])',
          [literals],
        );
        for (const rows of batch) {
          const values: unknown[] = [];
          const tuples = rows.map((row, index) => {
            const base = index * 14;
            values.push(
              row.kanji_literal,
              row.ord,
              row.parent_ord,
              row.depth,
              row.component,
              row.original,
              row.is_variant,
              row.is_radical,
              row.is_phonetic,
              row.position,
              row.part,
              row.strokes,
              row.stroke_count,
              18, // public.source: kanjivg
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`;
          });
          await client.query(
            `INSERT INTO core.kanji_component
               (kanji_literal, ord, parent_ord, depth, component, original,
                is_variant, is_radical, is_phonetic, "position", part,
                strokes, stroke_count, source_id)
             VALUES ${tuples.join(',')}`,
            values,
          );
          inserted += rows.length;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      if ((offset / batchSize) % 10 === 0)
        console.log(`  … ${offset + batch.length}/${perKanji.length} kanji`);
    }
    console.log(`  ĐÃ GHI ${inserted} dòng cho ${perKanji.length} kanji`);
  } finally {
    await client.end();
  }

  const manifestPath = flags.get('manifest');
  if (manifestPath) {
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          task: 'kanjivg-components',
          source: SOURCE,
          svgDir,
          files: selected.length,
          kanji: perKanji.length,
          rows: inserted,
          skipped,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`  manifest: ${manifestPath}`);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `kanjivg-components: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
