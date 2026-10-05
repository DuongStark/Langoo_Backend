import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * DB3 — tải nguồn raw cho seed (một lệnh cho ops).
 * KHÔNG phải dependency runtime; dùng fetch/child_process sẵn có.
 *
 * Mặc định tải: CJKRadicals.txt, vi.wikipedia wikitext, Unihan kTotalStrokes, en.wikipedia extracts.
 * KanjiVG (zip lớn) chỉ tải khi thêm vào --only (ví dụ `--only cjk,kanjivg`).
 *
 * Ví dụ:
 *   npx tsx scripts/db3/fetch-sources.ts --out "uploads/db3-sources"
 *   npx tsx scripts/db3/fetch-sources.ts --out "/media/.../langoo-db3-sources" --only cjk,vi,unihan,en,kanjivg
 */

const DEFAULT_TASKS = ['cjk', 'vi', 'unihan', 'en'];
const USER_AGENT = 'LangooDB3Fetch/0.1 (one-off dataset build; contact: dev)';

type Task = 'cjk' | 'vi' | 'unihan' | 'en' | 'kanjivg';

interface SourceEntry {
  file: string;
  url: string;
  license: string;
  attribution: string;
  sha256: string;
  bytes: number;
  fetchedAt: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv: string[]): {
  out: string;
  only: Task[] | null;
} {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      index += 1;
    }
  }
  const onlyRaw = flags.get('only');
  return {
    out: flags.get('out') ?? path.resolve('uploads/db3-sources'),
    only: onlyRaw
      ? (onlyRaw.split(',').map((item) => item.trim()) as Task[])
      : null,
  };
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fetchWithRetry(
  url: string,
  label: string,
  attempts = 5,
): Promise<Buffer> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
    });
    if (response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }
    console.error(
      `  ${label}: HTTP ${response.status} (thử ${attempt}/${attempts})`,
    );
    await sleep(attempt * 2000);
  }
  throw new Error(`${label}: tải thất bại sau ${attempts} lần`);
}

async function fetchJson(
  url: string,
  label: string,
  attempts = 6,
): Promise<unknown> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
    });
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch {
        console.error(`  ${label}: body không phải JSON (thử ${attempt})`);
      }
    } else {
      console.error(
        `  ${label}: HTTP ${response.status} (thử ${attempt}/${attempts})`,
      );
    }
    await sleep(attempt * 3000);
  }
  throw new Error(`${label}: tải thất bại sau ${attempts} lần`);
}

function save(
  outDir: string,
  entries: SourceEntry[],
  relative: string,
  buffer: Buffer,
  meta: Omit<SourceEntry, 'file' | 'sha256' | 'bytes' | 'fetchedAt'>,
): void {
  const file = path.join(outDir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buffer);
  entries.push({
    file: relative,
    ...meta,
    sha256: sha256(buffer),
    bytes: buffer.byteLength,
    fetchedAt: new Date().toISOString(),
  });
  console.log(`  ✓ ${relative} (${(buffer.byteLength / 1024).toFixed(0)} KB)`);
}

async function taskCjk(outDir: string, entries: SourceEntry[]): Promise<void> {
  const url = 'https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt';
  const buffer = await fetchWithRetry(url, 'CJKRadicals');
  save(outDir, entries, 'CJKRadicals.txt', buffer, {
    url,
    license: 'Unicode License v3',
    attribution: 'Unicode Consortium',
  });
}

async function taskVi(outDir: string, entries: SourceEntry[]): Promise<void> {
  const page = 'Bộ thủ Khang Hi';
  const url =
    'https://vi.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&redirects=1&page=' +
    encodeURIComponent(page);
  const json = (await fetchJson(url, 'vi.wikipedia parse')) as {
    parse?: { wikitext?: { '*': string } };
  };
  const wikitext = json.parse?.wikitext?.['*'];
  if (!wikitext) throw new Error('vi.wikipedia: không lấy được wikitext');
  save(outDir, entries, 'vi-kangxi-radicals.wikitext', Buffer.from(wikitext), {
    url,
    license: 'CC BY-SA 4.0',
    attribution: `Wikipedia tiếng Việt — "${page}"`,
  });
}

async function taskUnihan(
  outDir: string,
  entries: SourceEntry[],
): Promise<void> {
  const url = 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip';
  const zip = await fetchWithRetry(url, 'Unihan.zip');
  mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, 'Unihan.zip');
  writeFileSync(zipPath, zip);
  let raw: Buffer;
  try {
    raw = execFileSync('unzip', ['-p', zipPath, 'Unihan_IRGSources.txt'], {
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `Unihan: giải nén thất bại (zip tại ${zipPath}) — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const lines = raw
    .toString('utf8')
    .split('\n')
    .filter((line) => line.includes('\tkTotalStrokes\t'));
  if (lines.length === 0)
    throw new Error('Unihan: không thấy dòng kTotalStrokes');
  save(
    outDir,
    entries,
    'unihan-kTotalStrokes.tsv',
    Buffer.from(`${lines.join('\n')}\n`),
    {
      url,
      license: 'Unicode License v3',
      attribution: 'Unicode Consortium — Unihan_IRGSources.txt (kTotalStrokes)',
    },
  );
}

async function taskEn(outDir: string, entries: SourceEntry[]): Promise<void> {
  const responseSchema = z.object({
    query: z.object({
      pages: z.record(
        z.object({ title: z.string(), extract: z.string().optional() }),
      ),
    }),
  });
  const extracts: Record<string, string> = {};
  const titles = Array.from(
    { length: 214 },
    (_, index) => `Radical ${index + 1}`,
  );
  for (let index = 0; index < titles.length; index += 20) {
    const batch = titles.slice(index, index + 20);
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exlimit=max&redirects=1&format=json&titles=' +
      encodeURIComponent(batch.join('|'));
    let json: z.infer<typeof responseSchema> | undefined;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        json = responseSchema.parse(
          await fetchJson(url, `en.wikipedia batch ${index / 20 + 1}`, 1),
        );
        break;
      } catch {
        await sleep(attempt * 5000);
      }
    }
    if (!json) throw new Error('en.wikipedia: batch thất bại');
    for (const page of Object.values(json.query.pages)) {
      if (page.extract) extracts[page.title] = page.extract;
    }
    console.log(
      `  batch ${index / 20 + 1}/11 — tích lũy ${Object.keys(extracts).length}`,
    );
    await sleep(1500);
  }
  const missing = titles.filter((title) => !extracts[title]);
  if (missing.length > 0) {
    console.error(
      `  ⚠ thiếu extract: ${missing.length} (${missing.slice(0, 8).join(', ')}…)`,
    );
  }
  save(
    outDir,
    entries,
    'en-radicals-extracts.json',
    Buffer.from(`${JSON.stringify(extracts, null, 1)}\n`),
    {
      url: 'https://en.wikipedia.org/w/api.php (prop=extracts, 214 bài "Radical N")',
      license: 'CC BY-SA 4.0',
      attribution: 'Wikipedia tiếng Anh — các bài "Radical N"',
    },
  );
}

async function taskKanjivg(
  outDir: string,
  entries: SourceEntry[],
): Promise<void> {
  const release = (await fetchJson(
    'https://api.github.com/repos/KanjiVG/kanjivg/releases/latest',
    'KanjiVG release',
  )) as {
    tag_name?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  const asset = release.assets?.find((item) => item.name.endsWith('.zip'));
  if (!asset) throw new Error('KanjiVG: không tìm thấy asset zip');
  console.log(`  KanjiVG ${release.tag_name ?? ''} — ${asset.name}`);
  const zip = await fetchWithRetry(asset.browser_download_url, 'KanjiVG zip');
  const zipPath = path.join(outDir, 'kanjivg', asset.name);
  mkdirSync(path.dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, zip);
  const svgDir = path.join(outDir, 'kanjivg');
  try {
    execFileSync('unzip', ['-j', '-o', zipPath, 'kanji/*.svg', '-d', svgDir], {
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `KanjiVG: cần lệnh "unzip" để giải nén (zip tại ${zipPath}) — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const count = execFileSync('bash', [
    '-c',
    `find "${svgDir}" -maxdepth 1 -name '*.svg' | wc -l`,
  ])
    .toString()
    .trim();
  entries.push({
    file: `kanjivg/ (${asset.name} + SVG đã giải nén)`,
    url: asset.browser_download_url,
    license: 'CC BY-SA 3.0',
    attribution: 'KanjiVG by Ulrich Apel (https://kanjivg.tagaini.net/)',
    sha256: sha256(zip),
    bytes: zip.byteLength,
    fetchedAt: new Date().toISOString(),
  });
  console.log(
    `  ✓ kanjivg/ (zip ${(zip.byteLength / 1024 / 1024).toFixed(1)} MB, ${count} SVG)`,
  );
}

async function main(): Promise<void> {
  const { out, only } = parseArgs(process.argv.slice(2));
  const tasks = (only ?? DEFAULT_TASKS) as Task[];
  mkdirSync(out, { recursive: true });
  console.log(`== DB3 fetch-sources ==\nra: ${out}\ntask: ${tasks.join(', ')}`);

  const entries: SourceEntry[] = [];
  for (const task of tasks) {
    console.log(`\n[${task}]`);
    if (task === 'cjk') await taskCjk(out, entries);
    else if (task === 'vi') await taskVi(out, entries);
    else if (task === 'unihan') await taskUnihan(out, entries);
    else if (task === 'en') await taskEn(out, entries);
    else if (task === 'kanjivg') await taskKanjivg(out, entries);
    else throw new Error(`task không hỗ trợ: ${String(task)}`);
  }

  const manifestFile = path.join(out, 'sources-manifest.json');
  writeFileSync(
    manifestFile,
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), entries }, null, 2)}\n`,
  );
  console.log(`\nmanifest: ${manifestFile}`);
  console.log('xong.');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `fetch-sources: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
