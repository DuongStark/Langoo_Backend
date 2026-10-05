import path from 'node:path';
import {
  assertFixtureTarget,
  assertWritableTarget,
  chunk,
  connect,
  log,
  parseCli,
  readText,
  requireUrl,
  RunManifest,
  sha256,
  sha256File,
  upsertSourceRow,
  writeManifest,
} from './_shared';
import {
  applyWithJournal,
  changesOf,
  rollbackWithJournal,
  snapshot,
} from './_mutations';

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
    if (map.has(Number(match[1])))
      throw new Error(`CJKRadicals trùng bộ ${match[1]}`);
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
  return (
    value
      .split(/[,、\s]+/)
      // Wikipedia uses ~ to mark the side of 阝; it is not part of the glyph.
      .map((item) => item.trim().replace(/^~|~$/g, ''))
      .filter((item) => item !== '')
  );
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

    if (map.has(number)) throw new Error(`vi.wikipedia trùng bộ ${number}`);
    map.set(number, {
      number,
      character,
      variants,
      nameVi: cleanCell(cells[1])
        .replace(/^bộ\s+/i, '')
        .replace(/\s*\([^)]*\)\s*$/, ''),
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
    if (typeof extract !== 'string')
      throw new Error(`Extract không hợp lệ: ${title}`);
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
    if (nameEn === null)
      warnings.push(`en: không trích được name_en bộ ${number}`);

    if (!input.strokes.has(cjk.unifiedCodePoint))
      warnings.push(`unihan: thiếu số nét bộ ${number}`);
    rows.push({
      number,
      character: unified,
      variants: variants.filter((variant) => variant !== unified),
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
    'Unicode Consortium; https://vi.wikipedia.org/wiki/Bộ_thủ_Khang_Hi; https://en.wikipedia.org/wiki/Kangxi_radical (các bài Radical 1–214)',
  url: 'https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt',
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

export function validateRadicals(rows: FusedRadical[], fixture: boolean): void {
  if (rows.length === 0 || (!fixture && rows.length !== 214)) {
    throw new Error(
      'Apply radical cần đủ 214 bộ; tập nhỏ chỉ dùng --fixture trên DB test',
    );
  }
  const numbers = new Set<number>();
  const characters = new Set<string>();
  for (const row of rows) {
    if (
      !Number.isInteger(row.number) ||
      row.number < 1 ||
      row.number > 214 ||
      numbers.has(row.number) ||
      characters.has(row.character) ||
      [...row.character].length !== 1 ||
      !row.nameVi.trim() ||
      !row.meaningVi.trim() ||
      !row.nameEn?.trim() ||
      row.variants.some((variant) => [...variant].length !== 1) ||
      (row.strokeCount !== null &&
        (!Number.isInteger(row.strokeCount) || row.strokeCount < 1))
    ) {
      throw new Error(
        `Radical #${row.number} thiếu field bắt buộc/trùng khoá/dữ liệu không hợp lệ`,
      );
    }
    numbers.add(row.number);
    characters.add(row.character);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseCli('radicals', argv);
  const url = requireUrl();
  const rollback = cli.flags.get('rollback');
  if (typeof rollback === 'string')
    return rollbackWithJournal(cli, url, rollback);
  assertWritableTarget(url, cli);
  assertFixtureTarget(url, cli);
  const { rows, warnings, inputHashes } = loadRadicals(cli.sources);
  if (cli.apply) validateRadicals(rows, cli.flags.get('fixture') === true);
  const inputs = { ...inputHashes };
  const inputUrls: Record<string, string> = {
    cjk: SOURCE.url,
    vi: 'https://vi.wikipedia.org/wiki/Bộ_thủ_Khang_Hi',
    unihan: 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip',
    en: 'https://en.wikipedia.org/wiki/Kangxi_radical (Radical 1–214)',
  };
  for (const key of Object.keys(inputHashes)) {
    inputs[`${key}.url`] = inputUrls[key];
    inputs[`${key}.version`] = `raw-sha256:${inputHashes[key]}`;
    inputs[`${key}.license`] =
      key === 'cjk' || key === 'unihan'
        ? 'Unicode License v3'
        : 'CC BY-SA (Wikipedia)';
  }
  const version = `raw snapshots ${sha256(JSON.stringify(inputHashes))}`;
  const manifest: RunManifest = {
    task: 'radicals',
    startedAt: new Date().toISOString(),
    applied: false,
    inputs,
    warnings,
    summary: {
      rows: rows.length,
      missingNameEn: rows.filter((row) => row.nameEn === null).length,
      missingStrokes: rows.filter((row) => row.strokeCount === null).length,
    },
  };
  log(
    `== DB3 radicals (${cli.apply ? 'APPLY' : 'DRY-RUN'}): ${rows.length}/214 ==`,
  );
  const reportParts = async (client: import('pg').Client): Promise<void> => {
    const parts = await client.query<{ part: string }>(
      'SELECT DISTINCT part FROM core.kanji_radical ORDER BY part',
    );
    const known = new Set(
      rows.flatMap((row) => [row.character, ...row.variants]),
    );
    const unmapped = parts.rows
      .filter((row) => !known.has(row.part))
      .map((row) => row.part);
    manifest.summary.unmappedParts = unmapped;
    manifest.summary.ambiguousParts = parts.rows.flatMap(({ part }) => {
      const numbers = rows
        .filter((row) => row.character === part || row.variants.includes(part))
        .map((row) => row.number);
      return numbers.length > 1 ? [{ part, numbers }] : [];
    });
    log(
      `KRADFILE: ${unmapped.length}/${parts.rows.length} part chưa map (chỉ báo cáo)`,
    );
  };
  if (cli.apply) {
    await applyWithJournal(cli, url, manifest, async (client) => {
      const numbers = rows.map((row) => row.number);
      const before = [
        await snapshot(client, 'public.source', [SOURCE.code]),
        await snapshot(client, 'public.radical', numbers),
      ];
      const sourceId = await upsertSourceRow(client, {
        ...SOURCE,
        version,
        sha256: sha256(JSON.stringify(inputHashes)),
      });
      await applyRows(client, rows, sourceId);
      await reportParts(client);
      const after = [
        await snapshot(client, 'public.source', [SOURCE.code]),
        await snapshot(client, 'public.radical', numbers),
      ];
      return changesOf(before, after);
    });
  } else {
    const client = await connect(url);
    try {
      await reportParts(client);
    } finally {
      await client.end();
    }
    log(`manifest: ${writeManifest(cli.manifestDir, manifest)}`);
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
