import { createHash } from 'node:crypto';
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const Text = z.string().refine((s) => s.trim().length > 0, 'Empty text');
export const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const Positive = Count.refine((n) => n > 0, 'Must be positive');
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const BigintIdSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .refine(
    (s) =>
      s.length <= 19 &&
      /^[1-9][0-9]*$/.test(s) &&
      BigInt(s) <= 9223372036854775807n,
    'Not a PostgreSQL bigint ID',
  );
export const Score = z
  .number()
  .min(0)
  .max(1)
  .refine(
    (n) => Math.abs(n - Math.round(n * 1e6) / 1e6) <= Number.EPSILON,
    'Score must have at most six decimal places',
  );
export const Timestamp = z.string().datetime({ offset: true });
export const Language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/);
export const ArtifactPath = Text.refine(
  (s) =>
    !s.startsWith('/') &&
    !s.includes('\\') &&
    !s.includes(':') &&
    !Array.from(s).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) &&
    !s.split('/').some((p) => ['', '.', '..'].includes(p)),
  'Artifact path must be relative without traversal/control characters',
);
export const ArtifactRefSchema = z
  .object({ path: ArtifactPath, sha256: Sha256Schema })
  .strict();
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type Json =
  null | string | number | boolean | Json[] | { [key: string]: Json };

/** Reject lossy serialization (undefined, bigint, cycles, sparse arrays, non-JSON objects). */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function encode(v: unknown, depth: number): string {
    if (depth > 64) throw new Error('JSON nesting exceeds 64');
    if (v === null || typeof v === 'boolean' || typeof v === 'string')
      return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || Object.is(v, -0))
        throw new Error('Invalid JSON number');
      return JSON.stringify(v);
    }
    if (typeof v !== 'object') throw new Error('Non-JSON value');
    if (seen.has(v)) throw new Error('Cyclic JSON');
    if (Object.getOwnPropertySymbols(v).length)
      throw new Error('Symbol JSON key');
    seen.add(v);
    let result: string;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length)
        throw new Error('Sparse/decorated array');
      result =
        '[' +
        Array.from(v, (item: unknown) => encode(item, depth + 1)).join(',') +
        ']';
    } else {
      if (
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null
      )
        throw new Error('Non-plain JSON object');
      if (Object.getOwnPropertySymbols(v).length)
        throw new Error('Symbol JSON key');
      const object = v as Record<string, unknown>;
      result =
        '{' +
        Object.keys(object)
          .sort()
          .map(
            (key) => JSON.stringify(key) + ':' + encode(object[key], depth + 1),
          )
          .join(',') +
        '}';
    }
    seen.delete(v);
    return result;
  }
  return encode(value, 0);
}
export function hashJson(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}
export function hashBytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
export function verifyArtifactBytes(
  refValue: unknown,
  bytes: string | Uint8Array,
): void {
  const ref = ArtifactRefSchema.parse(refValue);
  if (hashBytes(bytes) !== ref.sha256)
    throw new Error(`Artifact hash mismatch: ${ref.path}`);
}
export function mappingTargetKey(
  senseKey: string,
  fingerprint: string,
): string {
  Text.parse(senseKey);
  Sha256Schema.parse(fingerprint);
  return hashJson({
    family: 'db4-target',
    schemaVersion: 1,
    senseKey,
    semanticInputFingerprint: fingerprint,
  });
}
export const JsonSchema: z.ZodType<Json> = z.custom<Json>((value) => {
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
}, 'Expected lossless JSON');
export const JsonObject = z.record(JsonSchema);
export function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${label}`);
}
export function assertSorted(values: readonly string[], label: string): void {
  assertUnique(values, label);
  if (values.some((v, i) => i > 0 && values[i - 1] > v))
    throw new Error(`Unsorted ${label}`);
}
export function compareIds(a: string, b: string): number {
  BigintIdSchema.parse(a);
  BigintIdSchema.parse(b);
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

export const SourceSchema = z
  .object({
    key: Text,
    sourceId: z.number().int().positive().max(2147483647).nullable(),
    code: Text,
    version: Text.nullable(),
    snapshot: Text.nullable(),
    sha256: Sha256Schema.nullable(),
    license: Text.nullable(),
    attribution: Text.nullable(),
    url: z
      .string()
      .url()
      .refine((s) => {
        const u = new URL(s);
        return (
          ['http:', 'https:'].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      })
      .nullable(),
    batchIds: z.array(z.string().uuid()),
    audit: z
      .object({
        status: z.enum(['verified', 'blocked']),
        evidence: z.array(ArtifactRefSchema),
        reasons: z.array(Text),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (new Set(s.batchIds).size !== s.batchIds.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate source batch IDs' });
    if (
      s.audit.status === 'verified' &&
      (!s.sha256 ||
        (!s.version && !s.snapshot) ||
        !s.license ||
        /CẦN XÁC MINH|UNKNOWN|UNVERIFIED/i.test(s.license) ||
        !s.attribution ||
        !s.url ||
        !s.audit.evidence.length ||
        s.audit.reasons.length)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Verified source requires complete audit provenance',
      });
    if (s.audit.status === 'blocked' && !s.audit.reasons.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Blocked source requires reasons',
      });
  });
export type MappingSource = z.infer<typeof SourceSchema>;

export const SemanticSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(['fixture', 'production']),
    sourceSnapshots: z.array(
      z.object({ sourceKey: Text, sha256: Sha256Schema }).strict(),
    ),
    identityHash: Sha256Schema,
    senseInputHash: Sha256Schema,
    conceptInputHash: Sha256Schema,
    rawAttributesHash: Sha256Schema,
    sourcePolicyVersion: Text,
    normalizerVersion: Text,
    retrievalVersion: Text,
  })
  .strict();
export function semanticInputFingerprint(value: unknown): string {
  canonicalJson(value);
  const snapshot = SemanticSnapshotSchema.parse(value);
  assertSorted(
    snapshot.sourceSnapshots.map((s) => s.sourceKey),
    'snapshot sources',
  );
  return hashJson({ family: 'db4-semantic-snapshot', ...snapshot });
}
export const PromotionBaselineSchema = z
  .object({
    schemaVersion: z.literal(1),
    targetIdentityHash: Sha256Schema,
    existingLinksHash: Sha256Schema,
    candidateDecisionsHash: Sha256Schema,
    conceptPolicyHash: Sha256Schema,
    migrationsHash: Sha256Schema,
    servingDefinitionHash: Sha256Schema,
  })
  .strict();
export function promotionBaselineFingerprint(value: unknown): string {
  canonicalJson(value);
  return hashJson({
    family: 'db4-promotion-baseline',
    ...PromotionBaselineSchema.parse(value),
  });
}
