import path from 'node:path';
import {
  assertWritableTarget,
  chunk,
  connect,
  dbNameOf,
  log,
  parseCli,
  readManifest,
  readText,
  requireUrl,
  sha256,
  sha256File,
  upsertSourceRow,
  writeManifest,
} from './_shared';

/**
 * DB3-A2 — seed 214 bộ Kangxi vào public.radical từ 4 nguồn raw (không LLM):
 *  1. Unicode CJKRadicals.txt      : number ↔ radical char ↔ unified ideograph
 *  2. vi.wikipedia wikitext        : ký tự + biến thể, Hán-Việt, nghĩa VI
 *  3. Unihan kTotalStrokes.tsv     : số nét (theo chữ hợp nhất)
 *  4. en.wikipedia extracts JSON   : name_en (pattern `meaning "water"` + fallback)
 *
 * Dry-run mặc định. Apply: `--apply --allow-db <db> [--allow-test]`.
 * Rollback: `--rollback <manifest.json>`.
 */

export interface CjkRadical {
  number: number;
  radicalCodePoint: string;
  unifiedCodePoint: string;
}

export interface ViRadical {
  number: number;
  character: string;
  variants: string[];
  nameVi: string;
  meaningVi: string;
}

export interface FusedRadical {
  number: number;
  character: string;
  variants: string[];
  nameEn: string | null;
  nameVi: string;
  meaningVi: string;
  strokeCount: number | null;
}

export function parseCjkRadicals(text: string): Map<number, CjkRadical> {
  const map = new Map<number, CjkRadical>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match =
      /^(\d{1,3});\s*([0-9A-Fa-f]{4,6});\s*([0-9A-Fa-f]{4,6})$/.exec(line);
    if (!match) continue;
    map.set(Number(match[1]), {
      number: Number(match[1]),
      radicalCodePoint: match[2].toUpperCase(),
      unifiedCodePoint: match[3].toUpperCase(),
    });
  }
  return map;
}

export function cleanWikiText(value: string): string {
  return value
    .replace(/\{\{#tag:ref\|[^{}]*\}\}/g, ' ')
    .replace(/<ref[^>]*>.*?<\/ref>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCell(raw: string): string {
  return cleanWikiText(raw.replace(/^\|/, ''));
}

function splitTokens(value: string): string[] {
  return value
    .split(/[,、\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function parseViRadicals(text: string): Map<number, ViRadical> {
  const map = new Map<number, ViRadical>();
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\|(\d{1,3})\s*$/.exec(lines[index]);
    if (!match) continue;
    const number = Number(match[1]);
    if (number < 1 || number > 214) continue;

    const cells: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && cells.length < 6) {
      const line = lines[cursor];
      if (line.startsWith('|-') || line.startsWith('|}')) break;
      if (line.startsWith('|')) {
        cells.push(line);
      }
      cursor += 1;
    }
    if (cells.length < 6) continue;

    const charsCell = cleanCell(cells[0]);
    const paren = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(charsCell);
    const parenVariants: string[] = [];
    let tokens: string[];
    if (paren) {
      tokens = splitTokens(paren[1]);
      parenVariants.push(...splitTokens(paren[2]));
    } else {
      tokens = splitTokens(charsCell);
    }
    const character = tokens.shift() ?? '';
    if (character === '') continue;
    const variants = uniqueStrings(
      [...tokens, ...parenVariants].filter((item) => item !== character),
    );

    map.set(number, {
      number,
      character,
      variants,
      nameVi: cleanCell(cells[1]).replace(/\s*\([^)]*\)\s*$/, ''),
      meaningVi: cleanCell(cells[5]),
    });
  }
  return map;
}

/** Nhận cả `Unihan_IRGSources.txt` gốc hoặc file tsv đã lọc kTotalStrokes. */
export function parseUnihanStrokes(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const rawLine of text.split('\n')) {
    if (!rawLine.includes('\tkTotalStrokes\t')) continue;
    const [code, , value] = rawLine.split('\t');
    const match = /^U\+([0-9A-Fa-f]{4,6})$/.exec(code);
    if (!match) continue;
    const first = Number.parseInt(value.trim().split(/\s+/)[0], 10);
    if (Number.isFinite(first)) {
      map.set(match[1].toUpperCase(), first);
    }
  }
  return map;
}

export function parseEnExtracts(json: string): Map<number, string> {
  const data = JSON.parse(json) as Record<string, string>;
  const map = new Map<number, string>();
  for (const [title, extract] of Object.entries(data)) {
    const match = /^Radical (\d{1,3})$/.exec(title);
    if (!match) continue;
    map.set(Number(match[1]), extract);
  }
  return map;
}

/** Trích name_en từ intro en.wikipedia: `meaning "water"` + fallback `or radical X (...)`. */
export function extractNameEn(extract: string): string | null {
  const quoted = /meaning\s+"([^"]+)"/.exec(extract);
  if (quoted && quoted[1].trim() !== '') return quoted[1].trim();
  const radical = /or\s+radical\s+([^(]+?)\s*\(/.exec(extract);
  if (radical && radical[1].trim() !== '') return radical[1].trim();
  const anyQuoted = /"([^"]+)"/.exec(extract);
  if (anyQuoted && anyQuoted[1].trim() !== '') return anyQuoted[1].trim();
  return null;
}

export function fuseRadicals(input: {
  cjk: Map<number, CjkRadical>;
  vi: Map<number, ViRadical>;
  strokes: Map<string, number>;
  en: Map<number, string>;
}): { rows: FusedRadical[]; warnings: string[] } {
  const rows: FusedRadical[] = [];
  const warnings: string[] = [];
  for (let number = 1; number <= 214; number += 1) {
    const cjk = input.cjk.get(number);
    const vi = input.vi.get(number);
    if (!cjk) warnings.push(`cjk: thiếu bộ ${number}`);
    if (!vi) warnings.push(`vi: thiếu bộ ${number}`);
    if (!cjk || !vi) continue;

    const unified = String.fromCodePoint(
      Number.parseInt(cjk.unifiedCodePoint, 16),
    );
    // vi.wiki có thể dùng dạng khác (ký tự bộ, dạng Nhật) — giữ unified làm `character`,
    // phần khác đưa vào variants để join với kanji_radical.part.
    const variants = [
      ...new Set([
        ...vi.variants,
        ...(vi.character !== unified ? [vi.character] : []),
      ]),
    ];
    if (unified !== vi.character) {
      warnings.push(
        `bộ ${number}: vi.wiki "${vi.character}" khác unified "${unified}" → giữ unified, thêm vào variants`,
      );
    }
    const en = input.en.get(number);
    const nameEn = en ? extractNameEn(en) : null;
    if (en && nameEn === null)
      warnings.push(`en: không trích được name_en bộ ${number}`);

    rows.push({
      number,
      character: unified,
      variants,
      nameEn,
      nameVi: vi.nameVi,
      meaningVi: vi.meaningVi,
      strokeCount: input.strokes.get(cjk.unifiedCodePoint) ?? null,
    });
  }
  if (rows.length !== 214) {
    warnings.push(`tổng hợp được ${rows.length}/214 bộ`);
  }
  return { rows, warnings };
}

export function loadRadicals(sources: string): {
  rows: FusedRadical[];
  warnings: string[];
  inputHashes: Record<string, string>;
} {
  const files = {
    cjk: path.join(sources, 'CJKRadicals.txt'),
    vi: path.join(sources, 'vi-kangxi-radicals.wikitext'),
    unihan: path.join(sources, 'unihan-kTotalStrokes.tsv'),
    en: path.join(sources, 'en-radicals-extracts.json'),
  };
  const inputHashes: Record<string, string> = {};
  for (const [key, file] of Object.entries(files)) {
    inputHashes[key] = sha256File(file);
  }
  const fused = fuseRadicals({
    cjk: parseCjkRadicals(readText(files.cjk)),
    vi: parseViRadicals(readText(files.vi)),
    strokes: parseUnihanStrokes(readText(files.unihan)),
    en: parseEnExtracts(readText(files.en)),
  });
  return { ...fused, inputHashes };
}

const SOURCE = {
  code: 'kangxi-radicals',
  name: 'Kangxi radicals 214 (Unicode + vi.wikipedia + Unihan + en.wikipedia)',
  license: 'Unicode License v3 (CJKRadicals/Unihan) + CC BY-SA (Wikipedia)',
  attribution:
    'Unicode Consortium (CJKRadicals.txt, Unihan kTotalStrokes); Wikipedia tiếng Việt "Bộ thủ Khang Hi"; Wikipedia tiếng Anh "Radical N"',
  url: 'https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt',
  version: 'Unicode 18.0.0 + Wikipedia 2026-10-05',
};

async function applyRows(
  client: import('pg').Client,
  rows: FusedRadical[],
  sourceId: number,
): Promise<void> {
  const inputHash = sha256(rows.map((row) => JSON.stringify(row)).join('\n'));
  void sourceId; // public.radical không có cột source_id — giữ tham số cho tương lai.
  for (const batch of chunk(rows, 50)) {
    const values: unknown[] = [];
    const tuples = batch.map((row, index) => {
      const base = index * 7;
      values.push(
        row.number,
        row.character,
        row.nameEn,
        row.nameVi,
        row.meaningVi,
        row.strokeCount,
        row.variants,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
    });
    await client.query(
      `INSERT INTO public.radical (number, character, name_en, name_vi, meaning_vi, stroke_count, variants)
       VALUES ${tuples.join(',')}
       ON CONFLICT (number) DO UPDATE SET
         character = EXCLUDED.character,
         name_en = EXCLUDED.name_en,
         name_vi = EXCLUDED.name_vi,
         meaning_vi = EXCLUDED.meaning_vi,
         stroke_count = EXCLUDED.stroke_count,
         variants = EXCLUDED.variants`,
      values,
    );
  }
  log(
    `  đã upsert ${rows.length} bộ (hash dữ liệu ${inputHash.slice(0, 12)}…)`,
  );
}

interface RadicalSnapshotRow {
  number: number;
  character: string;
  name_en: string | null;
  name_vi: string | null;
  meaning_vi: string | null;
  stroke_count: number | null;
  variants: string[];
}

async function rollback(manifestFile: string): Promise<void> {
  const manifest = readManifest(manifestFile);
  if (!manifest.rollback || manifest.rollback.kind !== 'radicals') {
    throw new Error('Manifest không phải của task radicals');
  }
  const numbers = manifest.rollback.items.map((item) => Number(item));
  const before = (manifest.rollback.before ?? []) as RadicalSnapshotRow[];
  const beforeNumbers = new Set(before.map((row) => row.number));
  const url = requireUrl();
  const client = await connect(url);
  try {
    await client.query('BEGIN');
    const inserted = numbers.filter((number) => !beforeNumbers.has(number));
    if (inserted.length > 0) {
      await client.query(
        'DELETE FROM public.radical WHERE number = ANY($1::smallint[])',
        [inserted],
      );
    }
    for (const row of before) {
      await client.query(
        `UPDATE public.radical
         SET character = $2, name_en = $3, name_vi = $4, meaning_vi = $5,
             stroke_count = $6, variants = $7
         WHERE number = $1`,
        [
          row.number,
          row.character,
          row.name_en,
          row.name_vi,
          row.meaning_vi,
          row.stroke_count,
          row.variants,
        ],
      );
    }
    await client.query('COMMIT');
    log(
      `rollback radicals: xoá ${inserted.length} bộ mới, khôi phục ${before.length} bộ có sẵn`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const cli = parseCli('radicals', process.argv.slice(2));
  if (typeof cli.flags.get('rollback') === 'string') {
    await rollback(cli.flags.get('rollback') as string);
    return;
  }

  const url = requireUrl();
  assertWritableTarget(url, cli);
  const { rows, warnings, inputHashes } = loadRadicals(cli.sources);

  log(`== DB3 radicals (${cli.apply ? 'APPLY' : 'DRY-RUN'}) ==`);
  log(`nguồn: ${cli.sources}`);
  log(`tổng hợp: ${rows.length}/214 bộ`);
  for (const sample of [1, 24, 85, 214]) {
    const row = rows.find((item) => item.number === sample);
    if (row) {
      log(
        `  #${row.number} ${row.character} | variants=[${row.variants.join(',')}] | ${row.nameVi} | ${row.meaningVi} | ${row.nameEn ?? '∅'} | ${row.strokeCount ?? '∅'} nét`,
      );
    }
  }
  for (const warning of warnings.slice(0, 10)) log(`  ⚠ ${warning}`);
  if (warnings.length > 10)
    log(`  ⚠ … và ${warnings.length - 10} cảnh báo khác`);

  let manifestFile: string | null = null;
  let before: RadicalSnapshotRow[] = [];
  if (cli.apply) {
    const client = await connect(url);
    try {
      const snap = await client.query<RadicalSnapshotRow>(
        `SELECT number, character, name_en, name_vi, meaning_vi, stroke_count, variants
         FROM public.radical WHERE number = ANY($1::smallint[]) ORDER BY number`,
        [rows.map((row) => row.number)],
      );
      before = snap.rows;
      await client.query('BEGIN');
      const sourceId = await upsertSourceRow(client, {
        ...SOURCE,
        sha256: sha256(JSON.stringify(inputHashes)),
      });
      await applyRows(client, rows, sourceId);
      await client.query('COMMIT');
      log(
        `  nguồn: ${SOURCE.code} (id ${sourceId}) · có sẵn ${before.length} bộ (khôi phục khi rollback)`,
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.end();
    }
  }

  manifestFile = writeManifest(cli.manifestDir, {
    task: 'radicals',
    startedAt: new Date().toISOString(),
    applied: cli.apply,
    db: cli.apply ? dbNameOf(url) : undefined,
    inputs: inputHashes,
    summary: {
      rows: rows.length,
      variants: rows.filter((row) => row.variants.length > 0).length,
      missingNameEn: rows.filter((row) => row.nameEn === null).length,
      missingStrokes: rows.filter((row) => row.strokeCount === null).length,
    },
    warnings,
    rollback: {
      kind: 'radicals',
      items: rows.map((row) => row.number),
      before,
    },
  });
  log(`manifest: ${manifestFile}`);
  if (!cli.apply) {
    log(
      '(dry-run) chưa ghi DB. Thêm --apply --allow-db <db> [--allow-test] để ghi.',
    );
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `radicals: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
