// DB4-D4: frozen initial request shape and deterministic reply normalization.
import { z } from 'zod';
import {
  MappingBundle,
  MappingBundleSchema,
  Sha256Schema,
  Text,
  parseMappingBundleIntegrity,
} from './_mapping-types';
const Phase = z.enum(['r1', 'r2']);
export const RequestSchema = z
  .object({
    jobKey: Sha256Schema,
    targetKey: Sha256Schema,
    senseKey: Text,
    phase: Phase,
    generation: z.number().int().min(1).max(2),
    bundleKey: Sha256Schema,
    promptVersion: Text,
    promptHash: Sha256Schema,
    renderedContextHash: Sha256Schema,
    dependencyJobKey: Sha256Schema.nullable(),
    payload: z
      .object({
        schemaVersion: z.literal(1),
        phase: Phase,
        seed: Text,
        promptVersion: Text,
        bundle: MappingBundleSchema,
      })
      .strict(),
  })
  .strict();
export type Request = z.infer<typeof RequestSchema>;
export function cleanReply(raw: string): unknown {
  const trimmed = raw.trim();
  const clean = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;
  return JSON.parse(clean) as unknown;
}

export function renderedIntegrityBundle(bundleValue: unknown): MappingBundle {
  const rendered = MappingBundleSchema.parse(bundleValue);
  return parseMappingBundleIntegrity({
    ...rendered,
    candidates: [...rendered.candidates].sort((a, b) =>
      a.candidateKey < b.candidateKey
        ? -1
        : a.candidateKey > b.candidateKey
          ? 1
          : 0,
    ),
  });
}
