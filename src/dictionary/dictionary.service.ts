import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { StudyLanguageScopeService } from '../users/study-language-scope.service';
import { toHiragana } from 'wanakana';
import { maxLength } from 'class-validator';
import { DomainException } from '../common/errors/domain.exception';
import {
  DeinflectCandidate,
  deinflectJapaneseDetailed,
  katakanaToHiragana,
} from '../common/japanese/jp-deinflect';
import { LanguageRepository } from '../db/repositories/language.repository';
import { STORAGE_SERVICE, StorageService } from '../storage/storage.service';
import {
  SearchQueryDto,
  DICTIONARY_SEARCH_MAX_LENGTH,
} from './dto/search-query.dto';
import { ReverseSuggestionQueryDto } from './dto/reverse-suggestion-query.dto';
import { SuggestionQueryDto } from './dto/suggestion-query.dto';
import {
  decodeDictionarySearchCursor,
  encodeDictionarySearchCursor,
} from './dictionary-search-cursor';
import {
  KanjiComponent,
  KanjiPart,
  LexemeSensesResult,
  ReverseLookupEnHit,
  ReverseLookupJaHit,
  ReverseLookupResult,
  SearchResult,
  SenseCardResponse,
  SenseDetailResponse,
  SenseLinkItem,
  SenseLinksResult,
  KanjiCardResponse,
  SearchHit,
} from './types/dictionary.types';
import { JapanesePriorityRepository } from './repositories/japanese-priority.repository';
import {
  DeinflectSearchRow,
  DictionarySearchRepository,
  SearchRow,
} from './repositories/dictionary-search.repository';
import {
  KanjiComponentRow,
  KanjiRepository,
  KanjiRow,
} from './repositories/kanji.repository';
import {
  ReverseLookupRepository,
  ReverseReferenceRequest,
  ReverseReferenceCandidate,
  ViSourceRow,
  JaTargetRow,
} from './repositories/reverse-lookup.repository';
import { EnglishPriorityRepository } from './repositories/english-priority.repository';
import { SearchHistoryRepository } from './repositories/search-history.repository';
import { SenseCardRepository } from './repositories/sense-card.repository';
import {
  ExampleRow,
  FormRow,
  GlossRow,
  PronunciationRow,
  SenseContentRepository,
} from './repositories/sense-content.repository';
import {
  SenseLinkRow,
  SensePairRepository,
} from './repositories/sense-pair.repository';
import { SenseCard } from './types/sense-card';
import { SenseImageService } from '../media/sense-image.service';
import { ImageContract } from '../media/types/image.types';

const EXAMPLES_LIMIT = 5;
const DEFAULT_SEARCH_LIMIT = 20;
const SUGGESTION_LIMIT = 5;
const SENSE_LINK_LIMIT = 3;
const SENSE_LINK_SEARCH_BATCH = 6;

/**
 * Đọc từ điển: search, sense detail, cặp song ngữ, kanji.
 * Chỉ đọc `core`/`serve`; ghi duy nhất `app.search_history` (khi có user).
 */
@Injectable()
export class DictionaryService {
  constructor(
    private readonly searchRepo: DictionarySearchRepository,
    private readonly senseCardRepo: SenseCardRepository,
    private readonly contentRepo: SenseContentRepository,
    private readonly pairRepo: SensePairRepository,
    private readonly kanjiRepo: KanjiRepository,
    private readonly historyRepo: SearchHistoryRepository,
    private readonly languages: LanguageRepository,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly japanesePriority: JapanesePriorityRepository,
    private readonly reverseRepo: ReverseLookupRepository,
    private readonly studyScope: StudyLanguageScopeService,
    private readonly englishPriority: EnglishPriorityRepository,
    private readonly senseImageService?: SenseImageService,
  ) {}

  async search(dto: SearchQueryDto, userId?: bigint): Promise<SearchResult> {
    const query = dto.q.trim();
    if (query.length === 0) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'Từ khóa không được để trống',
        HttpStatus.BAD_REQUEST,
      );
    }

    const limit = dto.limit ?? DEFAULT_SEARCH_LIMIT;
    const scope = await this.studyScope.resolve(userId);
    const languageCode = dto.lang ?? null;
    const cursor =
      dto.cursor === undefined
        ? null
        : decodeDictionarySearchCursor(dto.cursor);
    if (
      cursor &&
      (cursor.query !== query ||
        cursor.lang !== languageCode ||
        cursor.scopeKey !== scope?.key)
    ) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'Cursor không thuộc truy vấn hiện tại',
        HttpStatus.BAD_REQUEST,
      );
    }

    let languageId: number | null = null;
    if (dto.lang !== undefined) {
      languageId = await this.languages.findIdByCode(dto.lang);
      if (languageId === null) {
        throw new DomainException(
          'LANGUAGE_NOT_FOUND',
          `Ngôn ngữ không tồn tại: ${dto.lang}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const queryVariants = getSearchQueryVariants(query, languageCode);
    // A single kana is a dictionary entry (あ, う, ア…) and also a very common
    // substring/reading. Keep search on the exact tier so う/あ do not scan
    // every word containing that kana; typing more characters unlocks prefixes.
    const singleKana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]$/u.test(
      query,
    );
    const rows = await this.searchRepo.search({
      queries: queryVariants,
      patterns: queryVariants.map(escapeLike),
      lang: languageCode,
      ...(scope ? { allowedLanguageIds: scope.languageIds } : {}),
      limit: limit + 1,
      cursor,
      singleKanaExactOnly: singleKana,
    });
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    let baseHits = pageRows.map(toSearchHit);

    if (cursor === null) {
      const deinflectedHits = await this.findDeinflectedJapaneseHits(
        query,
        languageCode,
        scope,
        pageRows,
        limit,
      );
      if (deinflectedHits.length > 0) {
        const seenIds = new Set(deinflectedHits.map((h) => h.lexeme_id));
        const merged = [
          ...deinflectedHits,
          ...baseHits.filter((h) => !seenIds.has(h.lexeme_id)),
        ];
        baseHits = merged.slice(0, limit);
      }
    }

    const data = await this.addEnglishPreviews(
      await this.addJapanesePreviews(baseHits),
    );

    if (userId !== undefined && cursor === null) {
      await this.historyRepo.create({
        userId,
        rawQuery: dto.q,
        normalized: normalizeQuery(dto.q),
        languageId,
        resultCount: data.length,
      });
    }

    const lastRow = pageRows.at(-1);
    return {
      data,
      next_cursor:
        hasNext && lastRow
          ? encodeDictionarySearchCursor({
              version: 7,
              query,
              lang: languageCode,
              ...(scope ? { scopeKey: scope.key } : {}),
              exactRank: lastRow.exact_rank,
              prefixRank: lastRow.prefix_rank,
              jaSourceRank: lastRow.ja_source_rank,
              viTranslationRank: lastRow.vi_translation_rank,
              frequencyNullRank: lastRow.frequency_null_rank,
              frequencyRank: lastRow.frequency_sort,
              surfaceLength: lastRow.surface_length,
              surfaceGroupId: lastRow.surface_group_id.toString(),
              learnerSort: lastRow.learner_sort,
              lexemeId: lastRow.lexeme_id.toString(),
              surfaceKind: lastRow.surface_kind,
              surface: lastRow.surface,
            })
          : null,
    };
  }

  /**
   * Tra ngược Việt→Anh/Nhật: VI assertion → source lexeme tiếng Anh → JA assertions.
   * `to`: 'en', 'ja' hoặc 'en,ja' (mặc định en,ja). Không match → matched=false.
   */
  async reverseLookup(
    q: string,
    to?: string,
    userId?: bigint,
  ): Promise<ReverseLookupResult> {
    const query = q.trim().replace(/\s+/g, ' ');
    if (query.length === 0)
      throw new DomainException(
        'VALIDATION_FAILED',
        'Từ khóa không được để trống',
        HttpStatus.BAD_REQUEST,
      );
    if (query.length > 64)
      throw new DomainException(
        'VALIDATION_FAILED',
        'Từ khóa tối đa 64 ký tự',
        HttpStatus.BAD_REQUEST,
      );
    const scope = await this.studyScope.resolve(userId);
    const targets = new Set((to ?? 'en,ja').split(','));
    if (scope) {
      for (const target of targets) {
        const id = await this.languages.findIdByCode(target);
        if (id === null || !scope.languageIds.includes(id))
          targets.delete(target);
      }
    }
    if (targets.size === 0) return { query, matched: false, en: [], ja: [] };
    const lowered = query.toLowerCase();
    const sources = await this.reverseRepo.findViSources(query, lowered);
    const { en, ja } = await this.mapReverseHits(targets, sources, 10, 12);
    return {
      query,
      matched: (targets.has('en') && en.length > 0) || ja.length > 0,
      en,
      ja,
    };
  }

  /**
   * Autocomplete VI→(EN/JA): prefix, không phân biệt hoa/thường và dấu.
   * Cùng shape với reverseLookup để FE render thống nhất.
   */
  async suggestReverse(
    dto: ReverseSuggestionQueryDto,
    userId?: bigint,
  ): Promise<ReverseLookupResult> {
    const query = dto.q.trim().replace(/\s+/g, ' ');
    if (query.length === 0)
      throw new DomainException(
        'VALIDATION_FAILED',
        'Từ khóa không được để trống',
        HttpStatus.BAD_REQUEST,
      );
    const scope = await this.studyScope.resolve(userId);
    const targets = new Set((dto.to ?? 'en,ja').split(','));
    if (scope) {
      for (const target of targets) {
        const id = await this.languages.findIdByCode(target);
        if (id === null || !scope.languageIds.includes(id))
          targets.delete(target);
      }
    }
    if (targets.size === 0) return { query, matched: false, en: [], ja: [] };
    const limit = dto.limit ?? 8;
    const sources = await this.reverseRepo.findViSourcesByPrefix(query);
    const { en, ja } = await this.mapReverseHits(
      targets,
      sources,
      limit,
      limit,
      true,
    );
    return {
      query,
      matched: (targets.has('en') && en.length > 0) || ja.length > 0,
      en,
      ja,
    };
  }

  private async mapReverseHits(
    targets: Set<string>,
    sources: ViSourceRow[],
    enLimit: number,
    jaLimit = enLimit,
    preferSourceOrder = false,
  ): Promise<{ en: ReverseLookupEnHit[]; ja: ReverseLookupJaHit[] }> {
    const en: ReverseLookupEnHit[] = [];
    const sourceIds: bigint[] = [];
    const seenLexeme = new Set<string>();
    const viByLexeme = new Map<string, string | null>();
    for (const row of sources) {
      const key = String(row.source_lexeme_id);
      if (seenLexeme.has(key)) continue;
      seenLexeme.add(key);
      sourceIds.push(row.source_lexeme_id);
      viByLexeme.set(key, row.target_text);
      en.push(
        serializeReverseEn({
          lexemeId: key,
          preview: null,
          lemma: row.en_lemma,
          pos: row.en_pos,
          frequencyRank: row.frequency_rank,
          senseHint: row.sense_hint,
          vi: row.target_text,
        }),
      );
      if (en.length >= enLimit) break;
    }
    let ja: ReverseLookupJaHit[] = [];
    const jaReferences = new Map<string, JaTargetRow>();
    if (targets.has('ja') && en.length > 0) {
      const hintByLexeme = new Map(
        en.map((hit) => [
          String(hit.lexemeId),
          hit.senseHint ? hit.senseHint.toLowerCase() : null,
        ]),
      );
      const lemmaByLexeme = new Map(
        en.map((hit) => [String(hit.lexemeId), hit.lemma]),
      );
      const rows = await this.reverseRepo.findJaTargets(sourceIds);
      const seenJa = new Set<string>();
      const enOrder = new Map(
        en.map((hit, index) => [String(hit.lexemeId), index]),
      );
      ja = rows
        .map((row) => {
          const hint = hintByLexeme.get(String(row.source_lexeme_id)) ?? null;
          return {
            referenceSource: row,
            lexeme_id: null,
            sense_id: null,
            preview: null,
            sourceOrdinal: row.source_ordinal ?? 0,
            text: row.target_text,
            senseHint: row.sense_hint,
            viaLexemeId: String(row.source_lexeme_id),
            viaLemma: targets.has('en')
              ? (lemmaByLexeme.get(String(row.source_lexeme_id)) ?? '')
              : '',
            exactSense:
              row.sense_hint !== null &&
              hint !== null &&
              row.sense_hint.toLowerCase() === hint,
            vi: viByLexeme.get(String(row.source_lexeme_id)) ?? null,
          };
        })
        // Choose a winner within each text BEFORE discarding duplicates.
        .sort(
          (a, b) =>
            Number(b.exactSense) - Number(a.exactSense) ||
            (enOrder.get(a.viaLexemeId) ?? 0) -
              (enOrder.get(b.viaLexemeId) ?? 0) ||
            a.sourceOrdinal - b.sourceOrdinal ||
            compareText(a.viaLexemeId, b.viaLexemeId) ||
            compareText(a.senseHint ?? '', b.senseHint ?? ''),
        )
        .filter((hit) => {
          if (seenJa.has(hit.text)) return false;
          seenJa.add(hit.text);
          jaReferences.set(hit.text, hit.referenceSource);
          return true;
        })
        .sort((a, b) => {
          if (preferSourceOrder) {
            const ai = enOrder.get(a.viaLexemeId) ?? Number.MAX_SAFE_INTEGER;
            const bi = enOrder.get(b.viaLexemeId) ?? Number.MAX_SAFE_INTEGER;
            if (ai !== bi) return ai - bi;
          }
          return (
            Number(b.exactSense) - Number(a.exactSense) ||
            (enOrder.get(a.viaLexemeId) ?? 0) -
              (enOrder.get(b.viaLexemeId) ?? 0) ||
            a.sourceOrdinal - b.sourceOrdinal ||
            compareText(a.text, b.text)
          );
        })
        .slice(0, jaLimit)
        .map((hit) => serializeReverseJa(hit));
    }
    const references: ReverseReferenceRequest[] = [];
    if (targets.has('en'))
      for (const hit of en) {
        const row = sources.find(
          (source) => source.source_lexeme_id.toString() === hit.lexeme_id,
        )!;
        references.push({
          key: `en:${hit.lexeme_id}`,
          kind: 'en',
          source_lexeme_id: hit.lexeme_id,
          source_sense_id: row.source_sense_id?.toString() ?? null,
          assertion_id: row.assertion_id?.toString() ?? null,
          text: hit.lemma,
          hint: hit.sense_hint,
        });
      }
    for (const hit of ja) {
      const row = jaReferences.get(hit.text)!;
      references.push({
        key: `ja:${hit.text}`,
        kind: 'ja',
        source_lexeme_id: hit.via_lexeme_id,
        source_sense_id: row.source_sense_id?.toString() ?? null,
        assertion_id: row.assertion_id?.toString() ?? null,
        text: hit.text,
        hint: hit.sense_hint,
      });
    }
    const candidates =
      await this.reverseRepo.findReferenceCandidates(references);
    const selected = new Map<
      string,
      { lexemeId: bigint; senseId: bigint | null }
    >();
    for (const reference of references) {
      const pick = selectReverseReference(
        candidates.filter((row) => row.key === reference.key),
      );
      if (pick) selected.set(reference.key, pick);
    }
    const ids = [
      ...new Set(
        [...selected.values()].flatMap((ref) =>
          ref.senseId === null ? [] : [ref.senseId],
        ),
      ),
    ];
    const cards = ids.length ? await this.senseCardRepo.getBySenseIds(ids) : [];
    const bySense = new Map(cards.map((card) => [card.senseId, card]));
    const previewFor = (key: string, languageId: number) => {
      const ref = selected.get(key);
      const card = ref?.senseId ? bySense.get(ref.senseId) : undefined;
      return card &&
        card.lexemeId === ref!.lexemeId &&
        card.languageId === languageId
        ? toSenseCardResponse(card)
        : null;
    };
    if (targets.has('en'))
      for (const hit of en) hit.preview = previewFor(`en:${hit.lexeme_id}`, 1);
    for (const hit of ja) {
      const ref = selected.get(`ja:${hit.text}`);
      hit.lexeme_id = ref?.lexemeId.toString() ?? null;
      hit.sense_id = ref?.senseId?.toString() ?? null;
      hit.preview = previewFor(`ja:${hit.text}`, 2);
    }
    return {
      en: targets.has('en') ? en : [],
      ja,
    };
  }

  /**
   * Autocomplete: at most five distinct displayed forms. Does not record search
   * history because clients call it for each keystroke.
   */
  async suggest(
    dto: SuggestionQueryDto,
    userId?: bigint,
  ): Promise<SearchResult> {
    const query = dto.q.trim();
    if (query.length === 0) {
      throw new DomainException(
        'VALIDATION_FAILED',
        'Từ khóa không được để trống',
        HttpStatus.BAD_REQUEST,
      );
    }

    const scope = await this.studyScope.resolve(userId);
    const languageCode = dto.lang ?? null;
    if (dto.lang !== undefined) {
      const languageId = await this.languages.findIdByCode(dto.lang);
      if (languageId === null) {
        throw new DomainException(
          'LANGUAGE_NOT_FOUND',
          `Ngôn ngữ không tồn tại: ${dto.lang}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const queryVariants = getSearchQueryVariants(query, languageCode);
    const rows = await this.searchRepo.search({
      queries: queryVariants,
      patterns: queryVariants.map(escapeLike),
      lang: languageCode,
      ...(scope ? { allowedLanguageIds: scope.languageIds } : {}),
      limit: SUGGESTION_LIMIT,
      cursor: null,
      deduplicateSurface: true,
    });

    let baseHits = rows.map(toSearchHit);
    const deinflectedHits = await this.findDeinflectedJapaneseHits(
      query,
      languageCode,
      scope,
      rows,
      SUGGESTION_LIMIT,
    );
    if (deinflectedHits.length > 0) {
      const seenIds = new Set(deinflectedHits.map((h) => h.lexeme_id));
      baseHits = [
        ...deinflectedHits,
        ...baseHits.filter((h) => !seenIds.has(h.lexeme_id)),
      ].slice(0, SUGGESTION_LIMIT);
    }

    return {
      data: await this.addEnglishPreviews(
        await this.addJapanesePreviews(baseHits),
      ),
      next_cursor: null,
    };
  }

  /**
   * M4.9: Khi chưa có hit `is_exact` đáng tin cậy (JMdict hoặc đã có nghĩa VI),
   * thử đưa từ tiếng Nhật về dạng gốc (deinflection) trong 1 câu SQL duy nhất
   * và gắn `deinflected_from = query`.
   *
   * Lưu ý: nếu hit `is_exact` duy nhất chỉ là mục phụ non-JMdict chưa có nghĩa VI
   * (vd mục Wiktionary "polite form of 読む" cho `読みます`), vẫn cho phép deinflect
   * nhưng chỉ nhận dạng gốc chính thống từ JMdict (`ja_source_rank === 0`).
   */
  private async findDeinflectedJapaneseHits(
    query: string,
    languageCode: string | null,
    scope: { languageIds: number[] } | null,
    existingRows: Pick<
      SearchRow,
      'is_exact' | 'lang_code' | 'ja_source_rank' | 'vi_translation_rank'
    >[],
    limit: number,
  ): Promise<SearchHit[]> {
    if (languageCode !== null && languageCode !== 'ja') return [];
    if (scope && !scope.languageIds.includes(2)) return [];
    const hasAuthoritativeExact = existingRows.some(
      (row) =>
        row.is_exact &&
        !(
          row.lang_code === 'ja' &&
          row.ja_source_rank === 1 &&
          row.vi_translation_rank === 1
        ),
    );
    if (hasAuthoritativeExact) return [];
    const requireJmdictOnly = existingRows.some((row) => row.is_exact);
    if (typeof this.searchRepo.findExactJapaneseCandidates !== 'function') {
      return [];
    }

    const rawCandidates = deinflectJapaneseDetailed(query, 8);
    if (rawCandidates.length === 0) return [];

    // Hỗ trợ romaji suru-verb (vd benkyousuru -> benkyou -> べんきょう)
    const candidates: DeinflectCandidate[] = rawCandidates.map((c) => {
      if (/^[a-z]+$/i.test(c.word)) {
        const kana = toHiragana(c.word.toLowerCase());
        return { ...c, word: kana };
      }
      return c;
    });

    const isKana = (s: string) => /^[\u3040-\u309f\u30a0-\u30ffー]+$/.test(s);
    const toKatakana = (s: string) =>
      s.replace(/[\u3041-\u3096]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) + 0x60),
      );

    const candidateWords = [
      ...new Set(
        candidates.flatMap((c) =>
          isKana(c.word)
            ? [c.word, katakanaToHiragana(c.word), toKatakana(c.word)]
            : [c.word],
        ),
      ),
    ];
    const kanaReadings = [
      ...new Set(
        candidates.flatMap((c) =>
          isKana(c.word)
            ? [katakanaToHiragana(c.word), toKatakana(c.word)]
            : [],
        ),
      ),
    ];

    const rows = await this.searchRepo.findExactJapaneseCandidates(
      candidateWords,
      kanaReadings,
      Math.max(limit * 3, 24),
    );
    if (rows.length === 0) return [];

    const byKey = new Map<string, DeinflectSearchRow[]>();
    const addKey = (key: string, row: DeinflectSearchRow) => {
      const list = byKey.get(key);
      if (list) list.push(row);
      else byKey.set(key, [row]);
    };
    for (const row of rows) {
      if (requireJmdictOnly && row.ja_source_rank !== 0) continue;
      addKey(row.matched_key, row);
      if (isKana(row.matched_key)) {
        const hira = katakanaToHiragana(row.matched_key);
        if (hira !== row.matched_key) addKey(hira, row);
      }
    }

    // Gom ứng viên theo `tier` để các ứng viên cùng mức ưu tiên (vd `行った` -> `行う`/`行く`,
    // `降ります` -> `降りる`/`降る`) được so sánh công bằng theo lemma/form & tần suất,
    // trong khi tầng bóc sâu hơn (vd `優れた` -> `優れる` [tier 1] vs `優る` [tier 2]) không xen vào.
    const tierOrder: number[] = [];
    const candidatesByTier = new Map<number, DeinflectCandidate[]>();
    for (const candidate of candidates) {
      const group = candidatesByTier.get(candidate.tier);
      if (group) {
        group.push(candidate);
      } else {
        tierOrder.push(candidate.tier);
        candidatesByTier.set(candidate.tier, [candidate]);
      }
    }

    const picked: SearchHit[] = [];
    const seenLexemeIds = new Set<string>();
    const maxDeinflected = Math.min(limit, 5);

    interface ScoredDeinflectMatch {
      row: DeinflectSearchRow;
      exactScriptRank: number;
      posRank: number;
      candidateOrder: number;
    }

    for (const tier of tierOrder) {
      const tierCandidates = candidatesByTier.get(tier) ?? [];
      const matchedInTier = new Map<string, ScoredDeinflectMatch>();

      for (
        let candidateOrder = 0;
        candidateOrder < tierCandidates.length;
        candidateOrder += 1
      ) {
        const candidate = tierCandidates[candidateOrder];
        const keys = isKana(candidate.word)
          ? [
              candidate.word,
              katakanaToHiragana(candidate.word),
              toKatakana(candidate.word),
            ]
          : [candidate.word];

        for (const key of keys) {
          const list = byKey.get(key);
          if (!list) continue;
          for (const row of list) {
            const id = row.lexeme_id.toString();
            if (seenLexemeIds.has(id)) continue;
            const exactScriptRank = row.matched_key === candidate.word ? 0 : 1;
            const posRank =
              row.pos !== null &&
              (candidate.expectedPos as readonly string[]).includes(row.pos)
                ? 0
                : 1;
            const entry: ScoredDeinflectMatch = {
              row,
              exactScriptRank,
              posRank,
              candidateOrder,
            };
            const prev = matchedInTier.get(id);
            if (
              !prev ||
              entry.exactScriptRank < prev.exactScriptRank ||
              (entry.exactScriptRank === prev.exactScriptRank &&
                entry.posRank < prev.posRank) ||
              (entry.exactScriptRank === prev.exactScriptRank &&
                entry.posRank === prev.posRank &&
                entry.row.match_source < prev.row.match_source)
            ) {
              matchedInTier.set(id, entry);
            }
          }
        }
      }

      if (matchedInTier.size === 0) continue;

      const sorted = [...matchedInTier.values()].sort((a, b) => {
        if (a.row.ja_source_rank !== b.row.ja_source_rank) {
          return a.row.ja_source_rank - b.row.ja_source_rank;
        }
        if (a.exactScriptRank !== b.exactScriptRank) {
          return a.exactScriptRank - b.exactScriptRank;
        }
        if (a.posRank !== b.posRank) {
          return a.posRank - b.posRank;
        }
        if (a.row.vi_translation_rank !== b.row.vi_translation_rank) {
          return a.row.vi_translation_rank - b.row.vi_translation_rank;
        }
        if (a.row.match_source !== b.row.match_source) {
          return a.row.match_source - b.row.match_source;
        }
        const freqA = a.row.frequency_rank ?? Number.MAX_SAFE_INTEGER;
        const freqB = b.row.frequency_rank ?? Number.MAX_SAFE_INTEGER;
        if (freqA !== freqB) return freqA - freqB;
        if (a.candidateOrder !== b.candidateOrder) {
          return a.candidateOrder - b.candidateOrder;
        }
        return a.row.lexeme_id < b.row.lexeme_id
          ? -1
          : a.row.lexeme_id > b.row.lexeme_id
            ? 1
            : 0;
      });

      for (const item of sorted) {
        const id = item.row.lexeme_id.toString();
        if (seenLexemeIds.has(id)) continue;
        seenLexemeIds.add(id);
        picked.push({
          ...toSearchHit(item.row),
          deinflected_from: query,
        });
        if (picked.length >= maxDeinflected) break;
      }

      // Ưu tiên tầng ứng viên cao nhất có kết quả thật (tránh nhiễu từ tầng bóc sâu hơn)
      if (picked.length > 0) break;
    }

    return picked;
  }

  async getLexemeSenses(
    lexemeId: bigint,
    view: 'grouped' | 'flat' = 'grouped',
    userId?: bigint,
  ): Promise<LexemeSensesResult> {
    if (!(await this.senseCardRepo.hasLexeme(lexemeId))) {
      throw new DomainException(
        'LEXEME_NOT_FOUND',
        'Không tìm thấy từ điển',
        HttpStatus.NOT_FOUND,
      );
    }

    const scope = await this.studyScope.resolve(userId);
    const cards = (await this.senseCardRepo.getByLexemeId(lexemeId)).filter(
      (card) => !scope || scope.languageIds.includes(card.languageId),
    );
    if (scope && cards.length === 0) {
      throw new DomainException(
        'LEXEME_NOT_FOUND',
        'Không tìm thấy từ trong hồ sơ học',
        HttpStatus.NOT_FOUND,
      );
    }
    // EN tạm thời: chỉ trả sense đã có gloss VI (fallback giữ nguyên nếu không có sense nào).
    const enId = await this.languages.findIdByCode('en');
    const translated =
      enId === null
        ? cards
        : cards.filter(
            (card) =>
              card.languageId !== enId || (card.glossVi ?? '').trim() !== '',
          );
    const visibleCards = translated.length > 0 ? translated : cards;

    if (view === 'flat') {
      return { data: visibleCards.map(toSenseCardResponse), next_cursor: null };
    }

    const preferences = [
      ...(await this.japanesePriority.getByLexemes([lexemeId])),
      ...(await this.englishPriority.getByLexemes([lexemeId])),
    ];
    const bySense = new Map(preferences.map((row) => [row.sense_id, row]));
    visibleCards.sort(
      (a, b) =>
        (bySense.get(a.senseId)?.display_order ?? a.senseNo) -
        (bySense.get(b.senseId)?.display_order ?? b.senseNo),
    );

    // A group is a contiguous source hierarchy, not a semantic equivalence.
    // The first actual sense remains selectable; its definition is never replaced.
    const data: SenseCardResponse[] = [];
    let currentHeading: string | null = null;
    for (const card of visibleCards) {
      const heading =
        card.glossEnIsHierarchy === true
          ? (card.glossEnContext?.[0] ?? null)
          : null;
      const response = toSenseCardResponse(card);
      const current = data.at(-1);
      if (current && heading !== null && currentHeading === heading) {
        current.sub_senses.push(response);
      } else {
        response.group_heading = heading;
        data.push(response);
        currentHeading = heading;
      }
    }
    const visibleIds = new Set(visibleCards.map((card) => card.senseId));
    return {
      data,
      next_cursor: null,
      recommended_sense_ids: preferences
        .filter((row) => row.recommended && visibleIds.has(row.sense_id))
        .map((row) => row.sense_id.toString()),
      priority_basis: preferences[0]?.basis ?? null,
    };
  }

  private async addEnglishPreviews(hits: SearchHit[]): Promise<SearchHit[]> {
    const ids = hits
      .filter((hit) => hit.lang_code === 'en')
      .map((hit) => BigInt(hit.lexeme_id));
    const preferences = await this.englishPriority.getByLexemes(ids);
    const recommended = new Map<bigint, bigint[]>();
    for (const row of preferences) {
      if (!row.recommended) continue;
      const list = recommended.get(row.lexeme_id);
      if (list) list.push(row.sense_id);
      else recommended.set(row.lexeme_id, [row.sense_id]);
    }
    const candidateIds = new Set<bigint>();
    for (const list of recommended.values())
      for (const id of list) candidateIds.add(id);
    // One content query for the page, rather than a detail request for every hit.
    const cards =
      candidateIds.size > 0
        ? await this.senseCardRepo.getBySenseIds([...candidateIds])
        : [];
    const bySense = new Map(cards.map((card) => [card.senseId, card]));
    const selected = new Map<bigint, bigint>();
    for (const [lexemeId, senseIds] of recommended) {
      // Ưu tiên sense recommended đã có gloss VI cho preview.
      const pick =
        senseIds.find((id) => (bySense.get(id)?.glossVi ?? '').trim() !== '') ??
        senseIds[0];
      selected.set(lexemeId, pick);
    }
    return hits.map((hit) => {
      const id = selected.get(BigInt(hit.lexeme_id));
      const card = id === undefined ? undefined : bySense.get(id);
      return card ? { ...hit, preview: toSenseCardResponse(card) } : hit;
    });
  }

  private async addJapanesePreviews(hits: SearchHit[]): Promise<SearchHit[]> {
    const ids = hits
      .filter((hit) => hit.lang_code === 'ja')
      .map((hit) => BigInt(hit.lexeme_id));
    const preferences = await this.japanesePriority.getByLexemes(ids);
    const selected = new Map<bigint, bigint>();
    for (const row of preferences) {
      if (row.recommended && !selected.has(row.lexeme_id))
        selected.set(row.lexeme_id, row.sense_id);
    }
    // One content query for the page, rather than a detail request for every hit.
    const cards =
      selected.size > 0
        ? await this.senseCardRepo.getBySenseIds([...selected.values()])
        : [];
    const bySense = new Map(cards.map((card) => [card.senseId, card]));
    return hits.map((hit) => {
      const id = selected.get(BigInt(hit.lexeme_id));
      const card = id === undefined ? undefined : bySense.get(id);
      return card ? { ...hit, preview: toSenseCardResponse(card) } : hit;
    });
  }

  async getSenseDetail(
    senseId: bigint,
    userId?: bigint,
  ): Promise<SenseDetailResponse> {
    const card = await this.senseCardRepo.getBySenseId(senseId);
    const scope = await this.studyScope.resolve(userId);
    if (!card || (scope && !scope.languageIds.includes(card.languageId))) {
      throw senseNotFound();
    }

    const [glosses, examples, pronunciations, forms, imageMap] =
      await Promise.all([
        this.contentRepo.getGlosses(senseId),
        this.contentRepo.getExamples(senseId, EXAMPLES_LIMIT),
        this.contentRepo.getPronunciations(card.lexemeId),
        this.contentRepo.getForms(card.lexemeId),
        this.senseImageService
          ? this.senseImageService.resolveMany([senseId])
          : Promise.resolve(new Map<string, ImageContract | null>()),
      ]);

    return {
      card: toSenseCardResponse(card),
      image: imageMap.get(senseId.toString()) ?? null,
      glosses: glosses.map(toGlossItem),
      examples: examples.map(toExampleItem),
      pronunciations: pronunciations.map(toPronunciationItem),
      forms: forms.map(toFormItem),
    };
  }

  async getSenseLinks(
    senseId: bigint,
    userId?: bigint,
  ): Promise<SenseLinksResult> {
    const card = await this.senseCardRepo.getBySenseId(senseId);
    const scope = await this.studyScope.resolve(userId);
    if (!card || (scope && !scope.languageIds.includes(card.languageId))) {
      throw senseNotFound();
    }
    const candidates = (
      await this.pairRepo.findLinks(senseId, scope?.languageIds)
    ).filter(
      (link) =>
        link.language_id !== card.languageId &&
        link.lemma.trim().length > 0 &&
        maxLength(link.lemma, DICTIONARY_SEARCH_MAX_LENGTH) &&
        (!scope || scope.languageIds.includes(link.language_id)),
    );
    const selected: SenseLinkRow[] = [];
    const words = new Set<string>();
    const lexemes = new Set<bigint>();
    // Rank first, then validate in batches until three distinct words qualify.
    // Never cap candidates before visibility/dedup, or hidden duplicates can
    // consume all three positions. Cache only within this request/profile.
    const visibility = new Map<string, Set<bigint>>();
    const queryKey = (link: SenseLinkRow) =>
      JSON.stringify([link.lang_code, link.lemma.trim()]);
    for (
      let offset = 0;
      offset < candidates.length && selected.length < SENSE_LINK_LIMIT;
      offset += SENSE_LINK_SEARCH_BATCH
    ) {
      const batch = candidates.slice(offset, offset + SENSE_LINK_SEARCH_BATCH);
      const missing = new Map<string, SenseLinkRow>();
      for (const link of batch) {
        const key = queryKey(link);
        if (!visibility.has(key)) missing.set(key, link);
      }
      const queries = [...missing.entries()];
      if (queries.length > 0) {
        const hits = await this.searchRepo.searchExactPages(
          queries.map(([, link]) => {
            const variants = getSearchQueryVariants(
              link.lemma.trim(),
              link.lang_code,
            );
            return {
              queries: variants,
              patterns: variants.map(escapeLike),
              lang: link.lang_code,
              allowedLanguageIds: scope?.languageIds,
              limit: DEFAULT_SEARCH_LIMIT,
              cursor: null,
            };
          }),
        );
        queries.forEach(([key]) => visibility.set(key, new Set()));
        for (const hit of hits) {
          const entry = queries[hit.query_index];
          if (entry) visibility.get(entry[0])!.add(hit.lexeme_id);
        }
      }
      for (const link of batch) {
        const word = JSON.stringify([
          link.language_id,
          link.lemma.trim().normalize('NFKC').toLowerCase(),
        ]);
        if (
          words.has(word) ||
          lexemes.has(link.lexeme_id) ||
          !visibility.get(queryKey(link))?.has(link.lexeme_id)
        )
          continue;
        selected.push(link);
        words.add(word);
        lexemes.add(link.lexeme_id);
        if (selected.length === SENSE_LINK_LIMIT) break;
      }
    }
    return {
      data: selected.map(toSenseLinkItem),
      next_cursor: null,
    };
  }

  async getKanji(literal: string, userId?: bigint): Promise<KanjiCardResponse> {
    await this.assertJapaneseScope(userId);
    const row = await this.kanjiRepo.getByLiteral(literal);
    if (!row) {
      throw new DomainException(
        'KANJI_NOT_FOUND',
        'Không tìm thấy chữ Hán',
        HttpStatus.NOT_FOUND,
      );
    }
    const componentRows = await this.kanjiRepo.getComponents(literal);
    return {
      ...toKanjiResponse(row),
      components: buildKanjiComponentTree(componentRows),
    };
  }

  /** Ảnh SVG thứ tự nét (KanjiVG) — đọc file từ storage, metadata từ core. */
  async getKanjiStroke(
    literal: string,
    userId?: bigint,
  ): Promise<{ buffer: Buffer; mime: string; sha256: string }> {
    await this.assertJapaneseScope(userId);
    const asset = await this.kanjiRepo.getStrokeAsset(literal);
    if (!asset) {
      throw new DomainException(
        'KANJI_STROKE_NOT_FOUND',
        'Chưa có ảnh nét cho chữ Hán này',
        HttpStatus.NOT_FOUND,
      );
    }
    const buffer = await this.storage.get(asset.objectKey);
    if (!buffer) {
      throw new DomainException(
        'KANJI_STROKE_NOT_FOUND',
        'Chưa có ảnh nét cho chữ Hán này',
        HttpStatus.NOT_FOUND,
      );
    }
    return { buffer, mime: asset.mime, sha256: asset.sha256 };
  }
  private async assertJapaneseScope(userId?: bigint): Promise<void> {
    const scope = await this.studyScope.resolve(userId);
    if (!scope) return;
    const ja = await this.languages.findIdByCode('ja');
    if (ja === null || !scope.languageIds.includes(ja)) {
      throw new DomainException(
        'KANJI_NOT_FOUND',
        'Không tìm thấy chữ Hán trong hồ sơ học',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}

/** Escape ký tự đặc biệt của LIKE để client không "vô tình" tìm wildcard. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Chuẩn hoá query lưu vào search_history: trim, lowercase, gộp khoảng trắng. */
export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getSearchQueryVariants(
  query: string,
  languageCode: string | null,
): string[] {
  const variants = [query];
  if (
    (languageCode === null || languageCode === 'ja') &&
    /^[A-Za-z][A-Za-z\s'-]*$/.test(query)
  ) {
    const separated = query.replace(/([aeiou])(n)(?=[aeiouy])/gi, "$1$2'");
    const candidates = separated === query ? [query] : [query, separated];
    for (const candidate of candidates) {
      if (candidate !== query) variants.push(candidate);
      const kana = toHiragana(candidate);
      // Do not derive broad single-kana substring searches from Latin input.
      if (kana !== candidate && Array.from(kana).length >= 2)
        variants.push(kana);
    }
  }
  return [...new Set(variants)];
}

function senseNotFound(): DomainException {
  return new DomainException(
    'SENSE_NOT_FOUND',
    'Không tìm thấy nghĩa',
    HttpStatus.NOT_FOUND,
  );
}

function toSearchHit(row: {
  lexeme_id: bigint;
  language_id: number;
  lang_code: string;
  lemma: string;
  surface: string;
  reading: string | null;
  pos: string | null;
  frequency_rank: number | null;
  frequency_source?: string | null;
  homograph_no: number | null;
  surface_kind: string;
  is_exact: boolean;
}): SearchHit {
  return {
    lexeme_id: row.lexeme_id.toString(),
    language_id: row.language_id,
    lang_code: row.lang_code,
    lemma: row.lemma,
    surface: row.surface,
    reading: row.reading,
    pos: row.pos,
    frequency_rank: row.frequency_rank,
    frequency_source: row.frequency_source ?? null,
    homograph_no: row.homograph_no,
    surface_kind: row.surface_kind,
    is_exact: row.is_exact,
    deinflected_from: null,
  };
}

function toSenseCardResponse(card: SenseCard): SenseCardResponse {
  return {
    sense_id: card.senseId.toString(),
    lexeme_id: card.lexemeId.toString(),
    language_id: card.languageId,
    lemma: card.lemma,
    reading: card.reading,
    romanization: card.romanization,
    pos: card.pos,
    frequency_rank: card.frequencyRank,
    homograph_no: card.homographNo,
    sense_no: card.senseNo,
    definition: card.definition,
    definition_language_id: card.definitionLanguageId,
    register: card.register,
    domain: card.domain,
    is_primary: card.isPrimary,
    gloss_vi: card.glossVi,
    gloss_vi_machine: card.glossViMachine,
    gloss_vi_reviewed: card.glossViReviewed,
    gloss_en: card.glossEn,
    gloss_en_context: card.glossEnContext ?? [],
    concept_id: card.conceptId?.toString() ?? null,
    group_heading: null,
    sub_senses: [],
  };
}

function toGlossItem(row: GlossRow) {
  return {
    id: row.id.toString(),
    language_id: row.language_id,
    text: row.text,
    detail: row.detail,
    is_machine: row.is_machine,
    reviewed: row.reviewed,
    quality: row.quality,
    rank: row.rank,
  };
}

const EXAMPLE_SENTENCE_LANGS: Record<string, string> = {
  jpn: 'ja',
  eng: 'en',
  vie: 'vi',
};

function toExampleItem(row: ExampleRow) {
  // Format JMdict/Tatoeba: `text` chỉ là từ đích, câu thật nằm trong translation.sentences.
  const jpnSentence = exampleSentence(row, 'jpn');
  return {
    id: row.id.toString(),
    language_id: row.language_id,
    text: jpnSentence ?? row.text,
    translation: buildExampleTranslation(row),
    difficulty: row.difficulty,
  };
}

function exampleSentence(row: ExampleRow, lang: string): string | null {
  const sentences = (row.translation as { sentences?: unknown } | null)
    ?.sentences;
  if (!Array.isArray(sentences)) return null;
  for (const sentence of sentences) {
    const item = sentence as { lang?: unknown; text?: unknown };
    if (
      item.lang === lang &&
      typeof item.text === 'string' &&
      item.text.trim()
    ) {
      return item.text;
    }
  }
  return null;
}

function buildExampleTranslation(row: ExampleRow): Record<string, string> {
  const result = toStringRecord(row.translation);
  const sentences = (row.translation as { sentences?: unknown } | null)
    ?.sentences;
  if (Array.isArray(sentences)) {
    for (const sentence of sentences) {
      const item = sentence as { lang?: unknown; text?: unknown };
      if (typeof item.lang !== 'string' || typeof item.text !== 'string')
        continue;
      const key = EXAMPLE_SENTENCE_LANGS[item.lang] ?? item.lang;
      if (key === 'ja' || !item.text.trim() || result[key] !== undefined)
        continue;
      result[key] = item.text;
    }
  }
  if (
    typeof row.translation_vi === 'string' &&
    row.translation_vi.trim() &&
    result.vi === undefined
  ) {
    result.vi = row.translation_vi;
  }
  return result;
}

function toPronunciationItem(row: PronunciationRow) {
  return {
    id: row.id.toString(),
    ipa: row.ipa,
    audio_key: row.audio_key,
    dialect: row.dialect,
  };
}

function toFormItem(row: FormRow) {
  return {
    id: row.id.toString(),
    kind: row.kind,
    form_text: row.form_text,
    form_order: row.form_order,
    is_common: row.is_common,
  };
}

function toSenseLinkItem(row: SenseLinkRow): SenseLinkItem {
  return {
    sense_id: row.sense_id.toString(),
    language_id: row.language_id,
    lemma: row.lemma,
    reading: row.reading,
    romanization: row.romanization,
    confidence: row.confidence,
    concept_id: row.concept_id.toString(),
  };
}

function toKanjiResponse(row: KanjiRow): Omit<KanjiCardResponse, 'components'> {
  const hasRadical =
    row.radical_classical !== null ||
    row.radical_char !== null ||
    row.radical_name_vi !== null ||
    row.radical_meaning_vi !== null;

  return {
    literal: row.literal,
    codepoint_ucs: row.codepoint_ucs,
    grade: row.grade,
    stroke_count: row.stroke_count,
    frequency_rank: row.frequency_rank,
    jlpt_old: row.jlpt_old,
    jlpt_new: row.jlpt_new,
    radical: hasRadical
      ? {
          classical: row.radical_classical,
          char: row.radical_char,
          name_vi: row.radical_name_vi,
          meaning_vi: row.radical_meaning_vi,
        }
      : null,
    readings: row.readings,
    meanings: row.meanings,
    nanori: row.nanori,
    query_codes: row.query_codes,
    used_in_forms: Number(row.used_in_forms),
    media_kinds: row.media_kinds,
    parts: normalizeKanjiParts(row.parts),
  };
}

/** Cây thành phần KanjiVG (preorder ord/parent_ord) → cấu trúc lồng nhau. */
export function buildKanjiComponentTree(
  rows: readonly KanjiComponentRow[],
): KanjiComponent | null {
  if (rows.length === 0) return null;
  const nodes = new Map<number, KanjiComponent>();
  let root: KanjiComponent | null = null;
  for (const row of [...rows].sort((a, b) => a.ord - b.ord)) {
    const node: KanjiComponent = {
      char: row.component,
      original: row.original,
      is_variant: row.is_variant,
      position: row.position,
      is_radical: row.is_radical,
      is_phonetic: row.is_phonetic,
      part: row.part,
      strokes: row.strokes,
      stroke_count: row.stroke_count,
      radical_number: row.radical_number,
      name_vi: row.name_vi,
      meaning_vi: row.meaning_vi,
      children: [],
    };
    if (row.parent_ord === null) root = node;
    else nodes.get(row.parent_ord)?.children.push(node);
    nodes.set(row.ord, node);
  }
  return root;
}

/** jsonb parts từ core.kanji_radical → mảng typed, bỏ dữ liệu dị dạng. */
function normalizeKanjiParts(value: unknown): KanjiPart[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object',
    )
    .map((item) => ({
      char: typeof item.char === 'string' ? item.char : '',
      position: typeof item.position === 'number' ? item.position : null,
      is_radical: item.is_radical === true,
      radical_number:
        typeof item.radical_number === 'number' ? item.radical_number : null,
      name_vi: typeof item.name_vi === 'string' ? item.name_vi : null,
      meaning_vi: typeof item.meaning_vi === 'string' ? item.meaning_vi : null,
    }))
    .filter((part) => part.char !== '');
}

function toStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function serializeReverseEn(
  hit: Omit<ReverseLookupEnHit, 'lexeme_id' | 'frequency_rank' | 'sense_hint'>,
): ReverseLookupEnHit {
  return {
    ...hit,
    lexeme_id: hit.lexemeId,
    frequency_rank: hit.frequencyRank,
    sense_hint: hit.senseHint,
  };
}
function serializeReverseJa(
  hit: Omit<
    ReverseLookupJaHit,
    'via_lexeme_id' | 'via_lemma' | 'sense_hint' | 'exact_sense'
  >,
): ReverseLookupJaHit {
  return {
    text: hit.text,
    lexeme_id: hit.lexeme_id,
    sense_id: hit.sense_id,
    preview: hit.preview,
    senseHint: hit.senseHint,
    viaLexemeId: hit.viaLexemeId,
    viaLemma: hit.viaLemma,
    exactSense: hit.exactSense,
    vi: hit.vi,
    via_lexeme_id: hit.viaLexemeId,
    via_lemma: hit.viaLemma,
    sense_hint: hit.senseHint,
    exact_sense: hit.exactSense,
  };
}

/** Preserve ambiguity: no arbitrary first sense or first homograph. */
function selectReverseReference(
  rows: ReverseReferenceCandidate[],
): { lexemeId: bigint; senseId: bigint | null } | null {
  if (!rows.length) return null;
  const semantic = rows.filter((row) => row.evidence_priority < 3);
  let pool = semantic;
  if (!semantic.length) {
    const preferredSource = Math.min(...rows.map((row) => row.source_priority));
    pool = rows.filter((row) => row.source_priority === preferredSource);
    // A singleton sense in another homograph is not evidence to choose that word.
    if (new Set(pool.map((row) => row.lexeme_id)).size !== 1) return null;
  }
  const evidence = Math.min(...pool.map((row) => row.evidence_priority));
  const proven = pool.filter((row) => row.evidence_priority === evidence);
  const source = Math.min(...proven.map((row) => row.source_priority));
  const best = proven.filter((row) => row.source_priority === source);
  const lexemes = [...new Set(best.map((row) => row.lexeme_id))];
  if (lexemes.length !== 1) return null;
  const senses = [
    ...new Set(
      best.flatMap((row) => (row.sense_id === null ? [] : [row.sense_id])),
    ),
  ];
  return {
    lexemeId: lexemes[0],
    senseId: evidence < 100 && senses.length === 1 ? senses[0] : null,
  };
}
