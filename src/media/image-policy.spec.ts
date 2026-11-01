import { classifyImageSource, selectRootSense } from './image-policy';
import { SenseImageSource, RootResolutionRow } from './types/image.types';

describe('image-policy', () => {
  describe('classifyImageSource', () => {
    it('nhóm 1 (adjective) và nhóm 2 (noun) giữ kind direct, không fallback root', () => {
      const adjSource: SenseImageSource = {
        sense_id: 1n,
        lemma: 'boiled',
        pos: 'adjective',
        language_id: 1,
        definition: 'cooked in boiling water',
        directCandidate: null,
      };
      expect(classifyImageSource(adjSource)).toEqual({
        kind: 'direct',
      });

      const nounSource: SenseImageSource = {
        sense_id: 2n,
        lemma: 'building',
        pos: 'noun',
        language_id: 1,
        definition: 'a structure with walls and a roof',
        directCandidate: null,
      };
      expect(classifyImageSource(nounSource)).toEqual({
        kind: 'direct',
      });
    });

    it('nhóm 3: verbal inflections và plural nouns match parser bảo thủ', () => {
      const verbPast: SenseImageSource = {
        sense_id: 3n,
        lemma: 'cooked',
        pos: 'verb',
        language_id: 1,
        definition: 'simple past and past participle of cook.',
        directCandidate: null,
      };
      expect(classifyImageSource(verbPast)).toEqual({
        kind: 'inflection',
        rootLemma: 'cook',
        rootPos: 'verb',
      });

      const nounPlural: SenseImageSource = {
        sense_id: 4n,
        lemma: 'boxes',
        pos: 'noun',
        language_id: 1,
        definition: 'plural of box',
        directCandidate: null,
      };
      expect(classifyImageSource(nounPlural)).toEqual({
        kind: 'inflection',
        rootLemma: 'box',
        rootPos: 'noun',
      });
    });

    it('nhóm 4: trợ động từ / từ ngữ pháp trừu tượng trả no_image', () => {
      const aux: SenseImageSource = {
        sense_id: 5n,
        lemma: 'been',
        pos: 'verb',
        language_id: 1,
        definition: 'past participle of be',
        directCandidate: null,
      };
      expect(classifyImageSource(aux)).toEqual({
        kind: 'no_image',
      });

      const logic: SenseImageSource = {
        sense_id: 6n,
        lemma: 'truth',
        pos: 'noun',
        language_id: 1,
        definition: 'in propositional logic, a valuation',
        directCandidate: null,
      };
      expect(classifyImageSource(logic)).toEqual({
        kind: 'direct',
      });
    });

    it('câu định nghĩa chỉ chứa cụm inflection ở giữa không match parser', () => {
      const sentence: SenseImageSource = {
        sense_id: 7n,
        lemma: 'something',
        pos: 'verb',
        language_id: 1,
        definition: 'used as simple past of make when referring to history',
        directCandidate: null,
      };
      expect(classifyImageSource(sentence)).toEqual({
        kind: 'direct',
      });
    });
  });

  describe('selectRootSense', () => {
    const source: SenseImageSource = {
      sense_id: 10n,
      lemma: 'cooked',
      pos: 'verb',
      language_id: 1,
      definition: 'simple past of cook',
      directCandidate: null,
    };

    it('ưu tiên quan hệ verified method inflection_root_verified_v1 với confidence >= 0.9', () => {
      const relations: RootResolutionRow[] = [
        {
          source_sense_id: 10n,
          target_sense_id: 20n,
          method: 'inflection_root_verified_v1',
          confidence: 0.95,
          target_language_id: 1,
          target_pos: 'verb',
          target_lemma: 'cook',
          target_definition: 'prepare food',
        },
      ];
      expect(selectRootSense(source, relations, [])).toBe(20n);
    });

    it('từ chối quan hệ thiếu method hợp lệ hoặc confidence thấp', () => {
      const relations: RootResolutionRow[] = [
        {
          source_sense_id: 10n,
          target_sense_id: 20n,
          method: 'wordnet_derivation',
          confidence: 0.95,
          target_language_id: 1,
          target_pos: 'verb',
          target_lemma: 'cook',
          target_definition: 'prepare food',
        },
        {
          source_sense_id: 10n,
          target_sense_id: 21n,
          method: 'inflection_root_verified_v1',
          confidence: 0.85, // thấp hơn 0.9
        },
      ];
      expect(selectRootSense(source, relations, [])).toBeNull();
    });

    it('từ chối khi có nhiều target relation hợp lệ (ambiguous)', () => {
      const relations: RootResolutionRow[] = [
        {
          source_sense_id: 10n,
          target_sense_id: 20n,
          method: 'inflection_root_verified_v1',
          confidence: 0.95,
          target_language_id: 1,
          target_pos: 'verb',
          target_lemma: 'cook',
          target_definition: 'prepare food',
        },
        {
          source_sense_id: 10n,
          target_sense_id: 21n,
          method: 'inflection_root_verified_v1',
          confidence: 0.95,
          target_language_id: 1,
          target_pos: 'verb',
          target_lemma: 'cook',
          target_definition: 'prepare food',
        },
      ];
      expect(selectRootSense(source, relations, [])).toBeNull();
    });

    it('phân giải lexical root khi không có relation: chỉ dùng khi đúng 1 root sense tồn tại', () => {
      const lexicalRootsSingle = [
        { sense_id: 30n, lemma: 'cook', pos: 'verb' },
      ];
      expect(selectRootSense(source, [], lexicalRootsSingle)).toBe(30n);

      const lexicalRootsMultiple = [
        { sense_id: 30n, lemma: 'cook', pos: 'verb' },
        { sense_id: 31n, lemma: 'cook', pos: 'verb' },
      ];
      // Nhiều hơn 1 nghĩa root -> trả null (không đoán bừa)
      expect(selectRootSense(source, [], lexicalRootsMultiple)).toBeNull();
    });
  });
});

describe('M14.3 review regressions', () => {
  const source: SenseImageSource = {
    sense_id: 10n,
    lemma: 'cooked',
    pos: 'verb',
    language_id: 1,
    definition: 'simple past of cook',
    directCandidate: null,
  };
  it('does not classify a physical grammar book as abstract', () => {
    expect(
      classifyImageSource({
        ...source,
        lemma: 'textbook',
        pos: 'noun',
        definition: 'a book containing grammatical rules',
      }).kind,
    ).toBe('direct');
  });
  it('rejects a relation with no validated target descriptors', () => {
    expect(
      selectRootSense(
        source,
        [
          {
            source_sense_id: 10n,
            target_sense_id: 20n,
            method: 'inflection_root_verified_v1',
            confidence: 0.95,
          },
        ],
        [],
      ),
    ).toBeNull();
  });
});

it.each([
  { target_language_id: 2 },
  { target_pos: 'noun' },
  { target_definition: 'simple past of cook' },
  { target_definition: 'past participle of be' },
  { target_lemma: 'other' },
])('rejects invalid relation target %j', (patch) => {
  const source: SenseImageSource = {
    sense_id: 10n,
    lemma: 'cooked',
    pos: 'verb',
    language_id: 1,
    definition: 'simple past of cook',
    directCandidate: null,
  };
  expect(
    selectRootSense(
      source,
      [
        {
          source_sense_id: 10n,
          target_sense_id: 20n,
          method: 'inflection_root_verified_v1',
          confidence: 0.95,
          target_language_id: 1,
          target_pos: 'verb',
          target_lemma: 'cook',
          target_definition: 'prepare food',
          ...patch,
        },
      ],
      [],
    ),
  ).toBeNull();
});
