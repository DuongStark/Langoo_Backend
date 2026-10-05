import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { connect, log, parseCli, requireUrl, sha256 } from './_shared';
import {
  createExampleCandidate,
  parseExampleCandidate,
  type ExampleCandidate,
  type ExampleCandidateInput,
} from './_example-types';
import type { GlossSource } from './_gloss-types';

/**
 * DB3-B1 — harvest cặp ví dụ Tatoeba JA↔VI theo example schema v1 (READ-ONLY).
 *
 * Xuất `examples.jsonl` (source_pair) + `example-summary.json` vào `--out`
 * (mặc định `<artifact-dir>/examples-<stamp>`). Không gán sense, không seed example.
 */

interface InventoryFile {
  summary?: {
    fingerprint?: { dataset_digest?: string; db?: string };
    coverage?: { en_gloss_senses?: number };
  };
}

interface SourceAuditFile {
  summary?: {
    sources?: { id: number }[];
    import_batches?: {
      id: string;
      source_code: string;
      row_count: number | null;
    }[];
  };
}

interface PairLinkRow {
  lo: string;
  hi: string;
  ja_id: string;
  ja_text: string;
  ja_batch: string;
  vi_id: string;
  vi_text: string;
  vi_batch: string;
  link_from: string;
  link_to: string;
  link_batch: string;
}

function flag(
  cli: ReturnType<typeof parseCli>,
  key: string,
): string | undefined {
  const value = cli.flags.get(key);
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function newest(dir: string, keyword: string, ext: string): string {
  const files = readdirSync(dir)
    .filter((name) => name.includes(keyword) && name.endsWith(ext))
    .sort();
  if (files.length === 0) {
    throw new Error(`Không tìm thấy artifact ${keyword}${ext} trong ${dir}`);
  }
  return path.join(dir, files[files.length - 1]);
}

function relativeArtifact(file: string, artifactDir: string): string {
  const resolved = path.resolve(file);
  const base = path.resolve(artifactDir) + path.sep;
  if (!resolved.startsWith(base)) {
    throw new Error(`Artifact ${file} phải nằm trong ${artifactDir}`);
  }
  const rel = path.relative(path.resolve(artifactDir), resolved);
  if (rel.split(path.sep).some((part) => part === '..' || part === '')) {
    throw new Error(`Đường dẫn artifact không hợp lệ: ${rel}`);
  }
  return rel.split(path.sep).join('/');
}

async function main(): Promise<void> {
  const cli = parseCli('example-candidates', process.argv.slice(2));
  const verifyDir = flag(cli, 'verify');
  if (verifyDir) {
    const lines = readFileSync(path.join(verifyDir, 'examples.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const counts: Record<string, number> = {};
    for (const line of lines) {
      const candidate = parseExampleCandidate(JSON.parse(line));
      counts[candidate.classification] =
        (counts[candidate.classification] ?? 0) + 1;
    }
    log(`== DB3-B1 example verify ${verifyDir} ==`);
    for (const [key, value] of Object.entries(counts).sort()) {
      log(`  ${key}=${value}`);
    }
    return;
  }
  const url = requireUrl();
  const artifactDir = flag(cli, 'artifact-dir') ?? cli.manifestDir;
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const outDir =
    flag(cli, 'out') ?? path.join(artifactDir, `examples-${stamp}`);
  mkdirSync(outDir, { recursive: true });

  const inventoryFile =
    flag(cli, 'inventory') ?? newest(artifactDir, 'gloss-inventory', '.json');
  const auditFile =
    flag(cli, 'source-audit') ?? newest(artifactDir, 'source-audit', '.json');
  const inventorySha = sha256(readFileSync(inventoryFile));
  const auditSha = sha256(readFileSync(auditFile));
  const inventory = JSON.parse(
    readFileSync(inventoryFile, 'utf8'),
  ) as InventoryFile;
  const sourceAudit = JSON.parse(
    readFileSync(auditFile, 'utf8'),
  ) as SourceAuditFile;
  const datasetFingerprint = inventory.summary?.fingerprint?.dataset_digest;
  if (!datasetFingerprint || !/^[a-f0-9]{64}$/.test(datasetFingerprint)) {
    throw new Error('Inventory thiếu dataset_digest hợp lệ');
  }

  const client = await connect(url);
  try {
    const urlObj = new URL(url);
    const dbName = decodeURIComponent(urlObj.pathname.replace(/^\//, ''));
    if (
      inventory.summary?.fingerprint?.db &&
      inventory.summary.fingerprint.db !== dbName
    ) {
      throw new Error(
        `Inventory thuộc DB ${inventory.summary.fingerprint.db}, đang chạy ${dbName}`,
      );
    }

    const source = await client.query<{
      id: number;
      code: string;
      license: string | null;
      attribution: string | null;
      url: string | null;
      version: string | null;
      sha256: string | null;
    }>(
      `SELECT id, code, license, attribution, url, version, sha256
       FROM public.source WHERE code = 'tatoeba'`,
    );
    const tatoeba = source.rows[0];
    if (!tatoeba) throw new Error('Không thấy source tatoeba');

    const batches = await client.query<{ id: string; source_code: string }>(
      `SELECT id::text, source_code FROM staging.import_batch WHERE source_code = 'tatoeba' ORDER BY id`,
    );
    const batchIds = batches.rows.map((row) => row.id);
    if (batchIds.length === 0) throw new Error('tatoeba chưa có import_batch');

    // Guard: row_count của batch tatoeba trong audit B0 phải là một trong các
    // count hiện tại (sentences/links) — phát hiện snapshot đã đổi.
    const currentCounts = await client.query<{
      sentences: number;
      links: number;
    }>(
      `SELECT (SELECT count(*)::int FROM staging.tatoeba_sentence) AS sentences,
              (SELECT count(*)::int FROM staging.tatoeba_link) AS links`,
    );
    const currentSet = new Set([
      currentCounts.rows[0].sentences,
      currentCounts.rows[0].links,
    ]);
    for (const batch of sourceAudit.summary?.import_batches ?? []) {
      if (batch.source_code !== 'tatoeba') continue;
      if (batch.row_count !== null && !currentSet.has(batch.row_count)) {
        throw new Error(
          `Drift batch ${batch.id}: audit ${batch.row_count}, hiện có sentences=${currentCounts.rows[0].sentences} links=${currentCounts.rows[0].links}. Chạy lại B0.`,
        );
      }
    }

    const evidence = {
      path: relativeArtifact(auditFile, artifactDir),
      sha256: auditSha,
    };
    const snapshotText = `import-batches:${batchIds.join(',')} (2026-09-23)`;
    const sourceEntry: GlossSource = {
      sourceId: tatoeba.id,
      code: tatoeba.code,
      version: tatoeba.version,
      snapshot: snapshotText,
      sha256: tatoeba.sha256,
      license: tatoeba.license,
      attribution: tatoeba.attribution,
      url: tatoeba.url,
      batchIds,
      audit: { status: 'verified', evidence: [evidence], reasons: [] },
    };

    const pairRows = await client.query<PairLinkRow>(
      `WITH ja AS (
         SELECT id, text, batch_id::text AS batch_id
         FROM staging.tatoeba_sentence WHERE lang = 'jpn'
       ),
       vi AS (
         SELECT id, text, batch_id::text AS batch_id
         FROM staging.tatoeba_sentence WHERE lang = 'vie'
       ),
       edges AS (
         SELECT l.sentence_id, l.translation_id, l.batch_id::text AS link_batch
         FROM staging.tatoeba_link l
         JOIN ja a ON a.id = l.sentence_id
         JOIN vi b ON b.id = l.translation_id
         UNION ALL
         SELECT l.sentence_id, l.translation_id, l.batch_id::text AS link_batch
         FROM staging.tatoeba_link l
         JOIN vi a ON a.id = l.sentence_id
         JOIN ja b ON b.id = l.translation_id
       ),
       pairs AS (
         SELECT LEAST(sentence_id, translation_id) AS lo,
                GREATEST(sentence_id, translation_id) AS hi
         FROM edges GROUP BY 1, 2
       )
       SELECT pairs.lo::text AS lo, pairs.hi::text AS hi,
              j.id::text AS ja_id, j.text AS ja_text, j.batch_id AS ja_batch,
              v.id::text AS vi_id, v.text AS vi_text, v.batch_id AS vi_batch,
              e.sentence_id::text AS link_from, e.translation_id::text AS link_to,
              e.link_batch
       FROM pairs
       JOIN ja j ON j.id IN (pairs.lo, pairs.hi)
       JOIN vi v ON v.id IN (pairs.lo, pairs.hi)
       JOIN edges e
         ON (e.sentence_id = pairs.lo AND e.translation_id = pairs.hi)
         OR (e.sentence_id = pairs.hi AND e.translation_id = pairs.lo)
       ORDER BY pairs.lo, pairs.hi, e.sentence_id, e.translation_id`,
    );

    const byPair = new Map<string, PairLinkRow[]>();
    for (const row of pairRows.rows) {
      const key = `${row.lo}:${row.hi}`;
      const list = byPair.get(key) ?? [];
      list.push(row);
      byPair.set(key, list);
    }

    const limit = cli.limit;
    const pairKeys = [...byPair.keys()].sort((a, b) => {
      const [alo, ahi] = a.split(':').map((value) => BigInt(value));
      const [blo, bhi] = b.split(':').map((value) => BigInt(value));
      if (alo !== blo) return alo < blo ? -1 : 1;
      if (ahi !== bhi) return ahi < bhi ? -1 : 1;
      return 0;
    });
    const selected = limit === undefined ? pairKeys : pairKeys.slice(0, limit);

    const candidates: ExampleCandidate[] = [];
    let bothDirections = 0;
    const counts = {
      source_pair: 0,
      blocked_source: 0,
      pairs_total: pairKeys.length,
      skipped_by_limit: pairKeys.length - selected.length,
    };

    for (const key of selected) {
      const rows = byPair.get(key) ?? [];
      const first = rows[0];
      const links = rows
        .map((row) => ({
          sentenceId: row.link_from,
          translationId: row.link_to,
          sourceCode: 'tatoeba',
          batchId: row.link_batch,
        }))
        .sort((a, b) => {
          const as = BigInt(a.sentenceId);
          const bs = BigInt(b.sentenceId);
          if (as !== bs) return as < bs ? -1 : 1;
          return BigInt(a.translationId) < BigInt(b.translationId) ? -1 : 1;
        });
      if (rows.length > 1) bothDirections += 1;
      const lineageOk =
        batchIds.includes(first.ja_batch) &&
        batchIds.includes(first.vi_batch) &&
        links.every((link) => batchIds.includes(link.batchId));
      if (!lineageOk) {
        throw new Error(`Pair ${key}: batch ngoài lineage tatoeba`);
      }
      const input: ExampleCandidateInput = {
        schemaVersion: 1,
        candidateType: 'example_pair',
        datasetFingerprint,
        ja: {
          sentenceId: first.ja_id,
          text: first.ja_text,
          textHash: sha256(first.ja_text),
          sourceCode: 'tatoeba',
          batchId: first.ja_batch,
          language: 'ja',
        },
        vi: {
          sentenceId: first.vi_id,
          text: first.vi_text,
          textHash: sha256(first.vi_text),
          sourceCode: 'tatoeba',
          batchId: first.vi_batch,
          language: 'vi',
        },
        links,
        sources: [sourceEntry],
        alignment: 'unmapped',
        notes: ['Tatoeba JA–VI pair; chưa gán sense (DB4), chưa seed example.'],
        classification:
          sourceEntry.audit.status === 'verified'
            ? 'source_pair'
            : 'blocked_source',
        blockedReasons:
          sourceEntry.audit.status === 'verified'
            ? []
            : ['Nguồn Tatoeba chưa đủ audit.'],
      };
      candidates.push(createExampleCandidate(input));
      if (input.classification === 'source_pair') counts.source_pair += 1;
      else counts.blocked_source += 1;
    }

    candidates.sort((a, b) => {
      const ak = a.candidateKey;
      const bk = b.candidateKey;
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });

    const examplesFile = path.join(outDir, 'examples.jsonl');
    const examplesText = `${candidates.map((c) => JSON.stringify(c)).join('\n')}\n`;
    writeFileSync(examplesFile, examplesText);

    const summary = {
      task: 'example-candidates',
      startedAt,
      db: dbName,
      inventory: {
        path: relativeArtifact(inventoryFile, artifactDir),
        sha256: inventorySha,
        datasetFingerprint,
      },
      sourceAudit: {
        path: relativeArtifact(auditFile, artifactDir),
        sha256: auditSha,
      },
      counts: { ...counts, both_directions: bothDirections },
      files: {
        'examples.jsonl': {
          bytes: Buffer.byteLength(examplesText),
          sha256: sha256(examplesText),
        },
      },
      warnings: [] as string[],
    };
    writeFileSync(
      path.join(outDir, 'example-summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );

    log(`== DB3-B1 example-candidates (READ-ONLY) — db=${dbName} ==`);
    log(
      `  fingerprint=${datasetFingerprint.slice(0, 16)}… · nguồn tatoeba #${tatoeba.id} (${tatoeba.license}) · snapshot batch ${batchIds.join(', ')}`,
    );
    log(
      `  cặp JA↔VI: ${counts.pairs_total} unique · ${counts.source_pair} source_pair · ${counts.blocked_source} blocked · 2 chiều: ${bothDirections}`,
    );
    log(
      `  examples.jsonl ${summary.files['examples.jsonl'].bytes}B ${summary.files['examples.jsonl'].sha256.slice(0, 16)}…`,
    );
    log(`out: ${outDir}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `example-candidates: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
