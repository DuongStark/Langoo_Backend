import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { parseMappingCli } from './_cli';

/**
 * DB4 D0 — inventory read-only cho mapping sense↔concept (plan db4-sense-concept-mapping.md).
 *
 * Xuất vào `<artifact-dir>/inventory/<stamp>/`:
 *  - inventory.json     : fingerprint, scope JLPT, candidate, review, view, export proposal
 *  - source-audit.json  : public.source + import batch/lien quan lexicons
 *  - legacy-audit.json  : candidate/review legacy theo method/prompt/artifact
 *
 * Không ghi DB; không gọi LLM.
 */

function requireUrl(): string {
  loadDotenv();
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url || url.trim() === '')
    throw new Error('Thiếu DIRECT_URL/DATABASE_URL');
  return url;
}

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

async function main(): Promise<void> {
  const cli = parseMappingCli('mapping-inventory', process.argv.slice(2));
  const url = requireUrl();
  const parsedUrl = new URL(url);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(cli.artifactDir, 'inventory', stamp);
  mkdirSync(outDir, { recursive: true });

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  try {
    const meta = await client.query<{
      db: string;
      server_version: string;
      migrations: number;
      latest_migration: string | null;
    }>(
      `SELECT current_database() AS db, version() AS server_version,
              (SELECT count(*)::int FROM public.schema_migration) AS migrations,
              (SELECT max(name) FROM public.schema_migration) AS latest_migration`,
    );

    const languages = await client.query<{
      code: string;
      lexemes: number;
      senses: number;
    }>(
      `SELECT l.code,
              (SELECT count(*)::int FROM core.lexeme x WHERE x.language_id = l.id) AS lexemes,
              (SELECT count(*)::int FROM core.sense s JOIN core.lexeme x ON x.id = s.lexeme_id WHERE x.language_id = l.id) AS senses
       FROM public.language l WHERE l.code IN ('ja','en','vi') ORDER BY lexemes DESC`,
    );

    const scope = await client.query<{
      lexemes: number;
      senses: number;
      primary: number;
      secondary: number;
    }>(
      `WITH jl AS (SELECT lexeme_id, max(source_level)::int lvl FROM core.jlpt_link WHERE status='accepted' GROUP BY lexeme_id)
       SELECT count(DISTINCT s.lexeme_id)::int AS lexemes, count(*)::int AS senses,
              count(*) FILTER (WHERE s.is_primary)::int AS primary,
              count(*) FILTER (WHERE NOT s.is_primary)::int AS secondary
       FROM jl JOIN core.sense s ON s.lexeme_id = jl.lexeme_id`,
    );

    // --- Legacy links --------------------------------------------------------
    const links = await client.query<{ code: string; rows: number }>(
      `SELECT s.code, count(*)::int AS rows
       FROM core.sense_concept sc JOIN public.source s ON s.id = sc.source_id
       GROUP BY 1 ORDER BY 2 DESC`,
    );
    const linkShape = await client.query<{
      relation: string;
      verified: boolean;
      rows: number;
    }>(
      `SELECT relation, verified, count(*)::int AS rows FROM core.sense_concept GROUP BY 1,2 ORDER BY 3 DESC`,
    );
    const linksJlpt = await client.query<{ rows: number }>(
      `WITH jl AS (SELECT lexeme_id FROM core.jlpt_link WHERE status='accepted' GROUP BY lexeme_id),
            scope AS (SELECT s.id FROM jl JOIN core.sense s ON s.lexeme_id = jl.lexeme_id)
       SELECT count(*)::int AS rows FROM core.sense_concept sc JOIN scope ON scope.id = sc.sense_id`,
    );

    // --- Candidates ----------------------------------------------------------
    const candidatesByLang = await client.query<{
      code: string | null;
      pairs: number;
      senses: number;
      concepts: number;
    }>(
      `SELECT l.code, count(*)::int AS pairs, count(DISTINCT c.sense_id)::int AS senses,
              count(DISTINCT c.concept_id)::int AS concepts
       FROM core.sense_concept_candidate c
       JOIN core.sense s ON s.id = c.sense_id
       JOIN core.lexeme x ON x.id = s.lexeme_id
       JOIN public.language l ON l.id = x.language_id
       GROUP BY 1 ORDER BY 2 DESC`,
    );
    const candidatesByMethodJa = await client.query<{
      method: string;
      pairs: number;
      senses: number;
      concepts: number;
    }>(
      `SELECT c.method, count(*)::int AS pairs, count(DISTINCT c.sense_id)::int AS senses,
              count(DISTINCT c.concept_id)::int AS concepts
       FROM core.sense_concept_candidate c
       JOIN core.sense s ON s.id = c.sense_id
       JOIN core.lexeme x ON x.id = s.lexeme_id
       JOIN public.language l ON l.id = x.language_id
       WHERE l.code = 'ja' GROUP BY 1 ORDER BY 2 DESC`,
    );
    const jlptCandidates = await client.query<{
      pairs: number;
      senses: number;
      senses_without: number;
    }>(
      `WITH jl AS (SELECT lexeme_id FROM core.jlpt_link WHERE status='accepted' GROUP BY lexeme_id),
            scope AS (SELECT s.id FROM jl JOIN core.sense s ON s.lexeme_id = jl.lexeme_id),
            per_sense AS (SELECT sc.id, count(c.id)::int AS n FROM scope sc LEFT JOIN core.sense_concept_candidate c ON c.sense_id = sc.id GROUP BY 1)
       SELECT (SELECT coalesce(sum(n),0)::int FROM per_sense) AS pairs,
              (SELECT count(*)::int FROM per_sense WHERE n > 0) AS senses,
              (SELECT count(*)::int FROM per_sense WHERE n = 0) AS senses_without`,
    );
    const pairsHistogram = await client.query<{ n: string; senses: number }>(
      `WITH jl AS (SELECT lexeme_id FROM core.jlpt_link WHERE status='accepted' GROUP BY lexeme_id),
            scope AS (SELECT s.id FROM jl JOIN core.sense s ON s.lexeme_id = jl.lexeme_id)
       SELECT cnt::text AS n, count(*)::int AS senses FROM (
         SELECT sc.id, count(c.id)::int AS cnt FROM scope sc LEFT JOIN core.sense_concept_candidate c ON c.sense_id = sc.id GROUP BY 1
       ) t GROUP BY 1 ORDER BY 1`,
    );
    const evidenceKeys = await client.query<{ key: string; rows: number }>(
      `SELECT key, count(*)::int AS rows FROM (
         SELECT jsonb_object_keys(evidence) AS key FROM core.sense_concept_candidate
       ) t GROUP BY 1 ORDER BY 2 DESC`,
    );
    const evidenceSample = await client.query<{ evidence: string }>(
      `SELECT evidence::text FROM core.sense_concept_candidate ORDER BY id LIMIT 1`,
    );

    // --- Legacy reviews ------------------------------------------------------
    const reviewsBy = await client.query<{
      reviewer: string;
      question_type: string;
      prompt_version: string | null;
      rows: number;
    }>(
      `SELECT reviewer, question_type, prompt_version, count(*)::int AS rows
       FROM core.sense_concept_candidate_review
       GROUP BY 1,2,3 ORDER BY 4 DESC`,
    );
    const reviewArtifacts = await client.query<{
      total: number;
      with_hash: number;
      with_relation: number;
    }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE artifact_hash IS NOT NULL)::int AS with_hash,
              count(*) FILTER (WHERE relation IS NOT NULL)::int AS with_relation
       FROM core.sense_concept_candidate_review`,
    );
    const reviewResultKeys = await client.query<{ key: string; rows: number }>(
      `SELECT key, count(*)::int AS rows FROM (
         SELECT jsonb_object_keys(result) AS key FROM core.sense_concept_candidate_review
       ) t GROUP BY 1 ORDER BY 2 DESC`,
    );
    const reviewRelation = await client.query<{
      relation: string | null;
      rows: number;
    }>(
      `SELECT relation, count(*)::int AS rows
       FROM core.sense_concept_candidate_review GROUP BY 1 ORDER BY 2 DESC`,
    );
    const reviewRuns = await client.query<Record<string, unknown>>(
      `SELECT r.mapping_run_id, mr.task, mr.algorithm, mr.model, mr.prompt_version, mr.status,
              count(*)::int AS reviews, count(r.relation)::int AS with_relation,
              count(r.artifact_hash)::int AS with_hash
       FROM core.sense_concept_candidate_review r
       JOIN core.mapping_run mr ON mr.id = r.mapping_run_id
       GROUP BY 1,2,3,4,5,6 ORDER BY reviews DESC LIMIT 15`,
    );
    const candidateLlmResult = await client.query<{
      not_empty: number;
      total: number;
    }>(
      `SELECT count(*) FILTER (WHERE llm_result <> '{}'::jsonb)::int AS not_empty,
              count(*)::int AS total
       FROM core.sense_concept_candidate`,
    );

    // --- Sources -------------------------------------------------------------
    const sources = await client.query<Record<string, unknown>>(
      `SELECT id, code, name, license, attribution, url, version, sha256, imported_at::text
       FROM public.source ORDER BY id`,
    );
    const batches = await client.query<Record<string, unknown>>(
      `SELECT id::text, source_code, file_name, row_count, sha256, started_at::text, finished_at::text, status
       FROM staging.import_batch
       WHERE source_code IN ('wordnet-stack','oewn','omw-en','omw-ja','cili','jmdict','jlpt-list')
       ORDER BY source_code, started_at`,
    );
    const lexicons = await client.query<{ lexicon: string; rows: number }>(
      `SELECT lexicon, count(*)::int AS rows FROM staging.wn_synset GROUP BY 1 ORDER BY 2 DESC`,
    );
    const conceptGlossByLang = await client.query<{
      code: string;
      rows: number;
    }>(
      `SELECT l.code, count(*)::int AS rows FROM core.concept_gloss g JOIN public.language l ON l.id = g.language_id GROUP BY 1 ORDER BY 2 DESC`,
    );

    // --- View audit ----------------------------------------------------------
    const viewDef = await client.query<{ def: string }>(
      `SELECT pg_get_viewdef('serve.sense_pair'::regclass, true) AS def`,
    );
    const viewIndexes = await client.query<{
      indexname: string;
      indexdef: string;
    }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='serve' AND tablename='sense_pair'`,
    );
    const viewDependents = await client.query<{ dependent: string }>(
      `SELECT DISTINCT dependent_ns.nspname || '.' || dependent_view.relname AS dependent
       FROM pg_depend d
       JOIN pg_rewrite r ON r.oid = d.objid
       JOIN pg_class dependent_view ON dependent_view.oid = r.ev_class
       JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
       WHERE d.refobjid = 'serve.sense_pair'::regclass AND dependent_view.relname <> 'sense_pair'`,
    );

    const fingerprint = {
      db: meta.rows[0].db,
      host: parsedUrl.hostname,
      port: parsedUrl.port || '5432',
      server_version: meta.rows[0].server_version,
      migrations: meta.rows[0].migrations,
      latest_migration: meta.rows[0].latest_migration,
      generated_at: new Date().toISOString(),
    };
    const inventory = {
      task: 'db4-inventory',
      fingerprint,
      languages: languages.rows,
      scope_jlpt: scope.rows[0],
      legacy_links: {
        total: linkShape.rows.reduce((sum, row) => sum + row.rows, 0),
        by_source: links.rows,
        by_relation_verified: linkShape.rows,
        jlpt_rows: linksJlpt.rows[0].rows,
      },
      candidates: {
        by_sense_language: candidatesByLang.rows,
        ja_by_method: candidatesByMethodJa.rows,
        jlpt: jlptCandidates.rows[0],
        pairs_per_sense_histogram: pairsHistogram.rows,
        evidence_keys: evidenceKeys.rows,
        evidence_sample: evidenceSample.rows[0]?.evidence ?? null,
      },
      legacy_reviews: {
        by_prompt: reviewsBy.rows,
        artifacts: reviewArtifacts.rows[0],
        result_keys: reviewResultKeys.rows,
        relation_distribution: reviewRelation.rows,
        runs: reviewRuns.rows,
        candidate_llm_result: candidateLlmResult.rows[0],
      },
      view_audit: {
        sense_pair_definition: viewDef.rows[0]?.def ?? null,
        indexes: viewIndexes.rows,
        dependents: viewDependents.rows,
      },
      export_proposal: {
        jlpt_targets: scope.rows[0].senses,
        jlpt_candidates: jlptCandidates.rows[0].pairs,
        concept_gloss_by_language: conceptGlossByLang.rows,
      },
    };
    const sourceAudit = {
      task: 'db4-source-audit',
      generated_at: fingerprint.generated_at,
      sources: sources.rows,
      import_batches: batches.rows,
      wn_lexicons: lexicons.rows,
      notes: [
        'OMW EN/JA và OEWN cần audit license/version riêng trước khi dùng trong generation/apply (plan §6.3).',
        'source #16 wordnet-stack ghi gộp CILI+OEWN+omw-ja+omw-en; cần snapshot/hash từng lexicon.',
      ],
    };
    const legacyAudit = {
      task: 'db4-legacy-audit',
      generated_at: fingerprint.generated_at,
      reviews_by_prompt: reviewsBy.rows,
      artifact_stats: reviewArtifacts.rows[0],
      review_result_keys: reviewResultKeys.rows,
      relation_distribution: reviewRelation.rows,
      review_runs: reviewRuns.rows,
      candidate_llm_result: candidateLlmResult.rows[0],
      evidence_keys: evidenceKeys.rows,
      notes: [
        'Review legacy reviewer=jev-1.13-free; cần resolve artifact_hash → file thật trước khi tái sử dụng.',
        'evidence của candidate không chứa source_code; cần đọc cấu trúc evidence gốc.',
      ],
    };

    const inventoryText = `${JSON.stringify(inventory, null, 2)}\n`;
    const sourceText = `${JSON.stringify(sourceAudit, null, 2)}\n`;
    const legacyText = `${JSON.stringify(legacyAudit, null, 2)}\n`;
    writeFileSync(path.join(outDir, 'inventory.json'), inventoryText);
    writeFileSync(path.join(outDir, 'source-audit.json'), sourceText);
    writeFileSync(path.join(outDir, 'legacy-audit.json'), legacyText);

    console.log(`== DB4 D0 inventory (READ-ONLY) — db=${fingerprint.db} ==`);
    console.log(
      `  fingerprint: ${fingerprint.db}@${fingerprint.host}:${fingerprint.port} · migrations=${fingerprint.migrations} (${fingerprint.latest_migration ?? '?'})`,
    );
    console.log(
      `  scope JLPT: ${scope.rows[0].senses} sense (${scope.rows[0].primary} primary / ${scope.rows[0].secondary} secondary)`,
    );
    console.log(
      `  legacy links: ${inventory.legacy_links.total} (JLPT ${inventory.legacy_links.jlpt_rows})`,
    );
    console.log(
      `  candidates: JLPT ${jlptCandidates.rows[0].pairs} pair / ${jlptCandidates.rows[0].senses} sense (thiếu ${jlptCandidates.rows[0].senses_without})`,
    );
    for (const row of candidatesByLang.rows) {
      console.log(`    ${row.code}: ${row.pairs} pair / ${row.senses} sense`);
    }
    console.log(
      `  legacy reviews: ${reviewArtifacts.rows[0].total} (hash ${reviewArtifacts.rows[0].with_hash})`,
    );
    console.log(
      `  sense_pair dependents: ${viewDependents.rows.length} · indexes: ${viewIndexes.rows.map((row) => row.indexname).join(', ')}`,
    );
    console.log(`out: ${outDir}`);
    console.log(`inventory sha256: ${sha256(inventoryText).slice(0, 16)}…`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `mapping-inventory: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
