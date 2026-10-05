import {
  connect,
  dbNameOf,
  log,
  parseCli,
  requireUrl,
  sha256,
  writeManifest,
} from './_shared';

/**
 * DB3-B0 — kiểm kê gloss/nguồn cho pilot dịch VI (READ-ONLY, không ghi DB).
 *
 * Xuất 2 artifact JSON vào `--artifact-dir` (mặc định = manifest-dir):
 *  - `gloss-inventory`: fingerprint dataset, phạm vi JLPT, coverage EN/VI theo sense,
 *    count từng rule §4.1, phân lớp §4.5, concept, số liệu EXPLAIN.
 *  - `source-audit`: public.source + staging.import_batch + check license/version,
 *    nguồn EN gloss của tập ưu tiên, cảnh báo gloss cũ dạng lemma.
 *
 * Không ghi bảng nghiệp vụ; an toàn chạy trên bản full read-only.
 */

const SCOPE_CTE = `
WITH jl AS (
  SELECT lexeme_id, max(source_level)::int AS level
  FROM core.jlpt_link
  WHERE status = 'accepted'
  GROUP BY lexeme_id
),
scope AS (
  SELECT s.id AS sense_id, s.lexeme_id, jl.level, s.is_primary,
         (s.definition IS NOT NULL AND btrim(s.definition) <> '') AS has_definition
  FROM jl
  JOIN core.sense s ON s.lexeme_id = jl.lexeme_id
)`;

interface LevelRow {
  level: number;
  lexemes: number;
  senses: number;
  primary_senses: number;
  with_definition: number;
}

interface CountRow {
  count: number;
}

interface SourceGlossRow {
  source_id: number | null;
  rows: number;
  senses: number;
}

interface SourceRow {
  id: number;
  code: string;
  name: string;
  license: string | null;
  attribution: string | null;
  url: string | null;
  version: string | null;
  sha256: string | null;
  imported_at: string | null;
}

interface BatchRow {
  id: string;
  source_code: string;
  file_name: string;
  sha256: string;
  row_count: number | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface AssertionRuleRow {
  src: string;
  tgt: string;
  scope: string;
  rows: number;
  with_source_sense: number;
  with_hint: number;
}

interface CandidateRow {
  decision: string;
  rows: number;
  with_target_sense: number;
}

interface ConceptGlossRow {
  source_id: number | null;
  is_machine: boolean;
  rows: number;
  concepts: number;
}

interface LabelRow {
  label_kind: string;
  is_machine: boolean;
  rows: number;
  concepts: number;
}

interface RelationLangRow {
  other_lang: string;
  senses: number;
}

function artifactDirOf(cli: ReturnType<typeof parseCli>): string {
  const value = cli.flags.get('artifact-dir');
  return typeof value === 'string' && value.trim() !== ''
    ? value
    : cli.manifestDir;
}

async function explain(
  client: import('pg').Client,
  sql: string,
  params: unknown[] = [],
): Promise<{ execution_ms: number | null; plan: string[] }> {
  const result = await client.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
    params,
  );
  const plan = result.rows.map((row) => row['QUERY PLAN']);
  const execLine = plan.find((line) =>
    line.trim().startsWith('Execution Time'),
  );
  const parsed = execLine ? Number(execLine.replace(/[^\d.]/g, '')) : null;
  return {
    execution_ms: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    plan: plan.slice(0, 40),
  };
}

async function main(): Promise<void> {
  const cli = parseCli('gloss-inventory', process.argv.slice(2));
  const url = requireUrl();
  const parsedUrl = new URL(url);
  const artifactDir = artifactDirOf(cli);
  const client = await connect(url);

  try {
    const startedAt = new Date().toISOString();
    const meta = await client.query<{
      db: string;
      server_version: string;
      migrations: number;
      latest_migration: string | null;
    }>(
      `SELECT current_database() AS db,
              version() AS server_version,
              (SELECT count(*)::int FROM public.schema_migration) AS migrations,
              (SELECT max(name) FROM public.schema_migration) AS latest_migration`,
    );

    const languages = await client.query<{ id: number; code: string }>(
      `SELECT id, code FROM public.language WHERE code IN ('en', 'ja', 'vi')`,
    );
    const langId = new Map(languages.rows.map((row) => [row.code, row.id]));
    const en = langId.get('en');
    const ja = langId.get('ja');
    const vi = langId.get('vi');
    if (en === undefined || ja === undefined || vi === undefined) {
      throw new Error('Thiếu language code en/ja/vi');
    }

    // --- Phạm vi JLPT ---------------------------------------------------------
    const byLevel = await client.query<LevelRow>(
      `${SCOPE_CTE}
       SELECT level, count(DISTINCT lexeme_id)::int AS lexemes,
              count(*)::int AS senses,
              count(*) FILTER (WHERE is_primary)::int AS primary_senses,
              count(*) FILTER (WHERE has_definition)::int AS with_definition
       FROM scope GROUP BY level ORDER BY level`,
    );
    const scopeTotals = await client.query<{
      lexemes: number;
      senses: number;
      primary_senses: number;
      lexemes_with_non_primary: number;
      lexemes_without_primary: number;
    }>(
      `${SCOPE_CTE}
       SELECT count(DISTINCT lexeme_id)::int AS lexemes,
              count(*)::int AS senses,
              count(*) FILTER (WHERE is_primary)::int AS primary_senses,
              count(DISTINCT lexeme_id) FILTER (WHERE NOT is_primary)::int AS lexemes_with_non_primary,
              (count(DISTINCT lexeme_id) - count(DISTINCT lexeme_id) FILTER (WHERE is_primary))::int AS lexemes_without_primary
       FROM scope`,
    );
    const multiLevel = await client.query<CountRow>(
      `SELECT count(*)::int AS count FROM (
         SELECT lexeme_id FROM core.jlpt_link
         WHERE status = 'accepted' AND lexeme_id IS NOT NULL
         GROUP BY lexeme_id HAVING count(DISTINCT source_level) > 1
       ) t`,
    );

    // --- Coverage EN/VI theo sense -------------------------------------------
    const enCoverage = await client.query<{
      rows: number;
      senses: number;
      primary_senses: number;
    }>(
      `${SCOPE_CTE}
       SELECT count(*)::int AS rows, count(DISTINCT sc.sense_id)::int AS senses,
              count(DISTINCT sc.sense_id) FILTER (WHERE sc.is_primary)::int AS primary_senses
       FROM scope sc
       JOIN core.sense_gloss g ON g.sense_id = sc.sense_id AND g.language_id = $1`,
      [en],
    );
    const enBySource = await client.query<SourceGlossRow>(
      `${SCOPE_CTE}
       SELECT g.source_id, count(*)::int AS rows, count(DISTINCT g.sense_id)::int AS senses
       FROM scope sc
       JOIN core.sense_gloss g ON g.sense_id = sc.sense_id AND g.language_id = $1
       GROUP BY 1 ORDER BY 2 DESC`,
      [en],
    );
    const enByLevel = await client.query<{ level: number; senses: number }>(
      `${SCOPE_CTE}
       SELECT sc.level, count(DISTINCT sc.sense_id)::int AS senses
       FROM scope sc
       JOIN core.sense_gloss g ON g.sense_id = sc.sense_id AND g.language_id = $1
       GROUP BY 1 ORDER BY 1`,
      [en],
    );
    const viCoverage = await client.query<CountRow>(
      `${SCOPE_CTE}
       SELECT count(DISTINCT sc.sense_id)::int AS count
       FROM scope sc
       JOIN core.sense_gloss g ON g.sense_id = sc.sense_id AND g.language_id = $1`,
      [vi],
    );
    const missingEn = await client.query<CountRow>(
      `${SCOPE_CTE}
       SELECT count(*)::int AS count FROM scope sc
       WHERE NOT EXISTS (
         SELECT 1 FROM core.sense_gloss g
         WHERE g.sense_id = sc.sense_id AND g.language_id = $1
       )`,
      [en],
    );
    const relationsByLang = await client.query<RelationLangRow>(
      `${SCOPE_CTE}
       SELECT oln.code AS other_lang, count(DISTINCT sc.sense_id)::int AS senses
       FROM scope sc
       JOIN core.sense_relation r
         ON r.source_sense_id = sc.sense_id OR r.target_sense_id = sc.sense_id
       JOIN core.sense os
         ON os.id = CASE WHEN r.source_sense_id = sc.sense_id
                         THEN r.target_sense_id ELSE r.source_sense_id END
       JOIN core.lexeme ol ON ol.id = os.lexeme_id
       JOIN public.language oln ON oln.id = ol.language_id
       GROUP BY 1 ORDER BY 2 DESC`,
    );

    // --- Rule §4.1 -----------------------------------------------------------
    const assertions = await client.query<AssertionRuleRow>(
      `SELECT sl.code AS src, tl.code AS tgt, ta.scope,
              count(*)::int AS rows,
              count(*) FILTER (WHERE ta.source_sense_id IS NOT NULL)::int AS with_source_sense,
              count(*) FILTER (WHERE btrim(coalesce(ta.sense_hint, '')) <> '')::int AS with_hint
       FROM core.translation_assertion ta
       JOIN core.lexeme lx ON lx.id = ta.source_lexeme_id
       JOIN public.language sl ON sl.id = lx.language_id
       JOIN public.language tl ON tl.id = ta.target_language_id
       GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    );
    const candidates = await client.query<CandidateRow>(
      `SELECT decision, count(*)::int AS rows,
              count(*) FILTER (WHERE target_sense_id IS NOT NULL)::int AS with_target_sense
       FROM core.translation_target_candidate GROUP BY 1 ORDER BY 2 DESC`,
    );
    const pivotSql = (senseOnly: boolean): string => `
      WITH ja AS (
        SELECT DISTINCT ta.source_lexeme_id, ta.sense_hint
        FROM core.translation_assertion ta
        JOIN core.lexeme lx ON lx.id = ta.source_lexeme_id
        JOIN public.language sl ON sl.id = lx.language_id
        WHERE sl.code = 'en' AND ta.target_language_id = $1
          AND btrim(coalesce(ta.sense_hint, '')) <> ''
          ${senseOnly ? "AND ta.scope = 'sense'" : ''}
      ),
      vi AS (
        SELECT DISTINCT ta.source_lexeme_id, ta.sense_hint
        FROM core.translation_assertion ta
        JOIN core.lexeme lx ON lx.id = ta.source_lexeme_id
        JOIN public.language sl ON sl.id = lx.language_id
        WHERE sl.code = 'en' AND ta.target_language_id = $2
          AND btrim(coalesce(ta.sense_hint, '')) <> ''
          ${senseOnly ? "AND ta.scope = 'sense'" : ''}
      )
      SELECT count(*)::int AS pairs,
             count(DISTINCT ja.source_lexeme_id)::int AS source_lexemes
      FROM ja JOIN vi
        ON vi.source_lexeme_id = ja.source_lexeme_id AND vi.sense_hint = ja.sense_hint`;
    const pivotAll = await client.query<{
      pairs: number;
      source_lexemes: number;
    }>(pivotSql(false), [ja, vi]);
    const pivotSense = await client.query<{
      pairs: number;
      source_lexemes: number;
    }>(pivotSql(true), [ja, vi]);

    // --- Nguồn ---------------------------------------------------------------
    const sources = await client.query<SourceRow>(
      `SELECT id, code, name, license, attribution, url, version, sha256, imported_at::text
       FROM public.source ORDER BY id`,
    );
    const batches = await client.query<BatchRow>(
      `SELECT id::text, source_code, file_name, sha256, row_count, status,
              started_at::text, finished_at::text
       FROM staging.import_batch ORDER BY source_code, started_at`,
    );

    // --- Concept -------------------------------------------------------------
    const conceptTotals = await client.query<{
      total: number;
      with_gloss_en: number;
      with_cache_vi: number;
    }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE gloss_en IS NOT NULL AND btrim(gloss_en) <> '')::int AS with_gloss_en,
              count(*) FILTER (WHERE gloss_vi IS NOT NULL AND btrim(gloss_vi) <> '')::int AS with_cache_vi
       FROM core.concept`,
    );
    const conceptGlossVi = await client.query<ConceptGlossRow>(
      `SELECT g.source_id, g.is_machine, count(*)::int AS rows,
              count(DISTINCT g.concept_id)::int AS concepts
       FROM core.concept_gloss g
       JOIN public.language l ON l.id = g.language_id
       WHERE l.code = 'vi'
       GROUP BY 1, 2 ORDER BY 3 DESC`,
    );
    const conceptLabelVi = await client.query<LabelRow>(
      `SELECT g.label_kind, g.is_machine, count(*)::int AS rows,
              count(DISTINCT g.concept_id)::int AS concepts
       FROM core.concept_label g
       JOIN public.language l ON l.id = g.language_id
       WHERE l.code = 'vi'
       GROUP BY 1, 2 ORDER BY 3 DESC`,
    );
    const suspectLemmaGloss = await client.query<CountRow>(
      `SELECT count(*)::int AS count
       FROM core.concept_gloss g
       JOIN core.concept_label c
         ON c.concept_id = g.concept_id AND c.language_id = g.language_id
        AND lower(btrim(c.text)) = lower(btrim(g.text))
       WHERE g.language_id = $1`,
      [vi],
    );
    const conceptSample = await client.query<{
      concept_id: string;
      text: string;
    }>(
      `SELECT concept_id::text, text FROM core.concept_gloss
       WHERE language_id = $1 ORDER BY concept_id LIMIT 5`,
      [vi],
    );

    // --- Hiệu năng -----------------------------------------------------------
    const explainLevel = await explain(
      client,
      `${SCOPE_CTE}
       SELECT level, count(DISTINCT lexeme_id)::int AS lexemes,
              count(*)::int AS senses,
              count(*) FILTER (WHERE is_primary)::int AS primary_senses,
              count(*) FILTER (WHERE has_definition)::int AS with_definition
       FROM scope GROUP BY level ORDER BY level`,
    );
    const explainPivot = await explain(client, pivotSql(false), [ja, vi]);

    // --- Checks nguồn --------------------------------------------------------
    const missingVersion = sources.rows.filter((row) => !row.version);
    const toVerify = sources.rows.filter(
      (row) => row.license !== null && row.license.includes('CẦN XÁC MINH'),
    );
    const missingLicense = sources.rows.filter(
      (row) => !row.license || row.license.trim() === '',
    );
    const missingAttribution = sources.rows.filter(
      (row) => !row.attribution || row.attribution.trim() === '',
    );
    const missingUrl = sources.rows.filter(
      (row) => !row.url || row.url.trim() === '',
    );

    const fingerprint = {
      db: meta.rows[0].db,
      host: parsedUrl.hostname,
      port: parsedUrl.port || '5432',
      server_version: meta.rows[0].server_version,
      migrations: meta.rows[0].migrations,
      latest_migration: meta.rows[0].latest_migration,
      source_hashes: sources.rows
        .filter((row) => row.sha256)
        .map((row) => `${row.code}:${row.sha256?.slice(0, 16) ?? ''}`),
    };
    const datasetDigest = sha256(
      JSON.stringify({
        scope: scopeTotals.rows[0],
        en: enCoverage.rows[0],
        vi: viCoverage.rows[0].count,
        sources: fingerprint.source_hashes,
        migrations: fingerprint.migrations,
      }),
    );

    const inventory = {
      fingerprint: { ...fingerprint, dataset_digest: datasetDigest },
      jlpt: {
        by_level: byLevel.rows,
        totals: scopeTotals.rows[0],
        multi_level_lexemes: multiLevel.rows[0].count,
      },
      coverage: {
        en_gloss_rows: enCoverage.rows[0].rows,
        en_gloss_senses: enCoverage.rows[0].senses,
        en_gloss_primary_senses: enCoverage.rows[0].primary_senses,
        en_by_source: enBySource.rows,
        en_by_level: enByLevel.rows,
        vi_gloss_senses: viCoverage.rows[0].count,
        missing_en_gloss_senses: missingEn.rows[0].count,
        relations_by_other_lang: relationsByLang.rows,
      },
      rules: {
        assertions: assertions.rows,
        candidates: candidates.rows,
        pivot_pairs_all: pivotAll.rows[0],
        pivot_pairs_sense_scope: pivotSense.rows[0],
        eligible_source_senses: viCoverage.rows[0].count,
        needs_translation_senses: enCoverage.rows[0].senses,
        missing_context_senses: missingEn.rows[0].count,
      },
      concepts: {
        totals: conceptTotals.rows[0],
        gloss_vi_by_source: conceptGlossVi.rows,
        label_vi_by_kind: conceptLabelVi.rows,
        suspect_lemma_as_gloss: suspectLemmaGloss.rows[0].count,
        sample_gloss_vi: conceptSample.rows,
      },
      performance: {
        explain_level: explainLevel,
        explain_pivot: explainPivot,
      },
    };

    const sourceAudit = {
      sources: sources.rows,
      import_batches: batches.rows,
      checks: {
        missing_license: missingLicense.map((row) => row.code),
        license_to_verify: toVerify.map((row) => row.code),
        missing_version: missingVersion.map((row) => row.code),
        missing_attribution: missingAttribution.map((row) => row.code),
        missing_url: missingUrl.map((row) => row.code),
      },
      en_gloss_sources_in_scope: enBySource.rows,
      vi_concept_gloss_sources: conceptGlossVi.rows,
      suspect_lemma_as_gloss: {
        count: suspectLemmaGloss.rows[0].count,
        sample: conceptSample.rows,
      },
    };

    const inventoryFile = writeManifest(artifactDir, {
      task: 'gloss-inventory',
      startedAt,
      applied: false,
      db: dbNameOf(url),
      inputs: { direct_url_host: fingerprint.host },
      summary: inventory,
      warnings: [
        `DB3_AI_MAX_COST cap: xem plan §5.1`,
        `Đích VPS phải đối chiếu fingerprint trước khi apply`,
      ],
    });
    const auditFile = writeManifest(artifactDir, {
      task: 'source-audit',
      startedAt,
      applied: false,
      db: dbNameOf(url),
      summary: sourceAudit,
    });

    log(`== DB3-B0 gloss-inventory (READ-ONLY) — db=${dbNameOf(url)} ==`);
    log(
      `  fingerprint: ${fingerprint.db}@${fingerprint.host}:${fingerprint.port} · migrations=${fingerprint.migrations} (${fingerprint.latest_migration ?? '?'}) · digest=${datasetDigest.slice(0, 16)}`,
    );
    for (const row of byLevel.rows) {
      log(
        `  N${row.level}: lexemes=${row.lexemes} senses=${row.senses} primary=${row.primary_senses} definition=${row.with_definition}`,
      );
    }
    log(
      `  scope: ${scopeTotals.rows[0].senses} sense · ${scopeTotals.rows[0].primary_senses} primary · ${multiLevel.rows[0].count} lexeme đa cấp`,
    );
    log(
      `  EN gloss: ${enCoverage.rows[0].rows} dòng / ${enCoverage.rows[0].senses} sense (source: ${enBySource.rows.map((row) => `#${row.source_id}×${row.senses}`).join(', ')})`,
    );
    log(
      `  VI gloss: ${viCoverage.rows[0].count} sense · thiếu EN gloss: ${missingEn.rows[0].count} · relation: ${relationsByLang.rows.map((row) => `${row.other_lang}=${row.senses}`).join(', ') || '∅'}`,
    );
    log(
      `  rules: pivot(all)=${pivotAll.rows[0].pairs} cặp, pivot(sense)=${pivotSense.rows[0].pairs} cặp, candidates=${candidates.rows.map((row) => `${row.decision}=${row.rows}`).join(', ')}`,
    );
    log(
      `  concept: ${conceptTotals.rows[0].total} · cache VI=${conceptTotals.rows[0].with_cache_vi} · gloss VI nghi lemma=${suspectLemmaGloss.rows[0].count}`,
    );
    log(
      `  nguồn: thiếu version=${missingVersion.length} [${missingVersion.map((row) => row.code).join(', ')}] · CẦN XÁC MINH=${toVerify.map((row) => row.code).join(', ') || '∅'}`,
    );
    log(
      `  perf: level=${explainLevel.execution_ms ?? '?'}ms · pivot=${explainPivot.execution_ms ?? '?'}ms`,
    );
    log(`inventory: ${inventoryFile}`);
    log(`source-audit: ${auditFile}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `gloss-inventory: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
