import { SenseImageSource, RootResolutionRow } from './types/image.types';

export interface ClassificationResult {
  kind: 'direct' | 'inflection' | 'no_image';
  rootLemma?: string;
  rootPos?: string;
}

const GRAMMAR_REGEX =
  /^(?:simple past(?: and past participle)?|past participle|present participle(?: and gerund)?|gerund|plural|third-person singular(?: simple present)?) of\s+([a-z][a-z -]*?)[.!]?$/i;

const AUXILIARY_ROOTS = new Set([
  'be',
  'have',
  'become',
  'seem',
  'exist',
  'matter',
  'belong',
]);

export function classifyImageSource(
  source: SenseImageSource,
): ClassificationResult {
  const definition = (source.definition || '').trim();

  const match = GRAMMAR_REGEX.exec(definition);
  if (match) {
    const root = match[1].toLowerCase().trim();
    if (AUXILIARY_ROOTS.has(root)) {
      return { kind: 'no_image' };
    }
    const isPlural = /^plural of/i.test(definition);
    const rootPos = isPlural ? 'noun' : 'verb';
    if (source.pos !== rootPos) return { kind: 'direct' };
    return {
      kind: 'inflection',
      rootLemma: root,
      rootPos,
    };
  }

  return { kind: 'direct' };
}

export function selectRootSense(
  source: SenseImageSource,
  relations: RootResolutionRow[],
  lexicalRoots: { sense_id: bigint; lemma: string; pos: string | null }[],
): bigint | null {
  const classification = classifyImageSource(source);
  if (classification.kind !== 'inflection') return null;
  const sourceRelations = relations.filter(
    (r) => r.source_sense_id === source.sense_id,
  );

  if (sourceRelations.length > 0) {
    const validRelations = sourceRelations.filter(
      (r) =>
        r.target_sense_id !== source.sense_id &&
        r.method === 'inflection_root_verified_v1' &&
        r.confidence >= 0.9 &&
        r.target_language_id === source.language_id &&
        r.target_pos === classification.rootPos &&
        r.target_lemma?.toLowerCase() === classification.rootLemma &&
        typeof r.target_definition === 'string' &&
        classifyImageSource({
          sense_id: r.target_sense_id,
          lemma: r.target_lemma ?? '',
          pos: r.target_pos ?? null,
          language_id: r.target_language_id ?? 0,
          definition: r.target_definition,
          directCandidate: null,
        }).kind === 'direct',
    );

    // If there are invalid/unsupported relations or conflicting relations, return null
    if (
      validRelations.length !== sourceRelations.length ||
      validRelations.length !== 1
    ) {
      return null;
    }

    return validRelations[0].target_sense_id;
  }

  // Fallback to lexical search when no explicit relation exists:
  // Must have EXACTLY 1 candidate root sense across the whole language/pos set
  if (lexicalRoots.length === 1) {
    return lexicalRoots[0].sense_id;
  }

  return null;
}
