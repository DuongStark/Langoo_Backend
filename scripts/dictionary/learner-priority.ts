/** M4.5: deterministic, offline pilot. No provider, DB write or sense merge. */
import { createHash } from 'node:crypto';

export interface SourceSense {
  senseId: string;
  lexemeId: string;
  lemma: string;
  pos: string;
  source: string;
  sourceVersion: string | null;
  senseNo: number;
  definition: string;
  rawDefinition: string | null;
  glossEnContext: string[];
  glossVi: string | null;
  glossViMachine: boolean | null;
  glossViReviewed: boolean | null;
  register: string | null;
  domain: string | null;
  attributes: Record<string, unknown>;
  frequencyRank: number | null;
}

export interface WordNetEvidence {
  lemma: string;
  pos: string;
  lexicon: string;
  synsetId: string;
  sourceSenseId: string;
  entryRank: number;
  count: number | null;
  countRows: number;
  definition: string | null;
}

export interface RankedSense extends SourceSense {
  wordnet: WordNetEvidence | null;
  binding: 'exact' | 'missing' | 'ambiguous' | 'definition_drift';
  tags: string[];
  topics: string[];
  tier: number;
  priorityReason: string;
  inputHash: string;
}

const historical = new Set(['obsolete', 'archaic', 'dated', 'historical']);
const rare = new Set(['rare', 'rarely', 'uncommon']);
// Only explicit narrow technical topics; e.g. animals, computing, music are not
// blanket demoted. This is a learner heuristic, not measured sense frequency.
const technical = new Set([
  'heraldry',
  'numismatics',
  'mineralogy',
  'entomology',
  'taxonomy',
]);

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalized(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function bindEvidence(
  sense: SourceSense,
  evidence: WordNetEvidence[],
): Pick<RankedSense, 'binding' | 'wordnet'> {
  const lexicon = sense.attributes.lexicon;
  if (
    !['omw-en', 'oewn'].includes(sense.source) ||
    typeof lexicon !== 'string' ||
    lexicon !== `${sense.source}:${sense.sourceVersion}`
  )
    return { binding: 'missing', wordnet: null };
  const matches = evidence.filter(
    (row) =>
      row.lexicon === lexicon &&
      row.synsetId === sense.attributes.synset_id &&
      row.lemma === sense.lemma &&
      row.pos === sense.pos,
  );
  if (matches.length !== 1)
    return {
      binding: matches.length > 1 ? 'ambiguous' : 'missing',
      wordnet: null,
    };
  const row = matches[0];
  if (
    !sense.rawDefinition ||
    !row.definition ||
    normalized(sense.rawDefinition) !== normalized(row.definition)
  )
    return { binding: 'definition_drift', wordnet: null };
  return { binding: 'exact', wordnet: row };
}

export function enrich(
  sense: SourceSense,
  evidence: WordNetEvidence[],
): RankedSense {
  if (!/^\d+$/.test(sense.senseId) || !/^\d+$/.test(sense.lexemeId))
    throw new Error('Invalid sense/lexeme identity');
  if (!Number.isInteger(sense.senseNo) || sense.senseNo < 1)
    throw new Error('Invalid source order');
  const tags = [
    ...new Set([
      ...strings(sense.attributes.tags),
      ...(sense.register ? [sense.register] : []),
    ]),
  ];
  const topics = strings(sense.attributes.topics);
  const isHistorical = tags.some((tag) => historical.has(tag));
  const isRare = tags.some((tag) => rare.has(tag));
  const isTechnical = topics.some((topic) => technical.has(topic));
  const tier = !sense.definition.trim()
    ? 3
    : isHistorical
      ? 2
      : isRare || isTechnical
        ? 1
        : 0;
  const bound = bindEvidence(sense, evidence);
  const reasons: string[] = [];
  if (!sense.definition.trim()) reasons.push('nguồn thiếu định nghĩa');
  if (isHistorical) reasons.push('nhãn nguồn: cổ/không còn dùng');
  if (isRare) reasons.push('nhãn nguồn: hiếm');
  if (isTechnical) reasons.push('topic chuyên ngành hẹp');
  if (bound.wordnet?.count != null && bound.wordnet.count > 0)
    reasons.push(`số đếm nguồn ${bound.wordnet.count} (corpus chưa xác minh)`);
  if (bound.wordnet)
    reasons.push(`thứ tự gốc WordNet ${bound.wordnet.entryRank}`);
  else reasons.push(`fallback thứ tự nguồn ${sense.senseNo}`);
  return {
    ...sense,
    ...bound,
    tags,
    topics,
    tier,
    priorityReason: reasons.join('; '),
    inputHash: digest({
      sense,
      evidence: bound,
      policy: 'm4.5-rule-pilot-v1.1',
    }),
  };
}

export function compareSenses(a: RankedSense, b: RankedSense): number {
  const tier = a.tier - b.tier;
  if (tier) return tier;
  const countA = a.wordnet?.count ?? 0;
  const countB = b.wordnet?.count ?? 0;
  if (countA !== countB) return countB - countA;
  // Cross-source choice is a preview policy, never evidence of equivalence.
  // Verified original WordNet order precedes unverified DB source-order fallback.
  const bound = Number(b.wordnet !== null) - Number(a.wordnet !== null);
  if (bound) return bound;
  const rank =
    (a.wordnet?.entryRank ?? a.senseNo) - (b.wordnet?.entryRank ?? b.senseNo);
  if (rank) return rank;
  const sourceOrder = ['omw-en', 'oewn', 'wiktextract'];
  const source = sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source);
  if (source) return source;
  const aa = BigInt(a.senseId),
    bb = BigInt(b.senseId);
  return aa < bb ? -1 : aa > bb ? 1 : 0;
}

export function rankWord(
  senses: SourceSense[],
  evidence: WordNetEvidence[],
): RankedSense[] {
  if (new Set(senses.map((sense) => sense.lemma)).size !== 1)
    throw new Error('Ranking must stay within one exact headword');
  return senses.map((sense) => enrich(sense, evidence)).sort(compareSenses);
}
