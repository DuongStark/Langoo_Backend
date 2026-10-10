import { readFileSync } from 'node:fs';
import {
  bindEvidence,
  enrich,
  rankWord,
  type SourceSense,
  type WordNetEvidence,
} from './learner-priority';
import { escapeHtml, renderPilot } from './learner-priority-report';

const sense: SourceSense = {
  senseId: '9007199254740993',
  lexemeId: '1',
  lemma: 'cat',
  pos: 'noun',
  source: 'omw-en',
  sourceVersion: '1.4',
  senseNo: 5,
  definition: 'a feline animal',
  rawDefinition: 'a feline animal',
  glossEnContext: [],
  glossVi: null,
  glossViMachine: null,
  glossViReviewed: null,
  register: null,
  domain: null,
  attributes: { lexicon: 'omw-en:1.4', synset_id: 'omw-en-cat-n' },
  frequencyRank: 1727,
};
const evidence: WordNetEvidence = {
  lemma: 'cat',
  pos: 'noun',
  lexicon: 'omw-en:1.4',
  synsetId: 'omw-en-cat-n',
  sourceSenseId: 'source-cat',
  entryRank: 1,
  count: 18,
  countRows: 1,
  definition: 'a feline animal',
};

describe('M4.5 source binding and deterministic learner ranking', () => {
  it('binds only the exact lexical sense/version with unchanged definition', () => {
    expect(bindEvidence(sense, [evidence]).binding).toBe('exact');
    for (const patch of [
      { lemma: 'dog' },
      { pos: 'verb' },
      { lexicon: 'omw-en:2.0' },
      { synsetId: 'different' },
    ])
      expect(bindEvidence(sense, [{ ...evidence, ...patch }]).binding).toBe(
        'missing',
      );
    expect(
      bindEvidence({ ...sense, sourceVersion: '2.0' }, [evidence]).binding,
    ).toBe('missing');
  });
  it('never transfers OMW counts to a different source by concept/definition', () => {
    expect(
      bindEvidence(
        {
          ...sense,
          source: 'wiktextract',
          attributes: { ...sense.attributes, concept_id: '1' },
        },
        [evidence],
      ).wordnet,
    ).toBeNull();
  });
  it('withholds evidence on ambiguous binding or changed source definition', () => {
    expect(bindEvidence(sense, [evidence, evidence]).binding).toBe('ambiguous');
    expect(
      bindEvidence({ ...sense, rawDefinition: 'a different meaning' }, [
        evidence,
      ]).binding,
    ).toBe('definition_drift');
  });
  it('restores original WordNet order instead of using DB sense_no', () => {
    const other = {
      ...sense,
      senseId: '9007199254740992',
      senseNo: 1,
      attributes: { ...sense.attributes, synset_id: 'other' },
    };
    const ranked = rankWord(
      [other, sense],
      [
        { ...evidence, count: null },
        { ...evidence, synsetId: 'other', entryRank: 2, count: null },
      ],
    );
    expect(ranked[0].senseId).toBe(sense.senseId);
  });
  it('demotes explicit historical senses even with a high old count', () => {
    const other = {
      ...sense,
      senseId: '2',
      attributes: { ...sense.attributes, tags: ['obsolete'] },
    };
    expect(rankWord([other, sense], [evidence])[0].senseId).toBe(sense.senseId);
    expect(enrich(other, [evidence]).tier).toBe(2);
  });
  it('does not treat unknown count or absent tags as rare', () => {
    const result = enrich(sense, []);
    expect(result.tier).toBe(0);
    expect(result.wordnet).toBeNull();
    expect(result.priorityReason).toContain('fallback');
  });
  it('preserves an undefined sense in the inventory without recommending it', () => {
    const missing = { ...sense, senseId: '2', definition: '' };
    const result = rankWord([missing, sense], [evidence]);
    expect(result).toHaveLength(2);
    expect(result[0].senseId).toBe(sense.senseId);
    expect(result[1].tier).toBe(3);
  });
  it('does not blanket demote animal/computing/music topics', () => {
    for (const topic of ['zoology', 'computing', 'music'])
      expect(
        enrich(
          { ...sense, attributes: { ...sense.attributes, topics: [topic] } },
          [evidence],
        ).tier,
      ).toBe(0);
  });
  it('keeps distinct senses/POS and safely breaks ties beyond JS safe integers', () => {
    const other = { ...sense, senseId: '9007199254740992' };
    expect(rankWord([sense, other], [evidence]).map((x) => x.senseId)).toEqual([
      other.senseId,
      sense.senseId,
    ]);
    expect(() =>
      rankWord([sense, { ...sense, lemma: 'dog' }], [evidence]),
    ).toThrow();
  });
  it('rejects invalid IDs/order instead of emitting an unusable pilot card', () => {
    expect(() => enrich({ ...sense, senseId: '1e2' }, [])).toThrow();
    expect(() => enrich({ ...sense, senseNo: 0 }, [])).toThrow();
  });
  it('escapes stored dictionary HTML and preserves all sense IDs in the report', () => {
    const ranked = enrich(
      { ...sense, definition: '<script>alert("x")</script>' },
      [evidence],
    );
    const html = renderPilot(
      [
        {
          lemma: 'cat',
          senses: [ranked],
          recommended: ranked,
          previous: ranked,
          changed: false,
        },
      ],
      {},
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain(sense.senseId);
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });
  it('locks the pilot to 100 distinct headwords including the requested cases', () => {
    const cohort = JSON.parse(
      readFileSync('scripts/dictionary/learner-priority-cohort.json', 'utf8'),
    ) as { words: string[] };
    expect(cohort.words).toHaveLength(100);
    expect(new Set(cohort.words).size).toBe(100);
    for (const word of ['cat', 'dog', 'book', 'run', 'draw'])
      expect(cohort.words).toContain(word);
  });
});
