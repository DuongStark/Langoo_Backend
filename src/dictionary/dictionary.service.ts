import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception';
import { LanguageRepository } from '../db/repositories/language.repository';
import { SearchQueryDto } from './dto/search-query.dto';
import { DictionarySearchRepository } from './repositories/dictionary-search.repository';
import { KanjiRepository, KanjiRow } from './repositories/kanji.repository';
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
import {
  KanjiCardResponse,
  SearchHit,
  SearchResult,
  SenseCardResponse,
  SenseDetailResponse,
  SenseLinkItem,
  SenseLinksResult,
} from './types/dictionary.types';
import { SenseCard } from './types/sense-card';

const EXAMPLES_LIMIT = 5;
const DEFAULT_SEARCH_LIMIT = 20;

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
  ) {}

  async search(dto: SearchQueryDto, userId?: bigint): Promise<SearchResult> {
    const query = dto.q.trim();
    const limit = dto.limit ?? DEFAULT_SEARCH_LIMIT;

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

    const rows = await this.searchRepo.search({
      raw: query,
      pattern: escapeLike(query),
      lang: dto.lang ?? null,
      limit,
    });
    const data = rows.map(toSearchHit);

    if (userId !== undefined) {
      await this.historyRepo.create({
        userId,
        rawQuery: dto.q,
        normalized: normalizeQuery(dto.q),
        languageId,
        resultCount: data.length,
      });
    }

    return { data, next_cursor: null };
  }

  async getSenseDetail(senseId: bigint): Promise<SenseDetailResponse> {
    const card = await this.senseCardRepo.getBySenseId(senseId);
    if (!card) {
      throw senseNotFound();
    }

    const [glosses, examples, pronunciations, forms] = await Promise.all([
      this.contentRepo.getGlosses(senseId),
      this.contentRepo.getExamples(senseId, EXAMPLES_LIMIT),
      this.contentRepo.getPronunciations(card.lexemeId),
      this.contentRepo.getForms(card.lexemeId),
    ]);

    return {
      card: toSenseCardResponse(card),
      glosses: glosses.map(toGlossItem),
      examples: examples.map(toExampleItem),
      pronunciations: pronunciations.map(toPronunciationItem),
      forms: forms.map(toFormItem),
    };
  }

  async getSenseLinks(senseId: bigint): Promise<SenseLinksResult> {
    const card = await this.senseCardRepo.getBySenseId(senseId);
    if (!card) {
      throw senseNotFound();
    }
    const links = await this.pairRepo.findLinks(senseId);
    return { data: links.map(toSenseLinkItem), next_cursor: null };
  }

  async getKanji(literal: string): Promise<KanjiCardResponse> {
    const row = await this.kanjiRepo.getByLiteral(literal);
    if (!row) {
      throw new DomainException(
        'KANJI_NOT_FOUND',
        'Không tìm thấy chữ Hán',
        HttpStatus.NOT_FOUND,
      );
    }
    return toKanjiResponse(row);
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
  surface: string;
  reading: string | null;
  pos: string | null;
  frequency_rank: number | null;
  homograph_no: number | null;
  surface_kind: string;
  is_exact: boolean;
}): SearchHit {
  return {
    lexeme_id: row.lexeme_id.toString(),
    language_id: row.language_id,
    lang_code: row.lang_code,
    surface: row.surface,
    reading: row.reading,
    pos: row.pos,
    frequency_rank: row.frequency_rank,
    homograph_no: row.homograph_no,
    surface_kind: row.surface_kind,
    is_exact: row.is_exact,
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
    concept_id: card.conceptId?.toString() ?? null,
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

function toExampleItem(row: ExampleRow) {
  return {
    id: row.id.toString(),
    language_id: row.language_id,
    text: row.text,
    translation: toStringRecord(row.translation),
    difficulty: row.difficulty,
  };
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

function toKanjiResponse(row: KanjiRow): KanjiCardResponse {
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
  };
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
