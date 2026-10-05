import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  BigintIdSchema,
  GlossSourceSchema,
  Sha256Schema,
  hashGlossText,
} from './_gloss-types';

/** Separate artifact family. Does not change the frozen gloss candidate v1. */
export const EXAMPLE_SCHEMA_VERSION = 1 as const;
const text = z.string().refine((s) => s.trim().length > 0, 'Empty text');
const sentence = {
  sentenceId: BigintIdSchema,
  text,
  textHash: Sha256Schema,
  sourceCode: text,
  batchId: z.string().uuid(),
};
const base = {
  schemaVersion: z.literal(EXAMPLE_SCHEMA_VERSION),
  candidateType: z.literal('example_pair'),
  candidateKey: Sha256Schema,
  inputHash: Sha256Schema,
  datasetFingerprint: Sha256Schema,
  ja: z.object({ ...sentence, language: z.literal('ja') }).strict(),
  vi: z.object({ ...sentence, language: z.literal('vi') }).strict(),
  links: z
    .array(
      z
        .object({
          sentenceId: BigintIdSchema,
          translationId: BigintIdSchema,
          sourceCode: text,
          batchId: z.string().uuid(),
        })
        .strict(),
    )
    .min(1),
  sources: z.array(GlossSourceSchema).min(1),
  alignment: z.literal('unmapped'),
  notes: z.array(text),
};
export const ExampleCandidateSchema = z
  .discriminatedUnion('classification', [
    z
      .object({
        ...base,
        classification: z.literal('source_pair'),
        blockedReasons: z.array(text).length(0),
      })
      .strict(),
    z
      .object({
        ...base,
        classification: z.literal('blocked_source'),
        blockedReasons: z.array(text).min(1),
      })
      .strict(),
  ])
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (c.ja.sentenceId === c.vi.sentenceId)
      fail('Pair needs distinct source sentences');
    if (new Set(c.sources.map((s) => s.code)).size !== c.sources.length)
      fail('Duplicate source code');
    for (const row of [c.ja, c.vi, ...c.links]) {
      const source = c.sources.find((s) => s.code === row.sourceCode);
      if (!source || !source.batchIds.includes(row.batchId))
        fail('Sentence/link lacks source batch lineage');
    }
    for (const row of [c.ja, c.vi])
      if (row.textHash !== hashGlossText(row.text))
        fail('Sentence text hash mismatch');
    const edges = new Set<string>();
    for (const link of c.links) {
      if (!(
        (link.sentenceId === c.ja.sentenceId &&
          link.translationId === c.vi.sentenceId) ||
        (link.sentenceId === c.vi.sentenceId &&
          link.translationId === c.ja.sentenceId)
      ))
        fail('Link is not the direct JA–VI pair');
      const key = `${link.sentenceId}:${link.translationId}`;
      if (edges.has(key)) fail('Duplicate directed link');
      edges.add(key);
    }
    if (
      c.classification === 'source_pair' &&
      c.sources.some((s) => s.audit.status !== 'verified')
    )
      fail('Unaudited source stays blocked');
    if (c.inputHash !== computeExampleInputHash(c))
      fail('Example input hash mismatch');
    if (c.candidateKey !== computeExampleCandidateKey(c))
      fail('Example candidate key mismatch');
  });
export type ExampleCandidate = z.infer<typeof ExampleCandidateSchema>;
type WithoutHashes<T> = T extends unknown
  ? Omit<T, 'inputHash' | 'candidateKey'>
  : never;
export type ExampleCandidateInput = WithoutHashes<ExampleCandidate>;
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((v: unknown) => canonical(v)).join(',')}]`;
  if (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  throw new Error('Example hash input must be plain JSON');
}
function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function computeExampleInputHash(c: ExampleCandidateInput): string {
  return hash({
    schemaVersion: c.schemaVersion,
    candidateType: c.candidateType,
    datasetFingerprint: c.datasetFingerprint,
    ja: c.ja,
    vi: c.vi,
    links: c.links,
    sources: c.sources,
    alignment: c.alignment,
  });
}
export function computeExampleCandidateKey(c: ExampleCandidateInput): string {
  return hash({
    schemaVersion: c.schemaVersion,
    candidateType: c.candidateType,
    datasetFingerprint: c.datasetFingerprint,
    jaId: c.ja.sentenceId,
    viId: c.vi.sentenceId,
    inputHash: computeExampleInputHash(c),
  });
}
export function createExampleCandidate(
  input: ExampleCandidateInput,
): ExampleCandidate {
  return ExampleCandidateSchema.parse({
    ...input,
    inputHash: computeExampleInputHash(input),
    candidateKey: computeExampleCandidateKey(input),
  });
}
export function parseExampleCandidate(input: unknown): ExampleCandidate {
  return ExampleCandidateSchema.parse(input);
}
