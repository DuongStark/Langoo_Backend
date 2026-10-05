import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { connect, log, parseCli, requireUrl, sha256 } from './_shared';
import {
  createGlossCandidate,
  parseGlossCandidate,
  type GlossCandidate,
  type GlossCandidateInput,
  type GlossSource,
} from './_gloss-types';

/**
 * DB3-B1 — harvest candidate gloss theo contract v1 (READ-ONLY, không ghi DB).
 *
 * Xuất vào `--out` (mặc định `<artifact-dir>/harvest-<stamp>`):
 *  - `candidates.jsonl`  : lớp needs_translation (queue cho B3).
 *  - `unresolved.jsonl`  : ambiguous (pivot lexical) + blocked_source (OMW) + missing_context.
 *  - `harvest-summary.json`: counts, hash file, fingerprint B0, evidence audit.
 *
 * Cần artifact B0: `--inventory` + `--source-audit` (mặc định lấy file mới nhất trong artifact-dir).
 */

interface InventoryFile {
  summary?: {
    fingerprint?: {
      dataset_digest?: string;
      db?: string;
      host?: string;
      port?: string;
    };
    jlpt?: { totals?: { senses?: number } };
    coverage?: { en_gloss_senses?: number };
  };
}

interface ScopeRow {
  sense_id: string;
  sense_no: number;
  is_primary: boolean;
  external_id: string;
  register: string | null;
  domain: string | null;
  lexeme_id: string;
  lemma: string;
  pos: string;
  reading: string | null;
  frequency_rank: number | null;
  level: number;
  attributes: {
    kana?: { text?: string }[];
    kanji?: { text?: string }[];
  };
}

interface GlossRow {
  sense_id: string;
  id: string;
  rank: number;
  text: string;
  source_id: number;
  batch_id: string;
}

interface BatchRow {
  id: string;
  source_code: string;
}

interface SourceRow {
  id: number;
  code: string;
  license: string | null;
  attribution: string | null;
  url: string | null;
  version: string | null;
  sha256: string | null;
}

interface PivotRow {
  ja_text: string;
  vi_text: string;
  ja_id: string;
  vi_id: string;
  source_id: number | null;
  batch_id: string | null;
}

interface ConceptGlossRow {
  concept_id: string;
  rank: number;
  text: string;
  source_id: number | null;
  batch_id: string | null;
}

interface Summary {
  task: string;
  startedAt: string;
  db: string;
  inventory: { path: string; sha256: string; datasetFingerprint: string };
  sourceAudit: { path: string; sha256: string };
  counts: Record<string, number>;
  files: Record<string, { bytes: number; sha256: string }>;
  warnings: string[];
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

function formsOf(row: ScopeRow): string[] {
  const forms = new Set<string>();
  const push = (value: string | null | undefined): void => {
    const text = value?.trim();
    if (text) forms.add(text);
  };
  push(row.lemma);
  push(row.reading);
  for (const item of row.attributes.kanji ?? []) push(item.text);
  for (const item of row.attributes.kana ?? []) push(item.text);
  return [...forms];
}

function boundedGloss(text: string): string | null {
  return Array.from(text).length <= 500 ? text : null;
}

async function main(): Promise<void> {
  const cli = parseCli('gloss-harvest', process.argv.slice(2));
  const verifyDir = flag(cli, 'verify');
  if (verifyDir) {
    const counts: Record<string, number> = {};
    for (const file of ['candidates.jsonl', 'unresolved.jsonl']) {
      const lines = readFileSync(path.join(verifyDir, file), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '');
      for (const line of lines) {
        const candidate = parseGlossCandidate(JSON.parse(line));
        const key = `${file}:${candidate.classification}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    log(`== DB3-B1 verify ${verifyDir} ==`);
    for (const [key, value] of Object.entries(counts).sort()) {
      log(`  ${key}=${value}`);
    }
    return;
  }
  const url = requireUrl();
  const artifactDir = flag(cli, 'artifact-dir') ?? cli.manifestDir;
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const outDir = flag(cli, 'out') ?? path.join(artifactDir, `harvest-${stamp}`);
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
  const datasetFingerprint = inventory.summary?.fingerprint?.dataset_digest;
  if (!datasetFingerprint || !/^[a-f0-9]{64}$/.test(datasetFingerprint)) {
    throw new Error('Inventory thiếu dataset_digest hợp lệ');
  }

  const client = await connect(url);
  const warnings: string[] = [];
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

    const languages = await client.query<{ id: number; code: string }>(
      `SELECT id, code FROM public.language WHERE code IN ('en', 'ja', 'vi')`,
    );
    const langId = new Map(languages.rows.map((row) => [row.code, row.id]));
    const en = langId.get('en');
    if (en === undefined) throw new Error('Thiếu language en');

    const sources = await client.query<SourceRow>(
      `SELECT id, code, license, attribution, url, version, sha256 FROM public.source ORDER BY id`,
    );
    const sourceByCode = new Map(sources.rows.map((row) => [row.code, row]));
    const batches = await client.query<BatchRow>(
      `SELECT id::text, source_code FROM staging.import_batch ORDER BY id`,
    );
    const batchIds = new Map<string, string[]>();
    for (const batch of batches.rows) {
      const list = batchIds.get(batch.source_code) ?? [];
      list.push(batch.id);
      batchIds.set(batch.source_code, list);
    }

    const auditEvidence = {
      path: relativeArtifact(auditFile, artifactDir),
      sha256: auditSha,
    };

    const buildSource = (
      code: string,
      blockedReasons: string[],
    ): GlossSource => {
      const row = sourceByCode.get(code);
      if (!row) throw new Error(`Không thấy source ${code}`);
      const verified = blockedReasons.length === 0;
      return {
        sourceId: row.id,
        code: row.code,
        version: row.version,
        snapshot: verified
          ? `import-batch:${(batchIds.get(code) ?? []).join(',')}`
          : null,
        sha256: row.sha256,
        license: row.license,
        attribution: row.attribution,
        url: row.url,
        batchIds: batchIds.get(code) ?? [],
        audit: verified
          ? { status: 'verified', evidence: [auditEvidence], reasons: [] }
          : { status: 'blocked', evidence: [], reasons: blockedReasons },
      };
    };

    const jmdict = buildSource('jmdict', []);
    const wiktextract = buildSource('wiktextract', [
      'Thiếu version/snapshot; audit chưa xác minh (B0 source-audit).',
    ]);
    const omw = buildSource('omw-wikt-vi', [
      'License CC BY-SA chưa có số phiên bản; thiếu version/snapshot audit.',
    ]);

    // --- Scope + EN gloss ----------------------------------------------------
    const SCOPE = `
      WITH jl AS (
        SELECT lexeme_id, max(source_level)::int AS level
        FROM core.jlpt_link WHERE status = 'accepted' GROUP BY lexeme_id
      )`;
    const scopeRows = await client.query<ScopeRow & { level: number }>(
      `${SCOPE}
       SELECT s.id::text AS sense_id, s.sense_no, s.is_primary, s.external_id,
              s.register, s.domain,
              l.id::text AS lexeme_id, l.lemma, l.pos, l.reading, l.frequency_rank,
              l.attributes, jl.level
       FROM jl
       JOIN core.sense s ON s.lexeme_id = jl.lexeme_id
       JOIN core.lexeme l ON l.id = jl.lexeme_id
       ORDER BY jl.level, s.id`,
    );
    const glossRows = await client.query<GlossRow>(
      `${SCOPE}
       SELECT g.sense_id::text, g.id::text, g.rank, g.text, g.source_id, g.batch_id::text
       FROM jl
       JOIN core.sense s ON s.lexeme_id = jl.lexeme_id
       JOIN core.sense_gloss g ON g.sense_id = s.id AND g.language_id = $1
       ORDER BY g.sense_id, g.rank, g.id`,
      [en],
    );
    const glossBySense = new Map<string, GlossRow[]>();
    for (const row of glossRows.rows) {
      const list = glossBySense.get(row.sense_id) ?? [];
      list.push(row);
      glossBySense.set(row.sense_id, list);
    }

    // Snapshot drift check so B1 never reuses a stale B0 fingerprint silently.
    const expectedSenses = inventory.summary?.jlpt?.totals?.senses;
    const expectedEn = inventory.summary?.coverage?.en_gloss_senses;
    if (
      expectedSenses !== undefined &&
      expectedSenses !== scopeRows.rows.length
    ) {
      throw new Error(
        `Scope drift: B0 ghi ${expectedSenses} sense, hiện có ${scopeRows.rows.length}. Chạy lại B0.`,
      );
    }
    if (expectedEn !== undefined && expectedEn !== glossBySense.size) {
      throw new Error(
        `EN gloss drift: B0 ghi ${expectedEn} sense có gloss, hiện có ${glossBySense.size}. Chạy lại B0.`,
      );
    }

    const limit = cli.limit;
    const scope =
      limit === undefined ? scopeRows.rows : scopeRows.rows.slice(0, limit);

    const candidates: GlossCandidate[] = [];
    const unresolved: GlossCandidate[] = [];
    const counts = {
      needs_translation: 0,
      eligible_source: 0,
      ambiguous: 0,
      missing_context: 0,
      blocked_source: 0,
      skipped_by_limit: scopeRows.rows.length - scope.length,
    };

    for (const row of scope) {
      const contextRows = (glossBySense.get(row.sense_id) ?? []).map(
        (gloss) => ({
          kind: 'sense_gloss' as const,
          senseId: row.sense_id,
          glossId: gloss.id,
          rank: gloss.rank,
          language: 'en' as const,
          text: gloss.text,
          textHash: sha256(gloss.text),
          sourceCode: 'jmdict',
          batchId: gloss.batch_id,
        }),
      );
      if (contextRows.length === 0) {
        const input: GlossCandidateInput = {
          schemaVersion: 1,
          datasetFingerprint,
          target: null,
          context: null,
          sources: [],
          alignment: { method: 'none', evidenceKeys: [] },
          sourceGlossVi: null,
          notes: [`B1 missing context cho sense ${row.sense_id}`],
          classification: 'missing_context',
          blockedReasons: ['No usable EN gloss or definition.'],
        };
        unresolved.push(createGlossCandidate(input));
        counts.missing_context += 1;
        continue;
      }
      const input: GlossCandidateInput = {
        schemaVersion: 1,
        datasetFingerprint,
        target: {
          targetType: 'sense',
          targetId: row.sense_id,
          semanticKey: row.external_id,
          language: 'ja',
          lexemeId: row.lexeme_id,
          senseNo: row.sense_no,
          lemma: row.lemma,
          reading: row.reading,
          pos: row.pos,
          forms: formsOf(row),
          register: row.register,
          domain: row.domain,
          jlptLevel: row.level,
          isPrimary: row.is_primary,
        },
        context: {
          context_kind: 'sense_gloss_en',
          context_language: 'en',
          rows: contextRows,
        },
        sources: [jmdict],
        alignment: {
          method: 'same_sense_gloss',
          evidenceKeys: contextRows.map(
            (gloss) => `sense-gloss:${gloss.glossId}`,
          ),
        },
        sourceGlossVi: null,
        notes: ['B1 harvest: EN gloss cùng sense, chưa dịch, chưa review.'],
        classification: 'needs_translation',
        blockedReasons: [],
      };
      candidates.push(createGlossCandidate(input));
      counts.needs_translation += 1;
    }

    // --- Pivot lexical (ambiguous) -------------------------------------------
    const pivotRows = await client.query<PivotRow>(
      `WITH ja AS (
         SELECT ta.id, ta.source_lexeme_id, ta.sense_hint, ta.target_text, ta.source_id, ta.batch_id
         FROM core.translation_assertion ta
         JOIN core.lexeme lx ON lx.id = ta.source_lexeme_id
         JOIN public.language sl ON sl.id = lx.language_id AND sl.code = 'en'
         WHERE ta.target_language_id = $1 AND ta.scope = 'sense'
           AND btrim(coalesce(ta.sense_hint, '')) <> ''
       ),
       vi AS (
         SELECT ta.id, ta.source_lexeme_id, ta.sense_hint, ta.target_text
         FROM core.translation_assertion ta
         JOIN core.lexeme lx ON lx.id = ta.source_lexeme_id
         JOIN public.language sl ON sl.id = lx.language_id AND sl.code = 'en'
         WHERE ta.target_language_id = $2 AND ta.scope = 'sense'
           AND btrim(coalesce(ta.sense_hint, '')) <> ''
       )
       SELECT ja.target_text AS ja_text, vi.target_text AS vi_text,
              min(ja.id)::text AS ja_id, min(vi.id)::text AS vi_id,
              max(ja.source_id) AS source_id, max(ja.batch_id::text) AS batch_id
       FROM ja JOIN vi
         ON vi.source_lexeme_id = ja.source_lexeme_id AND vi.sense_hint = ja.sense_hint
       GROUP BY ja.target_text, vi.target_text
       ORDER BY ja_text, vi_text`,
      [langId.get('ja'), langId.get('vi')],
    );
    for (const row of pivotRows.rows) {
      const viText = boundedGloss(row.vi_text);
      const notes = [`pivot lexical: ${row.ja_text}`];
      if (viText === null)
        notes.push('VI text > 500 code point; giữ nguyên trong bảng gốc.');
      const input: GlossCandidateInput = {
        schemaVersion: 1,
        datasetFingerprint,
        target: null,
        context: null,
        sources: [wiktextract],
        alignment: {
          method: 'lexical_only',
          evidenceKeys: [`assertion:${row.ja_id}`, `assertion:${row.vi_id}`],
        },
        sourceGlossVi: viText,
        notes,
        classification: 'ambiguous',
        blockedReasons: [
          'Chỉ khớp pivot lexical; chưa có EN↔JA sense alignment.',
        ],
      };
      unresolved.push(createGlossCandidate(input));
      counts.ambiguous += 1;
    }

    // --- OMW concept gloss (blocked source) ----------------------------------
    const omwRows = await client.query<ConceptGlossRow>(
      `SELECT g.concept_id::text, g.rank, g.text, g.source_id, g.batch_id::text
       FROM core.concept_gloss g
       JOIN public.language l ON l.id = g.language_id AND l.code = 'vi'
       ORDER BY g.concept_id, g.rank`,
    );
    for (const row of omwRows.rows) {
      const input: GlossCandidateInput = {
        schemaVersion: 1,
        datasetFingerprint,
        target: null,
        context: null,
        sources: [omw],
        alignment: {
          method: 'direct_source',
          evidenceKeys: [`concept-gloss:${row.concept_id}:${row.rank}`],
        },
        sourceGlossVi: boundedGloss(row.text),
        notes: ['OMW lemma-like VI; chỉ để audit, không apply.'],
        classification: 'blocked_source',
        blockedReasons: [
          'Nguồn OMW chưa đủ version/snapshot; gloss nghi lemma, chờ curator/DB4.',
        ],
      };
      unresolved.push(createGlossCandidate(input));
      counts.blocked_source += 1;
    }

    // --- Ghi artifact ---------------------------------------------------------
    candidates.sort((a, b) => {
      const la =
        a.target?.targetType === 'sense' ? (a.target.jlptLevel ?? 9) : 9;
      const lb =
        b.target?.targetType === 'sense' ? (b.target.jlptLevel ?? 9) : 9;
      if (la !== lb) return la - lb;
      if (a.candidateKey < b.candidateKey) return -1;
      if (a.candidateKey > b.candidateKey) return 1;
      return 0;
    });
    unresolved.sort((a, b) => (a.candidateKey < b.candidateKey ? -1 : 1));

    const candidatesFile = path.join(outDir, 'candidates.jsonl');
    const unresolvedFile = path.join(outDir, 'unresolved.jsonl');
    const candidatesText = `${candidates.map((c) => JSON.stringify(c)).join('\n')}\n`;
    const unresolvedText = `${unresolved.map((c) => JSON.stringify(c)).join('\n')}\n`;
    writeFileSync(candidatesFile, candidatesText);
    writeFileSync(unresolvedFile, unresolvedText);

    const summary: Summary = {
      task: 'gloss-harvest',
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
      counts,
      files: {
        'candidates.jsonl': {
          bytes: Buffer.byteLength(candidatesText),
          sha256: sha256(candidatesText),
        },
        'unresolved.jsonl': {
          bytes: Buffer.byteLength(unresolvedText),
          sha256: sha256(unresolvedText),
        },
      },
      warnings,
    };
    writeFileSync(
      path.join(outDir, 'harvest-summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );

    log(`== DB3-B1 gloss-harvest (READ-ONLY) — db=${dbName} ==`);
    log(
      `  fingerprint=${datasetFingerprint.slice(0, 16)}… · inventory=${summary.inventory.path} · audit=${summary.sourceAudit.path}`,
    );
    log(
      `  candidates: needs_translation=${counts.needs_translation} · eligible=${counts.eligible_source}`,
    );
    log(
      `  unresolved: ambiguous=${counts.ambiguous} · blocked_source=${counts.blocked_source} · missing_context=${counts.missing_context}`,
    );
    log(
      `  files: candidates.jsonl ${summary.files['candidates.jsonl'].bytes}B ${summary.files['candidates.jsonl'].sha256.slice(0, 16)}… · unresolved.jsonl ${summary.files['unresolved.jsonl'].bytes}B ${summary.files['unresolved.jsonl'].sha256.slice(0, 16)}…`,
    );
    log(`out: ${outDir}`);
    for (const warning of warnings) log(`  ⚠ ${warning}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `gloss-harvest: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
