import { z } from 'zod';
import {
  ArtifactRefSchema,
  BigintIdSchema,
  Count,
  JsonObject,
  Positive,
  SemanticSnapshotSchema,
  Sha256Schema,
  SourceSchema,
  Text,
} from './_mapping-types';

/**
 * D2 export handoff v1 (owner: DeepSeek). Consumer: mapping-generate.
 * Các record ở đây là trung gian giữa DB và `createMappingCandidate`; mọi hash
 * vẫn qua `hashJson`/contract, không có shape ngoài contract ở artifact candidate.
 */

export const EXPORT_HANDOFF_VERSION = 1;
export const SOURCE_POLICY_VERSION = 'db4-sources-v1';

export const ExportTextRowSchema = z
  .object({
    id: BigintIdSchema.nullable(),
    rank: Count,
    text: Text,
    batchId: z.string().uuid().nullable(),
    sourcePath: Text,
  })
  .strict();
export type ExportTextRow = z.infer<typeof ExportTextRowSchema>;

const SenseIdentitySchema = z
  .object({ sourceKey: Text, externalId: Text, senseKey: Text })
  .strict();

const SenseHeaderSchema = z
  .object({
    semanticKey: Text,
    id: BigintIdSchema,
    lexemeId: BigintIdSchema,
    identity: SenseIdentitySchema,
    language: Text,
    lemma: Text,
    reading: Text.nullable(),
    forms: z.array(Text),
    senseNo: Positive,
    isPrimary: z.boolean(),
    jlptLevel: z.number().int().min(1).max(5).nullable(),
  })
  .strict();

const SenseMetadataSchema = z
  .object({
    rawAttributes: JsonObject,
    rawPos: z.array(Text),
    normalizedPos: z.array(Text),
    normalizationVersion: Text,
    appliesToKanji: z.array(Text),
    appliesToKana: z.array(Text),
    info: z.array(Text),
    misc: z.array(Text),
    field: z.array(Text),
    dialect: z.array(Text),
    register: z.array(Text),
    languageSources: z.array(Text),
  })
  .strict();

export const SenseExportRecordSchema = z
  .object({
    handoffVersion: z.literal(1),
    kind: z.literal('sense'),
    sense: SenseHeaderSchema,
    metadataBatchId: z.string().uuid().nullable(),
    metadata: SenseMetadataSchema,
    metadataPath: Text,
    glosses: z.array(ExportTextRowSchema),
    neighbors: z.array(ExportTextRowSchema),
  })
  .strict();
export type SenseExportRecord = z.infer<typeof SenseExportRecordSchema>;

const SynsetKeySchema = z
  .object({ lexicon: Text, synsetId: Text, sourceKey: Text })
  .strict();

export const ConceptExportRecordSchema = z
  .object({
    handoffVersion: z.literal(1),
    kind: z.literal('concept'),
    concept: z
      .object({
        id: BigintIdSchema,
        semanticKey: Text,
        ili: Text.nullable(),
        synsetKeys: z.array(SynsetKeySchema).min(1),
        pos: Text.nullable(),
      })
      .strict(),
    definitions: z.array(ExportTextRowSchema),
    labels: z.array(ExportTextRowSchema),
  })
  .strict();
export type ConceptExportRecord = z.infer<typeof ConceptExportRecordSchema>;

export const ExportManifestSchema = z
  .object({
    handoffVersion: z.literal(1),
    kind: z.literal('db4-export'),
    mode: z.literal('production'),
    semanticInputFingerprint: Sha256Schema,
    snapshot: SemanticSnapshotSchema,
    inventory: ArtifactRefSchema,
    sources: z.array(SourceSchema).min(1),
    scope: z
      .object({
        jlptSenses: Count,
        exportedSenses: Count,
        levelPolicy: Text,
        sensesWithoutIdentity: Count,
        conceptsTotal: Count,
        conceptsExported: Count,
        conceptsWithoutOewn: Count,
      })
      .strict(),
    counts: z
      .object({
        senseRecords: Count,
        glossRows: Count,
        neighborRows: Count,
        conceptRecords: Count,
        definitionRows: Count,
        labelRows: Count,
        tokensDefinition: Count,
        postingsDefinition: Count,
        tokensLabel: Count,
        postingsLabel: Count,
      })
      .strict(),
    files: z.array(ArtifactRefSchema).min(1),
    index: ArtifactRefSchema,
  })
  .strict();
export type ExportManifest = z.infer<typeof ExportManifestSchema>;

const ShardFileSchema = z
  .object({ ref: ArtifactRefSchema, tokens: Count, postings: Count })
  .strict();

export const IndexManifestSchema = z
  .object({
    handoffVersion: z.literal(1),
    kind: z.literal('db4-index'),
    tokenizerVersion: Text,
    normalizerVersion: Text,
    retrievalVersion: Text,
    shards: Positive,
    definition: z
      .object({
        files: z.array(ShardFileSchema),
        tokens: Count,
        postings: Count,
      })
      .strict(),
    label: z
      .object({
        files: z.array(ShardFileSchema),
        tokens: Count,
        postings: Count,
      })
      .strict(),
  })
  .strict();
export type IndexManifest = z.infer<typeof IndexManifestSchema>;
