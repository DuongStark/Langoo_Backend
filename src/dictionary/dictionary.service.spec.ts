import { LanguageRepository } from '../db/repositories/language.repository';
import { DictionarySearchRepository } from './repositories/dictionary-search.repository';
import { KanjiRepository } from './repositories/kanji.repository';
import { ReverseLookupRepository } from './repositories/reverse-lookup.repository';
import { SearchHistoryRepository } from './repositories/search-history.repository';
import { SenseCardRepository } from './repositories/sense-card.repository';
import { SenseContentRepository } from './repositories/sense-content.repository';
import { SensePairRepository } from './repositories/sense-pair.repository';
import {
  DictionaryService,
  escapeLike,
  getSearchQueryVariants,
  normalizeQuery,
} from './dictionary.service';

function firstArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as unknown[];
  return call[0] as T;
}

const senseCard = {
  senseId: 1n,
  lexemeId: 1n,
  languageId: 2,
  lemma: '走る',
  reading: 'はしる',
  romanization: 'hashiru',
  pos: 'verb',
  frequencyRank: 100,
  homographNo: 1,
  senseNo: 1,
  definition: 'to run',
  definitionLanguageId: 1,
  register: null,
  domain: null,
  isPrimary: true,
  glossVi: 'chạy',
  glossViMachine: false,
  glossViReviewed: false,
  glossEn: 'to run',
  conceptId: 1n,
};

function createSetup(): {
  service: DictionaryService;
  repos: {
    search: { search: jest.Mock };
    senseCard: {
      getBySenseId: jest.Mock;
      hasLexeme: jest.Mock;
      getByLexemeId: jest.Mock;
    };
    content: {
      getGlosses: jest.Mock;
      getExamples: jest.Mock;
      getPronunciations: jest.Mock;
      getForms: jest.Mock;
    };
    pairs: { findLinks: jest.Mock };
    kanji: {
      getByLiteral: jest.Mock;
      getStrokeAsset: jest.Mock;
      getComponents: jest.Mock;
    };
    history: { create: jest.Mock; listRecent: jest.Mock };
    languages: { findIdByCode: jest.Mock; findExistingIds: jest.Mock };
    storage: { get: jest.Mock; put: jest.Mock; delete: jest.Mock };
    reverse: { findViSources: jest.Mock; findJaTargets: jest.Mock };
  };
} {
  const repos = {
    search: { search: jest.fn() },
    senseCard: {
      getBySenseId: jest.fn(),
      hasLexeme: jest.fn(),
      getByLexemeId: jest.fn(),
    },
    content: {
      getGlosses: jest.fn(),
      getExamples: jest.fn(),
      getPronunciations: jest.fn(),
      getForms: jest.fn(),
    },
    pairs: { findLinks: jest.fn() },
    kanji: {
      getByLiteral: jest.fn(),
      getStrokeAsset: jest.fn(),
      getComponents: jest.fn(),
    },
    history: { create: jest.fn(), listRecent: jest.fn() },
    languages: { findIdByCode: jest.fn(), findExistingIds: jest.fn() },
    storage: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
    reverse: { findViSources: jest.fn(), findJaTargets: jest.fn() },
  };
  const service = new DictionaryService(
    repos.search as unknown as DictionarySearchRepository,
    repos.senseCard as unknown as SenseCardRepository,
    repos.content as unknown as SenseContentRepository,
    repos.pairs as unknown as SensePairRepository,
    repos.kanji as unknown as KanjiRepository,
    repos.history as unknown as SearchHistoryRepository,
    repos.languages as unknown as LanguageRepository,
    repos.storage,
    repos.reverse as unknown as ReverseLookupRepository,
  );
  return { service, repos };
}

describe('DictionaryService', () => {
  describe('search', () => {
    const hitRow = {
      lexeme_id: 2n,
      language_id: 1,
      lang_code: 'en',
      surface: 'run',
      reading: null,
      pos: 'verb',
      frequency_rank: 110,
      homograph_no: 1,
      surface_kind: 'lemma',
      is_exact: true,
    };

    it('escape ký tự LIKE và map bigint → chuỗi, không ghi history khi không có user', async () => {
      const { service, repos } = createSetup();
      repos.search.search.mockResolvedValue([hitRow]);

      const result = await service.search({ q: '100%_run\\' });

      const args = firstArg<{
        queries: string[];
        patterns: string[];
        lang: string | null;
        limit: number;
        cursor: unknown;
      }>(repos.search.search);
      expect(args.queries).toEqual(['100%_run\\']);
      expect(args.patterns).toEqual(['100\\%\\_run\\\\']);
      expect(args.lang).toBeNull();
      expect(args.limit).toBe(21);
      expect(args.cursor).toBeNull();
      expect(result.data[0]).toMatchObject({
        lexeme_id: '2',
        lang_code: 'en',
        surface: 'run',
        is_exact: true,
      });
      expect(repos.history.create).not.toHaveBeenCalled();
    });

    it('có user → ghi history với normalized + language_id + result_count', async () => {
      const { service, repos } = createSetup();
      repos.search.search.mockResolvedValue([hitRow]);
      repos.languages.findIdByCode.mockResolvedValue(1);

      await service.search({ q: '  Run  Đây  ', lang: 'en', limit: 5 }, 7n);

      expect(repos.languages.findIdByCode).toHaveBeenCalledWith('en');
      const entry = firstArg<{
        userId: bigint;
        rawQuery: string;
        normalized: string;
        languageId: number | null;
        resultCount: number;
      }>(repos.history.create);
      expect(entry).toMatchObject({
        userId: 7n,
        rawQuery: '  Run  Đây  ',
        normalized: 'run đây',
        languageId: 1,
        resultCount: 1,
      });
      const searchArgs = firstArg<{ lang: string | null; limit: number }>(
        repos.search.search,
      );
      expect(searchArgs.lang).toBe('en');
      expect(searchArgs.limit).toBe(6);
    });

    it('suggestions giới hạn 5 mặt chữ duy nhất và không ghi history', async () => {
      const { service, repos } = createSetup();
      repos.search.search.mockResolvedValue([hitRow]);
      repos.languages.findIdByCode.mockResolvedValue(1);

      const result = await service.suggest({ q: '  book  ', lang: 'en' });

      expect(result.data).toHaveLength(1);
      expect(result.next_cursor).toBeNull();
      expect(repos.languages.findIdByCode).toHaveBeenCalledWith('en');
      expect(repos.search.search).toHaveBeenCalledWith(
        expect.objectContaining({
          queries: ['book'],
          patterns: ['book'],
          lang: 'en',
          limit: 5,
          cursor: null,
          deduplicateSurface: true,
        }),
      );
      expect(repos.history.create).not.toHaveBeenCalled();
    });

    it('suggestions từ chối ngôn ngữ không tồn tại', async () => {
      const { service, repos } = createSetup();
      repos.languages.findIdByCode.mockResolvedValue(null);

      await expect(
        service.suggest({ q: 'book', lang: 'xx' }),
      ).rejects.toMatchObject({
        code: 'LANGUAGE_NOT_FOUND',
      });
      expect(repos.search.search).not.toHaveBeenCalled();
    });

    it('q chỉ có khoảng trắng → VALIDATION_FAILED và không chạm repository', async () => {
      const { service, repos } = createSetup();

      await expect(service.search({ q: '   ' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(repos.search.search).not.toHaveBeenCalled();
      expect(repos.history.create).not.toHaveBeenCalled();
    });

    it('lang không tồn tại → LANGUAGE_NOT_FOUND, không tìm kiếm', async () => {
      const { service, repos } = createSetup();
      repos.languages.findIdByCode.mockResolvedValue(null);

      await expect(
        service.search({ q: 'run', lang: 'xx' }),
      ).rejects.toMatchObject({ code: 'LANGUAGE_NOT_FOUND' });
      expect(repos.search.search).not.toHaveBeenCalled();
    });

    it('trang có dòng dư → trả cursor theo khóa cuối', async () => {
      const { service, repos } = createSetup();
      repos.search.search.mockResolvedValue([
        {
          ...hitRow,
          exact_rank: 0,
          prefix_rank: 0,
          frequency_null_rank: 0,
          frequency_sort: 110,
          surface_length: 3,
        },
        {
          ...hitRow,
          lexeme_id: 3n,
          surface: 'runner',
          exact_rank: 1,
          prefix_rank: 0,
          frequency_null_rank: 0,
          frequency_sort: 120,
          surface_length: 6,
        },
      ]);

      const result = await service.search({ q: 'run', limit: 1 });

      expect(result.data).toHaveLength(1);
      expect(result.next_cursor).toEqual(expect.any(String));
    });
  });

  describe('getSenseDetail', () => {
    it('không có sense → SENSE_NOT_FOUND', async () => {
      const { service, repos } = createSetup();
      repos.senseCard.getBySenseId.mockResolvedValue(null);

      await expect(service.getSenseDetail(999999n)).rejects.toMatchObject({
        code: 'SENSE_NOT_FOUND',
      });
    });

    it('ghép card + glosses + examples + pronunciations + forms (id dạng chuỗi)', async () => {
      const { service, repos } = createSetup();
      repos.senseCard.getBySenseId.mockResolvedValue(senseCard);
      repos.content.getGlosses.mockResolvedValue([
        {
          id: 2n,
          language_id: 3,
          text: 'chạy',
          detail: null,
          is_machine: false,
          reviewed: false,
          quality: null,
          rank: 1,
        },
      ]);
      repos.content.getExamples.mockResolvedValue([
        {
          id: 1n,
          language_id: 2,
          text: '毎朝公園を走ります',
          translation: { en: 'I run in the park every morning.' },
          difficulty: null,
        },
      ]);
      repos.content.getPronunciations.mockResolvedValue([
        {
          id: 2n,
          ipa: null,
          audio_key: 'demo/audio/ja/走る.mp3',
          dialect: 'Tokyo',
        },
      ]);
      repos.content.getForms.mockResolvedValue([
        {
          id: 1n,
          kind: 'kanji',
          form_text: '走る',
          form_order: 1,
          is_common: true,
        },
      ]);

      const result = await service.getSenseDetail(1n);

      expect(repos.content.getPronunciations).toHaveBeenCalledWith(1n);
      expect(repos.content.getExamples).toHaveBeenCalledWith(1n, 5);
      expect(result.card).toMatchObject({
        sense_id: '1',
        lemma: '走る',
        gloss_vi: 'chạy',
        concept_id: '1',
      });
      expect(result.glosses[0]).toMatchObject({ id: '2', text: 'chạy' });
      expect(result.examples[0]).toMatchObject({
        id: '1',
        translation: { en: 'I run in the park every morning.' },
      });
      expect(result.pronunciations[0]).toMatchObject({
        id: '2',
        audio_key: 'demo/audio/ja/走る.mp3',
      });
      expect(result.forms[0]).toMatchObject({
        form_text: '走る',
        kind: 'kanji',
      });
    });
  });

  describe('getLexemeSenses', () => {
    it('lexeme không tồn tại → LEXEME_NOT_FOUND', async () => {
      const { service, repos } = createSetup();
      repos.senseCard.hasLexeme.mockResolvedValue(false);

      await expect(service.getLexemeSenses(999999n)).rejects.toMatchObject({
        code: 'LEXEME_NOT_FOUND',
      });
      expect(repos.senseCard.getByLexemeId).not.toHaveBeenCalled();
    });

    it('map danh sách sense theo lexeme', async () => {
      const { service, repos } = createSetup();
      repos.senseCard.hasLexeme.mockResolvedValue(true);
      repos.senseCard.getByLexemeId.mockResolvedValue([senseCard]);
      repos.languages.findIdByCode.mockResolvedValue(1);

      const result = await service.getLexemeSenses(1n);

      expect(repos.senseCard.getByLexemeId).toHaveBeenCalledWith(1n);
      expect(result.data[0]).toMatchObject({
        sense_id: '1',
        lexeme_id: '1',
        lemma: '走る',
      });
      expect(result.next_cursor).toBeNull();
    });

    it('sense con trùng supergloss → gom vào sub_senses với gloss lá', async () => {
      const { service, repos } = createSetup();
      repos.senseCard.hasLexeme.mockResolvedValue(true);
      repos.senseCard.getByLexemeId.mockResolvedValue([
        {
          ...senseCard,
          senseId: 10n,
          senseNo: 1,
          definition: 'A round fruit',
          glossEnIsHierarchy: true,
          glossEnContext: ['A common fruit', 'A round fruit'],
        },
        {
          ...senseCard,
          senseId: 11n,
          senseNo: 2,
          definition: 'Any fruit or vegetable',
          glossEnIsHierarchy: true,
          glossEnContext: ['A common fruit', 'Any fruit or vegetable'],
        },
      ]);

      const result = await service.getLexemeSenses(1n);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].definition).toBe('A round fruit');
      expect(result.data[0].group_heading).toBe('A common fruit');
      expect(result.data[0].sub_senses).toHaveLength(1);
      expect(result.data[0].sub_senses[0]).toMatchObject({
        sense_id: '11',
        definition: 'Any fruit or vegetable',
        sub_senses: [],
      });
    });

    it('untrusted context stays separate; grouped and flat preserve every real card', async () => {
      const { service, repos } = createSetup();
      repos.senseCard.hasLexeme.mockResolvedValue(true);
      const input = [
        {
          ...senseCard,
          senseId: 10n,
          definition: 'Leaf one',
          glossEnIsHierarchy: true,
          glossEnContext: ['Parent', 'Leaf one'],
        },
        {
          ...senseCard,
          senseId: 11n,
          definition: 'Leaf two',
          glossEnIsHierarchy: true,
          glossEnContext: ['Parent', 'Middle', 'Leaf two'],
        },
        {
          ...senseCard,
          senseId: 12n,
          definition: 'Reviewed',
          glossEnIsHierarchy: false,
          glossEnContext: ['Parent', 'Reviewed'],
        },
        {
          ...senseCard,
          senseId: 13n,
          definition: 'Later',
          glossEnIsHierarchy: true,
          glossEnContext: ['Parent', 'Later'],
        },
        {
          ...senseCard,
          senseId: 14n,
          definition: 'JMdict',
          glossEnContext: ['Parent', 'Alternative'],
        },
      ];
      repos.senseCard.getByLexemeId.mockResolvedValue(input);
      const grouped = await service.getLexemeSenses(1n);
      const flat = await service.getLexemeSenses(1n, 'flat');
      expect(grouped.data).toHaveLength(4);
      expect(grouped.data[0].sub_senses[0].definition).toBe('Leaf two');
      const expanded = grouped.data.flatMap((card) => [
        { ...card, group_heading: null, sub_senses: [] },
        ...card.sub_senses,
      ]);
      expect(expanded).toEqual(flat.data);
      expect(flat.data.every((card) => card.sub_senses.length === 0)).toBe(
        true,
      );
    });

    it('supergloss khác nhau → tách nhóm riêng', async () => {
      const { service, repos } = createSetup();
      repos.senseCard.hasLexeme.mockResolvedValue(true);
      repos.senseCard.getByLexemeId.mockResolvedValue([
        {
          ...senseCard,
          senseId: 10n,
          senseNo: 1,
          definition: 'A',
          glossEnContext: ['A'],
        },
        {
          ...senseCard,
          senseId: 11n,
          senseNo: 2,
          definition: 'B',
          glossEnContext: ['B'],
        },
      ]);

      const result = await service.getLexemeSenses(1n);

      expect(result.data).toHaveLength(2);
      expect(result.data.every((card) => card.sub_senses.length === 0)).toBe(
        true,
      );
      expect(result.data[1].definition).toBe('B');
    });
  });

  describe('getSenseLinks', () => {
    it('sense không tồn tại → SENSE_NOT_FOUND', async () => {
      const { service, repos } = createSetup();
      repos.senseCard.getBySenseId.mockResolvedValue(null);

      await expect(service.getSenseLinks(999999n)).rejects.toMatchObject({
        code: 'SENSE_NOT_FOUND',
      });
      expect(repos.pairs.findLinks).not.toHaveBeenCalled();
    });

    it('map cặp song ngữ (bigint → chuỗi)', async () => {
      const { service, repos } = createSetup();
      repos.senseCard.getBySenseId.mockResolvedValue(senseCard);
      repos.pairs.findLinks.mockResolvedValue([
        {
          sense_id: 2n,
          language_id: 1,
          lemma: 'run',
          reading: null,
          romanization: null,
          confidence: 1,
          concept_id: 1n,
        },
      ]);

      const result = await service.getSenseLinks(1n);

      expect(result.data[0]).toEqual({
        sense_id: '2',
        language_id: 1,
        lemma: 'run',
        reading: null,
        romanization: null,
        confidence: 1,
        concept_id: '1',
      });
      expect(result.next_cursor).toBeNull();
    });
  });

  describe('getKanji', () => {
    it('không có chữ → KANJI_NOT_FOUND', async () => {
      const { service, repos } = createSetup();
      repos.kanji.getByLiteral.mockResolvedValue(null);

      await expect(service.getKanji('X')).rejects.toMatchObject({
        code: 'KANJI_NOT_FOUND',
      });
    });

    it('map đủ trường, used_in_forms bigint → số, radical null khi thiếu', async () => {
      const { service, repos } = createSetup();
      repos.kanji.getByLiteral.mockResolvedValue({
        literal: '走',
        codepoint_ucs: 36208,
        grade: 2,
        stroke_count: 7,
        frequency_rank: 300,
        jlpt_old: 3,
        jlpt_new: 4,
        radical_classical: null,
        radical_char: null,
        radical_name_vi: null,
        radical_meaning_vi: null,
        readings: { on: ['ソウ'] },
        meanings: { vi: ['chạy'] },
        nanori: null,
        query_codes: null,
        used_in_forms: 12n,
        media_kinds: null,
        parts: [
          {
            char: '走',
            position: 1,
            is_radical: true,
            radical_number: 156,
            name_vi: 'Tẩu',
            meaning_vi: 'Chạy',
          },
          { char: 'x', position: null, is_radical: false },
          { char: 123, position: 2, is_radical: false },
        ],
      });

      repos.kanji.getComponents.mockResolvedValue([]);

      const result = await service.getKanji('走');

      expect(result).toMatchObject({
        literal: '走',
        stroke_count: 7,
        used_in_forms: 12,
        radical: null,
        components: null,
      });
      expect(result.readings).toEqual({ on: ['ソウ'] });
      expect(result.parts).toEqual([
        {
          char: '走',
          position: 1,
          is_radical: true,
          radical_number: 156,
          name_vi: 'Tẩu',
          meaning_vi: 'Chạy',
        },
        {
          char: 'x',
          position: null,
          is_radical: false,
          radical_number: null,
          name_vi: null,
          meaning_vi: null,
        },
      ]);
    });

    it('dựng cây components từ rows KanjiVG (preorder → nested)', async () => {
      const { service, repos } = createSetup();
      repos.kanji.getByLiteral.mockResolvedValue({
        literal: '猫',
        codepoint_ucs: 29483,
        grade: null,
        stroke_count: 11,
        frequency_rank: null,
        jlpt_old: null,
        jlpt_new: null,
        radical_classical: 94,
        radical_char: '犬',
        radical_name_vi: 'Khuyển',
        radical_meaning_vi: 'Con chó',
        readings: {},
        meanings: {},
        nanori: null,
        query_codes: null,
        used_in_forms: 0n,
        media_kinds: ['stroke_svg'],
        parts: [],
      });
      repos.kanji.getComponents.mockResolvedValue([
        {
          ord: 0,
          parent_ord: null,
          depth: 0,
          component: '猫',
          original: null,
          is_variant: false,
          is_radical: false,
          is_phonetic: false,
          position: null,
          part: null,
          strokes: [],
          stroke_count: 0,
          radical_number: null,
          name_vi: null,
          meaning_vi: null,
        },
        {
          ord: 1,
          parent_ord: 0,
          depth: 1,
          component: '⺨',
          original: '犬',
          is_variant: true,
          is_radical: true,
          is_phonetic: false,
          position: 'left',
          part: null,
          strokes: [1, 2, 3],
          stroke_count: 3,
          radical_number: 94,
          name_vi: 'Khuyển',
          meaning_vi: 'Con chó',
        },
        {
          ord: 2,
          parent_ord: 0,
          depth: 1,
          component: '苗',
          original: null,
          is_variant: false,
          is_radical: false,
          is_phonetic: true,
          position: 'right',
          part: null,
          strokes: [],
          stroke_count: 0,
          radical_number: null,
          name_vi: null,
          meaning_vi: null,
        },
        {
          ord: 3,
          parent_ord: 2,
          depth: 2,
          component: '艹',
          original: '艸',
          is_variant: true,
          is_radical: false,
          is_phonetic: false,
          position: 'top',
          part: null,
          strokes: [4, 5, 6],
          stroke_count: 3,
          radical_number: null,
          name_vi: null,
          meaning_vi: null,
        },
      ]);

      const result = await service.getKanji('猫');

      expect(result.components?.char).toBe('猫');
      expect(result.components?.children).toHaveLength(2);
      expect(result.components?.children[0]).toMatchObject({
        char: '⺨',
        original: '犬',
        position: 'left',
        is_radical: true,
        strokes: [1, 2, 3],
      });
      expect(result.components?.children[1].children[0]).toMatchObject({
        char: '艹',
        original: '艸',
        position: 'top',
      });
    });
  });

  describe('getKanjiStroke', () => {
    it('trả buffer + mime + sha256 từ storage', async () => {
      const { service, repos } = createSetup();
      repos.kanji.getStrokeAsset.mockResolvedValue({
        objectKey: 'kanjivg/0732b.svg',
        mime: 'image/svg+xml',
        sha256: 'abc123',
        bytes: 10,
      });
      repos.storage.get.mockResolvedValue(Buffer.from('<svg/>'));

      const result = await service.getKanjiStroke('猫');

      expect(result.mime).toBe('image/svg+xml');
      expect(result.sha256).toBe('abc123');
      expect(result.buffer.toString()).toBe('<svg/>');
      expect(repos.storage.get).toHaveBeenCalledWith('kanjivg/0732b.svg');
    });

    it('thiếu metadata hoặc thiếu file → KANJI_STROKE_NOT_FOUND', async () => {
      const { service, repos } = createSetup();
      repos.kanji.getStrokeAsset.mockResolvedValue(null);
      await expect(service.getKanjiStroke('X')).rejects.toMatchObject({
        code: 'KANJI_STROKE_NOT_FOUND',
      });

      repos.kanji.getStrokeAsset.mockResolvedValue({
        objectKey: 'kanjivg/xxxx.svg',
        mime: 'image/svg+xml',
        sha256: 'abc123',
        bytes: 10,
      });
      repos.storage.get.mockResolvedValue(null);
      await expect(service.getKanjiStroke('X')).rejects.toMatchObject({
        code: 'KANJI_STROKE_NOT_FOUND',
      });
    });
  });

  describe('reverseLookup', () => {
    it('VI → EN + JA: exact_sense lên trước, dedupe, gọi repo đúng tham số', async () => {
      const { service, repos } = createSetup();
      repos.reverse.findViSources.mockResolvedValue([
        {
          source_lexeme_id: 1775198n,
          target_text: 'cát',
          sense_hint: 'finely ground rock',
          source_ordinal: 1,
          en_lemma: 'sand',
          en_pos: 'noun',
          frequency_rank: 3409,
        },
      ]);
      repos.reverse.findJaTargets.mockResolvedValue([
        {
          source_lexeme_id: 1775198n,
          target_text: '砂浜',
          sense_hint: 'beach or other expanse of sand',
          source_ordinal: 1,
        },
        {
          source_lexeme_id: 1775198n,
          target_text: '砂',
          sense_hint: 'finely ground rock',
          source_ordinal: 2,
        },
      ]);
      const result = await service.reverseLookup('  cát  ', undefined);
      expect(result.matched).toBe(true);
      expect(result.en).toHaveLength(1);
      expect(result.en[0]).toMatchObject({
        lemma: 'sand',
        frequency_rank: 3409,
      });
      expect(result.ja.map((hit) => hit.text)).toEqual(['砂', '砂浜']);
      expect(result.ja[0].exact_sense).toBe(true);
      expect(result.ja[0].via_lemma).toBe('sand');
      expect(repos.reverse.findViSources).toHaveBeenCalledWith('cát', 'cát');
    });

    it("to='en' không truy vấn JA", async () => {
      const { service, repos } = createSetup();
      repos.reverse.findViSources.mockResolvedValue([
        {
          source_lexeme_id: 1n,
          target_text: 'nước',
          sense_hint: null,
          source_ordinal: 1,
          en_lemma: 'water',
          en_pos: 'noun',
          frequency_rank: 100,
        },
      ]);
      const result = await service.reverseLookup('nước', 'en');
      expect(result.en[0].lemma).toBe('water');
      expect(result.ja).toEqual([]);
      expect(repos.reverse.findJaTargets).not.toHaveBeenCalled();
    });

    it('không match → matched=false, mảng rỗng', async () => {
      const { service, repos } = createSetup();
      repos.reverse.findViSources.mockResolvedValue([]);
      const result = await service.reverseLookup('zzz', undefined);
      expect(result).toEqual({ query: 'zzz', matched: false, en: [], ja: [] });
    });

    it('từ khóa rỗng → VALIDATION_FAILED', async () => {
      const { service } = createSetup();
      await expect(
        service.reverseLookup('   ', undefined),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});
describe('escapeLike / normalizeQuery', () => {
  it('escape đúng %, _, \\', () => {
    expect(escapeLike('100%_run\\')).toBe('100\\%\\_run\\\\');
    expect(escapeLike('bình thường')).toBe('bình thường');
  });

  it('normalize: trim, lowercase, gộp khoảng trắng', () => {
    expect(normalizeQuery('  Run  Đây  ')).toBe('run đây');
  });

  it('tạo biến thể kana cho romaji tiếng Nhật, giữ nguyên tiếng Anh', () => {
    expect(getSearchQueryVariants('hashiru', 'ja')).toEqual([
      'hashiru',
      'はしる',
    ]);
    expect(getSearchQueryVariants('run', 'en')).toEqual(['run']);
  });
});
