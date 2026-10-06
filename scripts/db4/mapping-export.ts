import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import {
  JsonlWriter,
  resolveArtifact,
  sha256Bytes,
  sha256File,
  stablePretty,
  writeTextAtomic,
} from './_artifacts';
import { parseMappingCli } from './_cli';
import {
  ConceptExportRecordSchema,
  EXPORT_HANDOFF_VERSION,
  ExportManifestSchema,
  IndexManifestSchema,
  SenseExportRecordSchema,
  SOURCE_POLICY_VERSION,
  type ExportManifest,
} from './_export';
import {
  ArtifactRefSchema,
  type ArtifactRef,
  conceptSemanticKey,
  hashJson,
  semanticInputFingerprint,
  senseSemanticKey,
  SourceSchema,
  type MappingSource,
} from './_mapping-types';
import {
  NORMALIZER_VERSION,
  RETRIEVAL_VERSION,
  TokenPostingBuilder,
  TOKENIZER_VERSION,
  uniqueTokens,
  type PostingsResult,
} from './_retrieval';

/**
 * D2 `mapping-export` — READ-ONLY DB → export sense/concept context + token index.
 *
 * - Mọi EN gloss row của target JLPT sense (không chỉ gloss serve đang chọn).
 * - Concept context EN (oewn) + label members; index token bounded RAM.
 * - Source audit thật (jmdict/oewn verified; OMW/wordnet-stack/jlpt-list blocked).
 * - Deterministic: cùng DB/config → cùng fingerprint/bytes (không timestamp trong artifact).
 */

const OEWN_LEXICON = 'oewn:2024';
const PAGE_SIZE = 300;
const LEVEL_POLICY = 'min(source_level)';

const SENSE_PAGE_SQL = `
WITH jl AS (
  SELECT lexeme_id, min(source_level) AS lvl
  FROM core.jlpt_link WHERE status = 'accepted' GROUP BY lexeme_id
)
SELECT s.id::text AS id, s.lexeme_id::text AS lexeme_id, s.sense_no, s.is_primary,
       s.external_id, s.batch_id::text AS batch_id, s.attributes::text AS attributes,
       s.register, s.domain, l.lemma, l.reading, l.pos, jl.lvl
FROM jl
JOIN core.sense s ON s.lexeme_id = jl.lexeme_id
JOIN core.lexeme l ON l.id = s.lexeme_id
WHERE s.id > $1::bigint
ORDER BY s.id
LIMIT $2::int`;

const FORMS_SQL = `
SELECT sf.sense_id::text AS sense_id, lf.form_text, lf.kind, lf.form_order
FROM core.sense_form sf
JOIN core.lexeme_form lf ON lf.id = sf.form_id
WHERE sf.sense_id = ANY($1::bigint[])
ORDER BY sf.sense_id, lf.form_order, lf.kind, lf.form_text`;

const GLOSSES_SQL = `
SELECT sense_id::text AS sense_id, id::text AS id, rank, text, batch_id::text AS batch_id
FROM core.sense_gloss
WHERE language_id = $2::int AND sense_id = ANY($1::bigint[])
ORDER BY sense_id, rank, id`;

const NEIGHBORS_SQL = `
SELECT s.lexeme_id::text AS lexeme_id, s.id::text AS id, s.sense_no, g.rank, g.text
FROM core.sense s
JOIN LATERAL (
  SELECT rank, text FROM core.sense_gloss
  WHERE sense_id = s.id AND language_id = $2::int
  ORDER BY rank, id LIMIT 3
) g ON true
WHERE s.lexeme_id IN (
  SELECT lexeme_id FROM core.sense WHERE id = ANY($1::bigint[])
)
ORDER BY s.lexeme_id, s.sense_no, s.id, g.rank`;

const CONCEPT_PAGE_SQL = `
SELECT c.id::text AS id, c.ili, c.pos, ws.synset_id, sn.batch_id::text AS batch_id,
       sn.members::text AS members
FROM core.concept c
JOIN core.wordnet_synset ws ON ws.concept_id = c.id AND ws.lexicon = $3::text
JOIN staging.wn_synset sn ON sn.lexicon = ws.lexicon AND sn.synset_id = ws.synset_id
WHERE c.id > $1::bigint
ORDER BY c.id
LIMIT $2::int`;

const CONCEPT_DEFS_SQL = `
SELECT concept_id::text AS concept_id, rank, text, batch_id::text AS batch_id
FROM core.concept_gloss
WHERE source_id = $3::int AND language_id = $2::int AND concept_id = ANY($1::bigint[])
ORDER BY concept_id, rank, text`;

const SCOPE_COUNT_SQL = `
WITH jl AS (SELECT lexeme_id FROM core.jlpt_link WHERE status = 'accepted' GROUP BY lexeme_id)
SELECT count(*)::int AS n FROM jl JOIN core.sense s ON s.lexeme_id = jl.lexeme_id`;

type SenseRow = {
  id: string;
  lexeme_id: string;
  sense_no: number;
  is_primary: boolean;
  external_id: string;
  batch_id: string;
  attributes: string;
  register: string | null;
  domain: string | null;
  lemma: string;
  reading: string | null;
  pos: string | null;
  lvl: number;
};
type FormRow = {
  sense_id: string;
  form_text: string;
  kind: string;
  form_order: number;
};
type GlossRow = {
  sense_id: string;
  id: string;
  rank: number;
  text: string;
  batch_id: string | null;
};
type NeighborRow = {
  lexeme_id: string;
  id: string;
  sense_no: number;
  rank: number;
  text: string;
};
type ConceptRow = {
  id: string;
  ili: string | null;
  pos: string | null;
  synset_id: string;
  batch_id: string;
  members: string;
};
type ConceptDefRow = {
  concept_id: string;
  rank: number;
  text: string;
  batch_id: string | null;
};
type SourceRow = {
  id: number;
  code: string;
  name: string | null;
  license: string | null;
  attribution: string | null;
  url: string | null;
  version: string | null;
  sha256: string | null;
};
type BatchRow = {
  id: string;
  file_name: string;
  row_count: number;
  sha256: string;
  status: string;
  finished_at: string | null;
};

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim() !== '') out.push(item);
    else if (Array.isArray(item)) {
      const joined = item
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .join(':');
      if (joined) out.push(joined);
    }
  }
  return out;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values)
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  return out;
}

function requireDatabaseUrl(): string {
  loadDotenv();
  const url =
    process.env.DB4_DATABASE_URL ??
    process.env.DIRECT_URL ??
    process.env.DATABASE_URL;
  if (!url || url.trim() === '')
    throw new Error('Thiếu DB4_DATABASE_URL/DIRECT_URL/DATABASE_URL');
  return url;
}

async function loadLanguageIds(client: Client): Promise<Map<string, number>> {
  const result = await client.query<{ id: number; code: string }>(
    'SELECT id, code FROM public.language ORDER BY id',
  );
  return new Map(result.rows.map((row) => [row.code, row.id]));
}

async function batchIdsFor(client: Client, code: string): Promise<string[]> {
  const queries: Record<string, { sql: string; params: unknown[] }> = {
    jmdict: {
      sql: 'SELECT DISTINCT batch_id::text AS id FROM staging.jmdict_entry',
      params: [],
    },
    oewn: {
      sql: 'SELECT DISTINCT batch_id::text AS id FROM staging.wn_synset WHERE lexicon = $1::text',
      params: [OEWN_LEXICON],
    },
    'omw-en': {
      sql: 'SELECT DISTINCT batch_id::text AS id FROM staging.wn_synset WHERE lexicon = $1::text',
      params: ['omw-en:1.4'],
    },
    'omw-ja': {
      sql: 'SELECT DISTINCT batch_id::text AS id FROM staging.wn_synset WHERE lexicon = $1::text',
      params: ['omw-ja:1.4'],
    },
    'wordnet-stack': {
      sql: "SELECT id::text AS id FROM staging.import_batch WHERE source_code = 'wordnet-stack'",
      params: [],
    },
    'jlpt-list': {
      sql: "SELECT id::text AS id FROM staging.import_batch WHERE source_code = 'jlpt-list'",
      params: [],
    },
  };
  const query = queries[code];
  if (!query) return [];
  const result = await client.query<{ id: string }>(query.sql, query.params);
  return result.rows.map((row) => row.id).sort();
}

const BLOCKED_REASONS: Record<string, string[]> = {
  'omw-en': [
    'license "ghi nguồn" chưa xác minh theo từng wordnet (OMW per-wordnet)',
  ],
  'omw-ja': [
    'license "ghi nguồn" chưa xác minh theo từng wordnet (OMW per-wordnet)',
  ],
  'wordnet-stack': [
    'license "nhiều" — cần snapshot/hash/license riêng từng lexicon con',
  ],
  'jlpt-list': ['license "CẦN XÁC MINH" — chưa audit được nguồn gốc danh sách'],
};

async function writeSourceAudits(
  client: Client,
  root: string,
): Promise<Map<string, MappingSource>> {
  const codes = [
    'jmdict',
    'oewn',
    'omw-en',
    'omw-ja',
    'wordnet-stack',
    'jlpt-list',
  ];
  const sources = await client.query<SourceRow>(
    'SELECT id, code, name, license, attribution, url, version, sha256::text AS sha256 FROM public.source WHERE code = ANY($1::text[]) ORDER BY code',
    [codes],
  );
  const byCode = new Map(sources.rows.map((row) => [row.code, row]));
  const entries = new Map<string, MappingSource>();
  for (const code of codes) {
    const row = byCode.get(code);
    if (!row) continue;
    const batchIds = await batchIdsFor(client, code);
    const batches =
      batchIds.length === 0
        ? []
        : (
            await client.query<BatchRow>(
              'SELECT id::text AS id, file_name, row_count, sha256::text AS sha256, status, finished_at::text AS finished_at FROM staging.import_batch WHERE id = ANY($1::uuid[]) ORDER BY id',
              [batchIds],
            )
          ).rows;
    const reasons = BLOCKED_REASONS[code] ?? [];
    const audit = {
      schemaVersion: 1,
      sourceKey: code,
      code,
      sourceId: row.id,
      name: row.name,
      license: row.license,
      attribution: row.attribution,
      url: row.url,
      version: row.version,
      sha256: row.sha256,
      batchIds,
      batches,
      status: reasons.length ? 'blocked' : 'verified',
      reasons,
      notes: reasons.length
        ? [
            'DB4 v1: nguồn này không vào candidate/shortlist cho tới khi audit xong.',
          ]
        : [
            'license/attribution/url lấy từ public.source; chưa nhúng license text gốc.',
            'source hash là checksum snapshot đã import (import_batch.sha256).',
          ],
    };
    const ref = writeTextAtomic(
      root,
      `sources/${code}.audit.json`,
      stablePretty(audit),
    );
    entries.set(
      code,
      SourceSchema.parse({
        key: code,
        sourceId: row.id,
        code,
        version: row.version,
        snapshot: null,
        sha256: row.sha256,
        license: row.license,
        attribution: row.attribution,
        url: row.url,
        batchIds,
        audit: {
          status: reasons.length ? 'blocked' : 'verified',
          evidence: [ref],
          reasons,
        },
      }),
    );
  }
  return entries;
}

type SenseExportResult = {
  file: { ref: ArtifactRef; count: number };
  identityItems: Record<string, unknown>[];
  recordHashes: string[];
  attributePairs: [string, string][];
  glossRows: number;
  neighborRows: number;
  exported: number;
  withoutIdentity: number;
};

async function exportSenses(
  client: Client,
  root: string,
  tmpRel: string,
  enId: number,
  limit: number | null,
): Promise<SenseExportResult> {
  const writer = new JsonlWriter(root, `${tmpRel}/sense-context.jsonl`);
  const identityItems: Record<string, unknown>[] = [];
  const recordHashes: string[] = [];
  const attributePairs: [string, string][] = [];
  let glossRows = 0;
  let neighborRows = 0;
  let exported = 0;
  let withoutIdentity = 0;
  let lastId = '0';
  for (;;) {
    const remaining = limit === null ? PAGE_SIZE : limit - exported;
    if (remaining <= 0) break;
    const page = await client.query<SenseRow>(SENSE_PAGE_SQL, [
      lastId,
      Math.min(PAGE_SIZE, remaining),
    ]);
    if (page.rows.length === 0) break;
    const ids = page.rows.map((row) => row.id);
    const forms = await client.query<FormRow>(FORMS_SQL, [ids]);
    const glosses = await client.query<GlossRow>(GLOSSES_SQL, [ids, enId]);
    const neighbors = await client.query<NeighborRow>(NEIGHBORS_SQL, [
      ids,
      enId,
    ]);
    const formsMap = new Map<string, string[]>();
    for (const form of forms.rows) {
      const list = formsMap.get(form.sense_id) ?? [];
      if (!list.includes(form.form_text)) list.push(form.form_text);
      formsMap.set(form.sense_id, list);
    }
    const glossMap = new Map<string, GlossRow[]>();
    for (const gloss of glosses.rows) {
      const list = glossMap.get(gloss.sense_id) ?? [];
      list.push(gloss);
      glossMap.set(gloss.sense_id, list);
    }
    const neighborMap = new Map<string, NeighborRow[]>();
    for (const neighbor of neighbors.rows) {
      const list = neighborMap.get(neighbor.lexeme_id) ?? [];
      list.push(neighbor);
      neighborMap.set(neighbor.lexeme_id, list);
    }
    for (const row of page.rows) {
      const identityMatch = /^jmdict:([0-9]+):([0-9]+)$/.exec(row.external_id);
      if (!identityMatch) {
        withoutIdentity += 1;
        continue;
      }
      const attributes = parseJsonObject(row.attributes);
      const rawPos = stringList(attributes.partOfSpeech);
      const glossRowsForSense = (glossMap.get(row.id) ?? []).map((gloss) => ({
        id: gloss.id,
        rank: gloss.rank,
        text: gloss.text,
        batchId: gloss.batch_id,
        sourcePath: `core.sense_gloss/${gloss.id}`,
      }));
      const siblingRows = new Map<string, NeighborRow[]>();
      for (const neighbor of neighborMap.get(row.lexeme_id) ?? []) {
        if (neighbor.id === row.id) continue;
        const list = siblingRows.get(neighbor.id) ?? [];
        list.push(neighbor);
        siblingRows.set(neighbor.id, list);
      }
      const neighborRowsForSense = [...siblingRows.values()].map(
        (list, index) => ({
          id: list[0].id,
          rank: index,
          text: `${list[0].sense_no}. ${list
            .map((item) => item.text)
            .slice(0, 3)
            .join('; ')}`,
          batchId: null,
          sourcePath: `core.sense/${list[0].id}#gloss-en`,
        }),
      );
      const record = SenseExportRecordSchema.parse({
        handoffVersion: EXPORT_HANDOFF_VERSION,
        kind: 'sense',
        sense: {
          semanticKey: senseSemanticKey(
            'jmdict',
            identityMatch[1],
            identityMatch[2],
          ),
          id: row.id,
          lexemeId: row.lexeme_id,
          identity: {
            sourceKey: 'jmdict',
            externalId: identityMatch[1],
            senseKey: identityMatch[2],
          },
          language: 'ja',
          lemma: row.lemma,
          reading: row.reading && row.reading !== '' ? row.reading : null,
          forms: formsMap.get(row.id) ?? [],
          senseNo: row.sense_no,
          isPrimary: row.is_primary,
          jlptLevel: row.lvl,
        },
        metadataBatchId: row.batch_id,
        metadata: {
          rawAttributes: attributes,
          rawPos,
          normalizedPos: row.pos ? [row.pos] : [],
          normalizationVersion: 'db4-lexeme-pos-v1',
          appliesToKanji: stringList(attributes.appliesToKanji),
          appliesToKana: stringList(attributes.appliesToKana),
          info: stringList(attributes.info),
          misc: stringList(attributes.misc),
          field: uniqueStrings([
            ...stringList(attributes.field),
            ...(row.domain ? [row.domain] : []),
          ]),
          dialect: stringList(attributes.dialect),
          register: row.register ? [row.register] : [],
          languageSources: stringList(attributes.languageSource),
        },
        metadataPath: `core.sense/${row.id}#attributes`,
        glosses: glossRowsForSense,
        neighbors: neighborRowsForSense,
      });
      writer.write(record);
      recordHashes.push(hashJson(record));
      identityItems.push({
        semanticKey: record.sense.semanticKey,
        id: record.sense.id,
        lexemeId: record.sense.lexemeId,
        externalId: record.sense.identity.externalId,
        senseNo: record.sense.senseNo,
      });
      attributePairs.push([
        record.sense.semanticKey,
        hashJson(record.metadata.rawAttributes),
      ]);
      glossRows += glossRowsForSense.length;
      neighborRows += neighborRowsForSense.length;
      exported += 1;
    }
    lastId = page.rows[page.rows.length - 1].id;
  }
  return {
    file: writer.close(),
    identityItems,
    recordHashes,
    attributePairs,
    glossRows,
    neighborRows,
    exported,
    withoutIdentity,
  };
}

type ConceptExportResult = {
  file: { ref: ArtifactRef; count: number };
  recordHashes: string[];
  definition: PostingsResult;
  label: PostingsResult;
  definitionRows: number;
  labelRows: number;
  exported: number;
  total: number;
};

async function exportConcepts(
  client: Client,
  root: string,
  tmpRel: string,
  enId: number,
  oewnSourceId: number,
): Promise<ConceptExportResult> {
  const definitionBuilder = new TokenPostingBuilder(
    root,
    `${tmpRel}/index/tmp/definition`,
    `${tmpRel}/index/definition`,
    'definition',
  );
  const labelBuilder = new TokenPostingBuilder(
    root,
    `${tmpRel}/index/tmp/label`,
    `${tmpRel}/index/label`,
    'label',
  );
  const writer = new JsonlWriter(root, `${tmpRel}/concept-context.jsonl`);
  const recordHashes: string[] = [];
  let definitionRows = 0;
  let labelRows = 0;
  let exported = 0;
  let lastId = '0';
  for (;;) {
    const page = await client.query<ConceptRow>(CONCEPT_PAGE_SQL, [
      lastId,
      PAGE_SIZE,
      OEWN_LEXICON,
    ]);
    if (page.rows.length === 0) break;
    const ids = page.rows.map((row) => row.id);
    const defs = await client.query<ConceptDefRow>(CONCEPT_DEFS_SQL, [
      ids,
      enId,
      oewnSourceId,
    ]);
    const defMap = new Map<string, ConceptDefRow[]>();
    for (const def of defs.rows) {
      const list = defMap.get(def.concept_id) ?? [];
      list.push(def);
      defMap.set(def.concept_id, list);
    }
    for (const row of page.rows) {
      const synsetKeys = [
        { lexicon: OEWN_LEXICON, synsetId: row.synset_id, sourceKey: 'oewn' },
      ];
      const definitions = (defMap.get(row.id) ?? []).map((def) => ({
        id: null,
        rank: def.rank,
        text: def.text,
        batchId: def.batch_id,
        sourcePath: `core.concept_gloss/${row.id}/${def.rank}`,
      }));
      const members = stringList(JSON.parse(row.members) as unknown);
      const labels = uniqueStrings(members).map((text, index) => ({
        id: null,
        rank: index,
        text,
        batchId: row.batch_id,
        sourcePath: `staging.wn_synset/${OEWN_LEXICON}/${row.synset_id}#members`,
      }));
      const record = ConceptExportRecordSchema.parse({
        handoffVersion: EXPORT_HANDOFF_VERSION,
        kind: 'concept',
        concept: {
          id: row.id,
          semanticKey: conceptSemanticKey(synsetKeys, row.ili),
          ili: row.ili,
          synsetKeys,
          pos: row.pos,
        },
        definitions,
        labels,
      });
      writer.write(record);
      recordHashes.push(hashJson(record));
      for (const token of uniqueTokens(definitions.map((def) => def.text)))
        definitionBuilder.add(token, row.id);
      for (const token of uniqueTokens(labels.map((label) => label.text)))
        labelBuilder.add(token, row.id);
      definitionRows += definitions.length;
      labelRows += labels.length;
      exported += 1;
    }
    lastId = page.rows[page.rows.length - 1].id;
  }
  const total = (
    await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM core.concept',
    )
  ).rows[0].n;
  return {
    file: writer.close(),
    recordHashes,
    definition: definitionBuilder.finish(),
    label: labelBuilder.finish(),
    definitionRows,
    labelRows,
    exported,
    total,
  };
}

async function main(): Promise<void> {
  const started = Date.now();
  const cli = parseMappingCli('mapping-export', process.argv.slice(2));
  const root = cli.artifactDir;
  const inventoryRel = String(cli.flags.inventory);
  const limit = typeof cli.flags.limit === 'number' ? cli.flags.limit : null;
  const inventoryAbs = resolveArtifact(root, inventoryRel);
  const inventorySha = sha256File(inventoryAbs);
  JSON.parse(readFileSync(inventoryAbs, 'utf8'));

  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  const tmpRel = `exports/.tmp-${process.pid}`;
  try {
    await client.query('SET default_transaction_read_only = on');
    await client.query("SET TIME ZONE 'UTC'");
    const languageIds = await loadLanguageIds(client);
    const enId = languageIds.get('en');
    if (!enId) throw new Error('Không resolve được language en');
    const sourceEntries = await writeSourceAudits(client, root);
    const jmdict = sourceEntries.get('jmdict');
    const oewn = sourceEntries.get('oewn');
    if (!jmdict || !oewn) throw new Error('Thiếu source jmdict/oewn');
    const oewnSourceId = oewn.sourceId;
    if (!oewnSourceId) throw new Error('oewn thiếu sourceId');

    const jlptSenses = (await client.query<{ n: number }>(SCOPE_COUNT_SQL))
      .rows[0].n;

    const senseResult = await exportSenses(client, root, tmpRel, enId, limit);
    const conceptResult = await exportConcepts(
      client,
      root,
      tmpRel,
      enId,
      oewnSourceId,
    );
    const indexTmpAbs = resolveArtifact(root, `${tmpRel}/index/tmp`);
    if (existsSync(indexTmpAbs))
      rmSync(indexTmpAbs, { recursive: true, force: true });

    const identityHash = hashJson(
      [...senseResult.identityItems].sort((a, b) =>
        String(a.semanticKey) < String(b.semanticKey) ? -1 : 1,
      ),
    );
    const senseInputHash = hashJson([...senseResult.recordHashes].sort());
    const conceptInputHash = hashJson([...conceptResult.recordHashes].sort());
    const rawAttributesHash = hashJson(
      [...senseResult.attributePairs].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
    const snapshot = {
      schemaVersion: 1 as const,
      mode: 'production' as const,
      sourceSnapshots: [
        { sourceKey: jmdict.key, sha256: String(jmdict.sha256) },
        { sourceKey: oewn.key, sha256: String(oewn.sha256) },
      ].sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1)),
      identityHash,
      senseInputHash,
      conceptInputHash,
      rawAttributesHash,
      sourcePolicyVersion: SOURCE_POLICY_VERSION,
      normalizerVersion: NORMALIZER_VERSION,
      retrievalVersion: RETRIEVAL_VERSION,
    };
    const fingerprint = semanticInputFingerprint(snapshot);
    const finalPrefix = `exports/${fingerprint}`;
    const remap = (ref: ArtifactRef): ArtifactRef =>
      ArtifactRefSchema.parse({
        path: ref.path.replace(`${tmpRel}/`, `${finalPrefix}/`),
        sha256: ref.sha256,
      });
    const indexRefTmp = writeTextAtomic(
      root,
      `${tmpRel}/index/manifest.json`,
      stablePretty(
        IndexManifestSchema.parse({
          handoffVersion: 1,
          kind: 'db4-index',
          tokenizerVersion: TOKENIZER_VERSION,
          normalizerVersion: NORMALIZER_VERSION,
          retrievalVersion: RETRIEVAL_VERSION,
          shards: conceptResult.definition.shards.length,
          definition: {
            files: conceptResult.definition.shards.map((shard) => ({
              ref: remap({ path: shard.path, sha256: shard.sha256 }),
              tokens: shard.tokens,
              postings: shard.postings,
            })),
            tokens: conceptResult.definition.tokens,
            postings: conceptResult.definition.postings,
          },
          label: {
            files: conceptResult.label.shards.map((shard) => ({
              ref: remap({ path: shard.path, sha256: shard.sha256 }),
              tokens: shard.tokens,
              postings: shard.postings,
            })),
            tokens: conceptResult.label.tokens,
            postings: conceptResult.label.postings,
          },
        }),
      ),
    );
    const indexRef = remap(indexRefTmp);
    const fileRefs = [
      remap(senseResult.file.ref),
      remap(conceptResult.file.ref),
      indexRef,
      ...conceptResult.definition.shards.map((shard) =>
        remap({ path: shard.path, sha256: shard.sha256 }),
      ),
      ...conceptResult.label.shards.map((shard) =>
        remap({ path: shard.path, sha256: shard.sha256 }),
      ),
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const manifest: ExportManifest = ExportManifestSchema.parse({
      handoffVersion: EXPORT_HANDOFF_VERSION,
      kind: 'db4-export',
      mode: 'production',
      semanticInputFingerprint: fingerprint,
      snapshot,
      inventory: { path: inventoryRel, sha256: inventorySha },
      sources: [jmdict, oewn],
      scope: {
        jlptSenses,
        exportedSenses: senseResult.exported,
        levelPolicy: LEVEL_POLICY,
        sensesWithoutIdentity: senseResult.withoutIdentity,
        conceptsTotal: conceptResult.total,
        conceptsExported: conceptResult.exported,
        conceptsWithoutOewn: conceptResult.total - conceptResult.exported,
      },
      counts: {
        senseRecords: senseResult.exported,
        glossRows: senseResult.glossRows,
        neighborRows: senseResult.neighborRows,
        conceptRecords: conceptResult.exported,
        definitionRows: conceptResult.definitionRows,
        labelRows: conceptResult.labelRows,
        tokensDefinition: conceptResult.definition.tokens,
        postingsDefinition: conceptResult.definition.postings,
        tokensLabel: conceptResult.label.tokens,
        postingsLabel: conceptResult.label.postings,
      },
      files: fileRefs,
      index: indexRef,
    });
    if (semanticInputFingerprint(manifest.snapshot) !== fingerprint)
      throw new Error('Manifest snapshot fingerprint mismatch');
    const manifestText = stablePretty(manifest);
    writeTextAtomic(root, `${tmpRel}/manifest.json`, manifestText);
    const tmpAbs = resolveArtifact(root, tmpRel);
    const finalAbs = resolveArtifact(root, finalPrefix);
    if (existsSync(finalAbs)) {
      const existing = readFileSync(
        path.join(finalAbs, 'manifest.json'),
        'utf8',
      );
      if (sha256Bytes(existing) !== sha256Bytes(manifestText))
        throw new Error(`Export fingerprint collision: ${finalPrefix}`);
      rmSync(tmpAbs, { recursive: true, force: true });
    } else {
      renameSync(tmpAbs, finalAbs);
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log('== DB4 D2 export (READ-ONLY) ==');
    console.log(`  fingerprint: ${fingerprint}`);
    console.log(
      `  senses: ${senseResult.exported}/${jlptSenses} · gloss ${senseResult.glossRows} · neighbor ${senseResult.neighborRows} · thiếu identity ${senseResult.withoutIdentity}`,
    );
    console.log(
      `  concepts: ${conceptResult.exported}/${conceptResult.total} · def ${conceptResult.definitionRows} · label ${conceptResult.labelRows}`,
    );
    console.log(
      `  index: def ${conceptResult.definition.tokens} token/${conceptResult.definition.postings} posting · label ${conceptResult.label.tokens} token/${conceptResult.label.postings} posting`,
    );
    console.log(`  dir: ${finalPrefix} (${seconds}s)`);
  } catch (error) {
    const tmpAbs = path.resolve(root, tmpRel);
    if (existsSync(tmpAbs)) rmSync(tmpAbs, { recursive: true, force: true });
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `mapping-export: LỖI — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
