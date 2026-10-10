// DB4-D2 read-only adapter CLI; separate from the frozen D1 orchestration CLI.
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { z } from 'zod';
import {
  Evidence,
  MappingSource,
  TextRow,
  canonicalJson,
  conceptSemanticKey,
  hashJson,
  semanticInputFingerprint,
  senseSemanticKey,
  textRowHash,
} from './_mapping-types';
import {
  ExportManifestSchema,
  RETRIEVAL_VERSION,
  RetrievalConceptSchema,
  RetrievalSenseSchema,
  artifactPath,
  cliFlags,
  positiveFlag,
  writeJson,
} from './_retrieval';

const SourceRow = z.object({
  id: z.number(),
  code: z.string(),
  version: z.string().nullable(),
  license: z.string(),
  attribution: z.string(),
  url: z.string().nullable(),
  sha256: z.string().nullable(),
  batches: z.array(
    z.object({
      id: z.string(),
      sha256: z.string(),
      status: z.string().nullable(),
    }),
  ),
});
const GlossRow = z.object({
  id: z.string().nullable(),
  rank: z.number(),
  text: z.string(),
  language: z.string().nullable(),
  source_id: z.number().nullable(),
  batch_id: z.string().nullable(),
  path: z.string(),
});
const RawSense = z.object({
  id: z.string(),
  lexeme_id: z.string(),
  external_id: z.string().nullable(),
  lexeme_external_id: z.string().nullable(),
  lemma: z.string(),
  reading: z.string().nullable(),
  language: z.string(),
  sense_no: z.number(),
  is_primary: z.boolean(),
  pos: z.string(),
  source_id: z.number().nullable(),
  batch_id: z.string().nullable(),
  attributes: z.record(z.unknown()),
  lexeme_attributes: z.record(z.unknown()),
  register: z.string().nullable(),
  domain: z.string().nullable(),
  level: z.number().nullable(),
  forms: z.array(z.string()),
  glosses: z.array(GlossRow),
  definitions: z.array(GlossRow),
  normalized_pos: z.array(z.string()),
  seeds: z.array(z.string()),
  links: z.array(
    z.object({
      conceptId: z.string(),
      relation: z.string(),
      method: z.string(),
      verified: z.boolean(),
      sourceId: z.number().nullable(),
      batchId: z.string().nullable(),
    }),
  ),
});
const RawConcept = z.object({
  id: z.string(),
  ili: z.string().nullable(),
  pos: z.string().nullable(),
  synsets: z.array(
    z.object({
      lexicon: z.string(),
      synset_id: z.string(),
      source_id: z.number(),
      batch_id: z.string().nullable(),
    }),
  ),
  definitions: z.array(GlossRow),
  labels: z.array(GlossRow),
});
type RawSource = z.infer<typeof SourceRow>;
const lexicalSort = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string' && !!x.trim())
    : [];
}
function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((x: unknown) => (typeof x === 'string' ? x : canonicalJson(x)))
    : [];
}
function streamFile(root: string, path: string) {
  const target = artifactPath(root, path);
  mkdirSync(dirname(target), { recursive: true });
  const fd = openSync(target, 'wx', 0o600);
  const hash = createHash('sha256');
  let count = 0;
  return {
    append(value: unknown) {
      canonicalJson(value);
      const line = JSON.stringify(value) + '\n';
      writeSync(fd, line);
      hash.update(line);
      count++;
    },
    finish() {
      fsyncSync(fd);
      closeSync(fd);
      return { ref: { path, sha256: hash.digest('hex') }, count };
    },
    close() {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    },
  };
}
function sourceRegistry(rows: RawSource[]): MappingSource[] {
  return rows
    .map((r) => ({
      key: r.code,
      sourceId: r.id,
      code: r.code,
      version: r.version,
      snapshot: null,
      sha256: r.sha256,
      license: r.license,
      attribution: r.attribution,
      url: r.url,
      batchIds: r.batches
        .filter(
          (b) =>
            b.sha256 === r.sha256 &&
            ['done', 'completed'].includes(b.status ?? ''),
        )
        .map((b) => b.id)
        .sort(),
      audit: {
        status: 'blocked' as const,
        evidence: [],
        reasons: ['DB metadata is not a raw artifact/source audit.'],
      },
    }))
    .sort((a, b) => lexicalSort(a.key, b.key));
}
export function normalizeSense(raw: unknown, sources: MappingSource[]) {
  const r = RawSense.parse(raw);
  const byId = new Map(sources.map((s) => [s.sourceId, s]));
  const source = byId.get(r.source_id);
  if (!source) throw new Error(`Missing source for sense ${r.id}`);
  let externalId: string | null = null;
  if (
    source.code === 'jmdict' &&
    /^jmdict:[0-9]+:[0-9]+$/.test(r.external_id ?? '') &&
    r.lexeme_external_id ===
      r.external_id!.slice(0, r.external_id!.lastIndexOf(':')) &&
    Number(r.external_id!.split(':')[2]) === r.sense_no
  )
    externalId = r.lexeme_external_id;
  const lexicon =
    typeof r.attributes.lexicon === 'string' ? r.attributes.lexicon : null;
  const synset =
    typeof r.attributes.synset_id === 'string' ? r.attributes.synset_id : null;
  const wn =
    lexicon &&
    synset &&
    lexicon === `${source.code}:${source.version}` &&
    r.external_id?.startsWith(`wn:${lexicon}:${synset}:`)
      ? { lexicon, synsetId: synset, sourceKey: source.key }
      : null;
  if (wn) externalId = `${wn.lexicon}:${wn.synsetId}`;
  // Missing anchors are reported, never replaced with an invented database ID.
  const semanticKey = externalId
    ? senseSemanticKey(source.code, externalId, r.external_id!)
    : `unresolved-sense:${hashJson({ source: source.code, rawExternal: r.external_id, lexemeExternal: r.lexeme_external_id, attributes: r.attributes })}`;
  const evidence: Evidence[] = [];
  const used = new Set([source.key]);
  function rows(
    values: z.infer<typeof GlossRow>[],
    kind: TextRow['kind'],
  ): TextRow[] {
    return values
      .map((value) => {
        const owner = byId.get(value.source_id);
        if (!owner) throw new Error(`Unknown text row source ${value.path}`);
        used.add(owner.key);
        const key = `sense:${semanticKey}:${kind}:${value.path}`;
        const row: TextRow = {
          key,
          evidenceKey: `e:${key}`,
          id: value.id,
          rank: value.rank,
          language: value.language,
          kind,
          text: value.text,
        };
        evidence.push({
          key: row.evidenceKey,
          kind: 'text_row',
          owner: { type: 'sense', semanticKey },
          sourceKey: owner.key,
          sourceHash: owner.sha256,
          batchId: value.batch_id,
          payloadHash: textRowHash(row),
          dependencyGroup: owner.key,
          sourcePath: value.path,
          method: 'db4-d2-core-export',
        });
        return row;
      })
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          (a.id && b.id
            ? BigInt(a.id) < BigInt(b.id)
              ? -1
              : BigInt(a.id) > BigInt(b.id)
                ? 1
                : 0
            : lexicalSort(a.key, b.key)),
      );
  }
  const metadata = {
    rawAttributes: r.attributes,
    rawPos: strings(r.attributes.partOfSpeech),
    normalizedPos: [
      ...new Set(r.normalized_pos.length ? r.normalized_pos : [r.pos]),
    ].sort(),
    normalizationVersion: 'public.tag-pos-v1',
    appliesToKanji: strings(r.attributes.appliesToKanji),
    appliesToKana: strings(r.attributes.appliesToKana),
    info: texts(r.attributes.info),
    misc: strings(r.attributes.misc),
    field: [
      ...new Set([
        ...strings(r.attributes.field),
        ...(r.domain ? [r.domain] : []),
      ]),
    ],
    dialect: strings(r.attributes.dialect),
    register: r.register ? [r.register] : [],
    languageSources: texts(r.attributes.languageSource),
  };
  const metadataEvidenceKey = `e:metadata:${semanticKey}`;
  evidence.push({
    key: metadataEvidenceKey,
    kind: 'sense_metadata',
    owner: { type: 'sense', semanticKey },
    sourceKey: source.key,
    sourceHash: source.sha256,
    batchId: r.batch_id,
    payloadHash: hashJson(metadata),
    dependencyGroup: source.key,
    sourcePath: `core.sense/${r.id}/attributes`,
    method: 'db4-d2-core-export',
  });
  const context = {
    enGlosses: rows(r.glosses, 'gloss'),
    definitions: rows(r.definitions, 'definition'),
    metadata,
    metadataEvidenceKey,
    neighbors: [],
    examples: [],
  };
  return RetrievalSenseSchema.parse({
    sense: {
      id: r.id,
      lexemeId: r.lexeme_id,
      semanticKey,
      identity: externalId
        ? { sourceKey: source.key, externalId, senseKey: r.external_id }
        : null,
      language: r.language,
      lemma: r.lemma,
      reading: r.reading,
      forms: [...new Set(r.forms)],
      senseNo: r.sense_no,
      isPrimary: r.is_primary,
      jlptLevel: r.level,
    },
    senseContext: context,
    evidence: evidence.sort((a, b) => lexicalSort(a.key, b.key)),
    sourceKeys: [...used].sort(),
    wordnetIdentity: wn,
    seedConceptIds: [...new Set(r.seeds)],
    existingLinks: r.links,
  });
}
export function normalizeConcept(raw: unknown, sources: MappingSource[]) {
  const r = RawConcept.parse(raw);
  const byId = new Map(sources.map((s) => [s.sourceId, s]));
  const used = new Set<string>();
  const synsetKeys = r.synsets
    .map((s) => {
      const source = byId.get(s.source_id);
      if (!source) throw new Error('Missing synset source');
      used.add(source.key);
      return {
        lexicon: s.lexicon,
        synsetId: s.synset_id,
        sourceKey: source.key,
      };
    })
    .sort((a, b) =>
      lexicalSort(
        canonicalJson([a.lexicon, a.synsetId]),
        canonicalJson([b.lexicon, b.synsetId]),
      ),
    );
  const semanticKey = conceptSemanticKey(synsetKeys, r.ili);
  const evidence: Evidence[] = [];
  function rows(
    values: z.infer<typeof GlossRow>[],
    kind: TextRow['kind'],
  ): TextRow[] {
    return values
      .map((value) => {
        const source = byId.get(value.source_id);
        if (!source) throw new Error('Missing concept text source');
        used.add(source.key);
        const key = `concept:${semanticKey}:${kind}:${value.path}`;
        const row: TextRow = {
          key,
          evidenceKey: `e:${key}`,
          id: value.id,
          rank: value.rank,
          language: value.language,
          kind,
          text: value.text,
        };
        evidence.push({
          key: row.evidenceKey,
          kind: 'text_row',
          owner: { type: 'concept', semanticKey },
          sourceKey: source.key,
          sourceHash: source.sha256,
          batchId: value.batch_id,
          payloadHash: textRowHash(row),
          dependencyGroup: source.key,
          sourcePath: value.path,
          method: 'db4-d2-core-export',
        });
        return row;
      })
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          (a.id && b.id
            ? BigInt(a.id) < BigInt(b.id)
              ? -1
              : BigInt(a.id) > BigInt(b.id)
                ? 1
                : 0
            : lexicalSort(a.key, b.key)),
      );
  }
  return RetrievalConceptSchema.parse({
    concept: { id: r.id, semanticKey, ili: r.ili, pos: r.pos, synsetKeys },
    conceptContext: {
      definitions: rows(r.definitions, 'definition'),
      labels: rows(r.labels, 'lemma'),
      neighbors: [],
      examples: [],
    },
    evidence: evidence.sort((a, b) => lexicalSort(a.key, b.key)),
    sourceKeys: [...used].sort(),
    synsetLineage: r.synsets.map((s) => ({
      lexicon: s.lexicon,
      synsetId: s.synset_id,
      sourceKey: byId.get(s.source_id)!.key,
      batchId: s.batch_id,
    })),
  });
}
export async function runExport(flags: Record<string, string>) {
  const root = resolve(flags['artifact-dir'] ?? 'uploads/db4');
  mkdirSync(root, { recursive: true });
  const prefix = flags.prefix ?? 'export';
  const cohort = flags.cohort ?? 'jlpt';
  if (!['jlpt', 'wordnet', 'unlinked-ja', 'unlinked-en'].includes(cohort))
    throw new Error('Unknown cohort');
  const limit = positiveFlag(flags.limit, 100);
  const chunk = positiveFlag(flags.chunk, 500);
  if (chunk > 2000) throw new Error('Chunk exceeds 2000');
  config({ quiet: true });
  const url = process.env.DB4_DATABASE_URL;
  if (!url)
    throw new Error(
      'Set DB4_DATABASE_URL explicitly; DATABASE_URL is not used.',
    );
  const senseFile = streamFile(root, `${prefix}/senses.jsonl`);
  const conceptFile = streamFile(root, `${prefix}/concepts.jsonl`);
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='90s'");
    const origin = (
      await client.query<{
        database: string;
        snapshot: string;
        read_only: string;
      }>(
        "SELECT current_database() AS database,pg_current_snapshot()::text AS snapshot,current_setting('transaction_read_only') AS read_only",
      )
    ).rows[0];
    if (origin.read_only !== 'on')
      throw new Error('Read-only transaction required');
    const rows = z.array(SourceRow).parse(
      (
        await client.query(`SELECT src.id,src.code,src.version,src.license,src.attribution,src.url,src.sha256,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id::text,'sha256',b.sha256,'status',b.status) ORDER BY b.id)
        FROM staging.import_batch b WHERE b.source_code=src.code OR
          (src.code IN ('oewn','omw-en','omw-ja') AND b.source_code='wordnet-stack')),'[]'::jsonb) AS batches
      FROM public.source src WHERE src.code IN ('jmdict','oewn','omw-en','omw-ja','wiktextract') ORDER BY src.code`)
      ).rows,
    );
    const sources = sourceRegistry(rows);
    const sourceRef = writeJson(root, `${prefix}/sources.json`, sources);
    const inventory = writeJson(root, `${prefix}/inventory.json`, {
      origin,
      sourceRows: rows,
      cohort,
      limit,
      chunk,
    });
    const ids = (
      await client.query<{ id: string }>(
        `SELECT s.id::text FROM core.sense s JOIN core.lexeme l ON l.id=s.lexeme_id
      JOIN public.source src ON src.id=s.source_id JOIN public.language lang ON lang.id=l.language_id
      WHERE ${cohort === 'jlpt' ? "src.code='jmdict' AND EXISTS(SELECT 1 FROM core.jlpt_link jl WHERE jl.lexeme_id=l.id AND jl.status='accepted' AND jl.source_level IN (4,5))" : cohort === 'wordnet' ? "src.code IN ('oewn','omw-en','omw-ja')" : `src.code=${cohort === 'unlinked-ja' ? "'jmdict'" : "'wiktextract'"} AND lang.code=${cohort === 'unlinked-ja' ? "'ja'" : "'en'"} AND NOT EXISTS(SELECT 1 FROM core.sense_concept sc WHERE sc.sense_id=s.id AND sc.relation='exact')`}
      ORDER BY s.id LIMIT $1`,
        [limit],
      )
    ).rows.map((r) => r.id);
    for (let offset = 0; offset < ids.length; offset += chunk) {
      const selected = ids.slice(offset, offset + chunk);
      const data = await client.query(
        `SELECT s.id::text,s.lexeme_id::text,s.external_id,l.external_id AS lexeme_external_id,
        l.lemma,l.reading,lang.code AS language,s.sense_no,s.is_primary,l.pos,s.source_id,s.batch_id::text,
        s.attributes,l.attributes AS lexeme_attributes,s.register,s.domain,
        (SELECT max(jl.source_level)::int FROM core.jlpt_link jl WHERE jl.lexeme_id=l.id AND jl.status='accepted') AS level,
        COALESCE((SELECT jsonb_agg(f.form_text ORDER BY f.id) FROM core.lexeme_form f WHERE f.lexeme_id=l.id),'[]'::jsonb) AS forms,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id::text,'rank',g.rank,'text',g.text,'language','en',
          'source_id',g.source_id,'batch_id',g.batch_id::text,'path','core.sense_gloss/'||g.id) ORDER BY g.rank,g.id)
          FROM core.sense_gloss g JOIN public.language gl ON gl.id=g.language_id WHERE g.sense_id=s.id AND gl.code='en' AND NOT g.is_machine),'[]'::jsonb) AS glosses,
        CASE WHEN s.definition IS NOT NULL AND btrim(s.definition)<>'' THEN jsonb_build_array(jsonb_build_object(
          'id',s.id::text,'rank',0,'text',s.definition,'language',(SELECT code FROM public.language WHERE id=s.definition_language_id),
          'source_id',s.source_id,'batch_id',s.batch_id::text,'path','core.sense/'||s.id||'/definition')) ELSE '[]'::jsonb END AS definitions,
        COALESCE((SELECT jsonb_agg(DISTINCT t.pos_norm) FROM jsonb_array_elements_text(COALESCE(s.attributes->'partOfSpeech','[]'::jsonb)) p(code)
          JOIN public.tag t ON t.code=p.code AND t.kind='pos'),'[]'::jsonb) AS normalized_pos,
        COALESCE((SELECT jsonb_agg(DISTINCT cand.concept_id::text) FROM core.sense_concept_candidate cand
          WHERE cand.sense_id=s.id AND cand.decision='pending'),'[]'::jsonb) AS seeds,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('conceptId',sc.concept_id::text,'relation',sc.relation,
          'method',sc.method,'verified',sc.verified,'sourceId',sc.source_id,'batchId',sc.batch_id::text) ORDER BY sc.concept_id)
          FROM core.sense_concept sc WHERE sc.sense_id=s.id),'[]'::jsonb) AS links
        FROM core.sense s JOIN core.lexeme l ON l.id=s.lexeme_id JOIN public.language lang ON lang.id=l.language_id
        WHERE s.id=ANY($1::bigint[]) ORDER BY s.id`,
        [selected],
      );
      data.rows.forEach((r: unknown) =>
        senseFile.append(normalizeSense(r, sources)),
      );
    }
    let after = '0';
    for (;;) {
      const concepts = await client.query(
        `SELECT c.id::text,c.ili,c.pos,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('lexicon',ws.lexicon,'synset_id',ws.synset_id,'source_id',ws.source_id,'batch_id',ws.batch_id::text) ORDER BY ws.lexicon,ws.synset_id)
          FROM core.wordnet_synset ws WHERE ws.concept_id=c.id),'[]'::jsonb) AS synsets,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',null,'rank',g.rank,'text',g.text,'language','en','source_id',g.source_id,
          'batch_id',g.batch_id::text,'path','core.concept_gloss/'||c.id||'/en/'||g.rank) ORDER BY g.rank,g.text)
          FROM core.concept_gloss g JOIN public.language lang ON lang.id=g.language_id JOIN public.source src ON src.id=g.source_id
          WHERE g.concept_id=c.id AND lang.code='en' AND NOT g.is_machine AND src.code IN ('oewn','omw-en')),'[]'::jsonb) AS definitions,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id::text,'rank',0,'text',m.lemma,'language',m.language,'source_id',m.source_id,
          'batch_id',m.batch_id::text,'path','core.lexeme/'||m.id) ORDER BY m.id) FROM
          (SELECT DISTINCT l.id,l.lemma,l.source_id,l.batch_id,lang.code AS language FROM core.sense_concept sc JOIN core.sense s ON s.id=sc.sense_id
            JOIN core.lexeme l ON l.id=s.lexeme_id JOIN public.language lang ON lang.id=l.language_id
            JOIN public.source src ON src.id=s.source_id JOIN core.wordnet_synset ws ON ws.concept_id=sc.concept_id
              AND ws.lexicon=s.attributes->>'lexicon' AND ws.synset_id=s.attributes->>'synset_id'
            WHERE sc.concept_id=c.id AND sc.method='wordnet_synset' AND sc.verified AND sc.relation='exact'
              AND lang.code IN ('en','ja') AND src.code IN ('oewn','omw-en','omw-ja')) m),'[]'::jsonb) AS labels
        FROM core.concept c WHERE c.id>$1::bigint AND c.status<>'rejected' AND EXISTS(SELECT 1 FROM core.wordnet_synset ws WHERE ws.concept_id=c.id)
        ORDER BY c.id LIMIT $2`,
        [after, chunk],
      );
      if (!concepts.rows.length) break;
      concepts.rows.forEach((r: unknown) =>
        conceptFile.append(normalizeConcept(r, sources)),
      );
      after = RawConcept.parse(concepts.rows[concepts.rows.length - 1]).id;
    }
    const senseOut = senseFile.finish();
    const conceptOut = conceptFile.finish();
    const snapshot = {
      schemaVersion: 1 as const,
      mode: 'production' as const,
      sourceSnapshots: sources
        .filter((s) => s.sha256)
        .map((s) => ({ sourceKey: s.key, sha256: s.sha256! })),
      identityHash: hashJson({
        inventory: inventory.sha256,
        senses: senseOut.ref.sha256,
        concepts: conceptOut.ref.sha256,
      }),
      senseInputHash: senseOut.ref.sha256,
      conceptInputHash: conceptOut.ref.sha256,
      rawAttributesHash: senseOut.ref.sha256,
      sourcePolicyVersion: 'db4-d2-pending-source-audit-v1',
      normalizerVersion: 'public.tag-pos-v1',
      retrievalVersion: RETRIEVAL_VERSION,
    };
    const manifest = ExportManifestSchema.parse({
      schemaVersion: 1,
      task: 'db4_retrieval_export',
      createdAt: new Date().toISOString(),
      cohort,
      snapshot,
      semanticInputFingerprint: semanticInputFingerprint(snapshot),
      files: {
        senses: senseOut.ref,
        concepts: conceptOut.ref,
        sources: sourceRef,
        inventory,
      },
      counts: { senses: senseOut.count, concepts: conceptOut.count },
    });
    await client.query('ROLLBACK');
    const ref = writeJson(root, `${prefix}/manifest.json`, manifest);
    console.log(
      JSON.stringify({
        manifest: ref,
        counts: manifest.counts,
        readOnly: true,
      }),
    );
    return manifest;
  } finally {
    senseFile.close();
    conceptFile.close();
    await client.end();
  }
}
if (require.main === module) {
  const flags = cliFlags(process.argv.slice(2), [
    'artifact-dir',
    'prefix',
    'cohort',
    'limit',
    'chunk',
  ]);
  void runExport(flags).catch((error: unknown) => {
    const detail =
      error instanceof Error
        ? error.message.replace(
            /postgres(?:ql)?:\/\/[^\s]+/g,
            '[redacted DB URL]',
          )
        : 'Unknown error';
    console.error(`DB4-D2 export failed; no DB writes: ${detail}`);
    process.exitCode = 1;
  });
}
