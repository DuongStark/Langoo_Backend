import { z } from 'zod';
import {
  ArtifactRefSchema,
  Count,
  Sha256Schema,
  Text,
  hashJson,
} from './_mapping-types';

/**
 * Pilot A sampler theo plan §12.1:
 *  - mỗi JLPT level 20 sense = 10 primary + 10 secondary (thiếu thì bù, ghi chú — không giảm size âm thầm)
 *  - phủ category: POS (verb/adj/adverb), đa nghĩa cùng lexeme, lemma dài, nhiều gloss/form
 *  - deterministic theo seed; targetKeys luôn sort tăng dần (hợp đồng pilot manifest).
 */

export const BundlesManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('db4-bundles'),
  mode: z.enum(['fixture', 'production']),
  semanticInputFingerprint: Sha256Schema,
  snapshot: ArtifactRefSchema,
  pilot: ArtifactRefSchema,
  policyVersion: Text,
  seed: Text,
  bundles: z.array(
    z.object({
      bundleKey: Sha256Schema,
      targetKey: Sha256Schema,
      senseKey: Text,
      contextHash: Sha256Schema,
      ref: ArtifactRefSchema,
      candidateCount: Count,
    }),
  ),
});
export type BundlesManifest = z.infer<typeof BundlesManifestSchema>;
export type BundlesManifestRow = BundlesManifest['bundles'][number];

export interface PilotFeatures {
  normalizedPos: string[];
  multiSenseLexeme: boolean;
  longLemma: boolean;
  manyGlosses: boolean;
  manyForms: boolean;
}

export interface PilotPopulationEntry {
  targetKey: string;
  jlptLevel: 1 | 2 | 3 | 4 | 5;
  isPrimary: boolean;
  lexemeKey: string;
  features: PilotFeatures;
}

export interface PilotSampleOptions {
  seed: string;
  perLevel?: number;
  primaryShare?: number;
}

export interface PilotStrataRow {
  targetKey: string;
  jlptLevel: number;
  isPrimary: boolean;
  lexemeKey: string;
}

export interface PilotSampleResult {
  targetKeys: string[];
  strata: PilotStrataRow[];
  coverage: Record<string, number>;
  required: Record<string, number>;
  unfulfilled: string[];
  notes: string[];
}

const CATEGORY_RULES: Record<string, (entry: PilotPopulationEntry) => boolean> =
  {
    verb: (e) => e.features.normalizedPos.includes('verb'),
    adjective: (e) => e.features.normalizedPos.includes('adjective'),
    adverb: (e) => e.features.normalizedPos.includes('adverb'),
    multi_sense: (e) => e.features.multiSenseLexeme,
    long_lemma: (e) => e.features.longLemma,
    many_glosses: (e) => e.features.manyGlosses,
    many_forms: (e) => e.features.manyForms,
  };

export const PILOT_A_REQUIRED: Record<string, number> = {
  verb: 15,
  adjective: 10,
  adverb: 5,
  multi_sense: 12,
  long_lemma: 10,
  many_glosses: 10,
  many_forms: 10,
};

const LEVELS = [1, 2, 3, 4, 5] as const;

function orderKey(seed: string, entry: PilotPopulationEntry): string {
  return hashJson({
    family: 'db4-pilot-a-v1',
    seed,
    targetKey: entry.targetKey,
  });
}

function satisfies(entry: PilotPopulationEntry, category: string): boolean {
  return CATEGORY_RULES[category](entry);
}

function categoryCount(entry: PilotPopulationEntry): number {
  return Object.keys(CATEGORY_RULES).filter((c) => satisfies(entry, c)).length;
}

export function samplePilotA(
  population: readonly PilotPopulationEntry[],
  options: PilotSampleOptions,
): PilotSampleResult {
  const perLevel = options.perLevel ?? 20;
  const primaryShare = options.primaryShare ?? 10;
  if (perLevel % 2 !== 0 || primaryShare * 2 !== perLevel)
    throw new Error('Pilot A cần perLevel chẵn và primaryShare = perLevel/2');
  const notes: string[] = [];
  const selected = new Map<
    string,
    { entry: PilotPopulationEntry; order: string }
  >();
  const strataPool = new Map<string, PilotPopulationEntry[]>();
  for (const level of LEVELS) {
    for (const primary of [true, false]) {
      const pool = population
        .filter((e) => e.jlptLevel === level && e.isPrimary === primary)
        .sort((a, b) => {
          const left = orderKey(options.seed, a);
          const right = orderKey(options.seed, b);
          return left < right ? -1 : left > right ? 1 : 0;
        });
      strataPool.set(`${level}:${primary ? 'p' : 's'}`, pool);
    }
  }
  const pick = (
    key: string,
    count: number,
    candidates?: PilotPopulationEntry[],
  ): number => {
    const pool = candidates ?? strataPool.get(key)!;
    let taken = 0;
    for (const entry of pool) {
      if (taken >= count) break;
      if (selected.has(entry.targetKey)) continue;
      selected.set(entry.targetKey, {
        entry,
        order: orderKey(options.seed, entry),
      });
      taken += 1;
    }
    return taken;
  };
  for (const level of LEVELS) {
    const primaryKey = `${level}:p`;
    const secondaryKey = `${level}:s`;
    const primaryPool = strataPool.get(primaryKey)!;
    const primaryTaken = pick(primaryKey, primaryShare);
    if (primaryTaken < primaryShare)
      notes.push(
        `JLPT${level}: thiếu primary (${primaryTaken}/${primaryShare}) — bù từ secondary cùng level`,
      );
    const need = perLevel - selectedLevelCount(selected, level);
    const secondaryBefore = [...selected.values()].filter(
      ({ entry }) => entry.jlptLevel === level && !entry.isPrimary,
    ).length;
    const secondaryTaken = pick(secondaryKey, need);
    if (secondaryBefore + secondaryTaken < need)
      notes.push(
        `JLPT${level}: stratum thiếu (primary ${primaryPool.length}, secondary ${strataPool.get(secondaryKey)!.length})`,
      );
  }
  if (selected.size < perLevel * LEVELS.length) {
    const remaining = population
      .filter((e) => !selected.has(e.targetKey))
      .sort((a, b) => {
        const left = orderKey(options.seed, a);
        const right = orderKey(options.seed, b);
        return left < right ? -1 : left > right ? 1 : 0;
      });
    for (const entry of remaining) {
      if (selected.size >= perLevel * LEVELS.length) break;
      selected.set(entry.targetKey, {
        entry,
        order: orderKey(options.seed, entry),
      });
    }
  }
  const isProtected = (key: string): boolean => {
    const { entry } = selected.get(key)!;
    for (const [category, required] of Object.entries(PILOT_A_REQUIRED)) {
      if (!satisfies(entry, category)) continue;
      const count = [...selected.values()].filter(({ entry: other }) =>
        satisfies(other, category),
      ).length;
      if (count <= required) return true;
    }
    return false;
  };
  for (const category of Object.keys(PILOT_A_REQUIRED)) {
    const required = PILOT_A_REQUIRED[category];
    for (;;) {
      const current = [...selected.values()].filter(({ entry }) =>
        satisfies(entry, category),
      ).length;
      if (current >= required) break;
      let swapped = false;
      for (const level of LEVELS) {
        for (const primary of [true, false]) {
          const poolKey = `${level}:${primary ? 'p' : 's'}`;
          const pool = strataPool.get(poolKey)!;
          const incoming = pool.find(
            (e) => !selected.has(e.targetKey) && satisfies(e, category),
          );
          if (!incoming) continue;
          const outgoing = [...selected.values()]
            .filter(
              ({ entry }) =>
                entry.jlptLevel === level &&
                entry.isPrimary === primary &&
                !satisfies(entry, category) &&
                !isProtected(entry.targetKey),
            )
            .sort((a, b) => {
              const left = categoryCount(a.entry);
              const right = categoryCount(b.entry);
              if (left !== right) return left - right;
              return a.order < b.order ? 1 : -1;
            })[0];
          if (!outgoing) continue;
          selected.delete(outgoing.entry.targetKey);
          selected.set(incoming.targetKey, {
            entry: incoming,
            order: orderKey(options.seed, incoming),
          });
          swapped = true;
          break;
        }
        if (swapped) break;
      }
      if (!swapped) break;
    }
  }
  const chosen = [...selected.values()].map(({ entry }) => entry);
  chosen.sort((a, b) => (a.targetKey < b.targetKey ? -1 : 1));
  const coverage: Record<string, number> = {};
  for (const [category, rule] of Object.entries(CATEGORY_RULES))
    coverage[category] = chosen.filter((entry) => rule(entry)).length;
  const unfulfilled = Object.entries(PILOT_A_REQUIRED)
    .filter(([category, required]) => coverage[category] < required)
    .map(
      ([category, required]) => `${category} ${coverage[category]}/${required}`,
    );
  return {
    targetKeys: chosen.map((entry) => entry.targetKey),
    strata: chosen.map((entry) => ({
      targetKey: entry.targetKey,
      jlptLevel: entry.jlptLevel,
      isPrimary: entry.isPrimary,
      lexemeKey: entry.lexemeKey,
    })),
    coverage,
    required: { ...PILOT_A_REQUIRED },
    unfulfilled,
    notes,
  };
}

function selectedLevelCount(
  selected: Map<string, { entry: PilotPopulationEntry }>,
  level: number,
): number {
  return [...selected.values()].filter(({ entry }) => entry.jlptLevel === level)
    .length;
}
