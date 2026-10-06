export interface SearchHit {
  lexeme_id: string;
  language_id: number;
  lang_code: string;
  surface: string;
  reading: string | null;
  pos: string | null;
  frequency_rank: number | null;
  homograph_no: number | null;
  surface_kind: string;
  is_exact: boolean;
}

export interface SearchResult {
  data: SearchHit[];
  next_cursor: string | null;
}

export interface LexemeSensesResult {
  data: SenseCardResponse[];
  next_cursor: null;
}

export interface SenseCardResponse {
  sense_id: string;
  lexeme_id: string;
  language_id: number;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  pos: string | null;
  frequency_rank: number | null;
  homograph_no: number | null;
  sense_no: number;
  definition: string | null;
  definition_language_id: number | null;
  register: string | null;
  domain: string | null;
  is_primary: boolean;
  gloss_vi: string | null;
  gloss_vi_machine: boolean | null;
  gloss_vi_reviewed: boolean | null;
  gloss_en: string | null;
  concept_id: string | null;
  /** Nghĩa con (subsense wiktextract) — FE hiển thị thu gọn dưới nghĩa cha. */
  sub_senses: SenseCardResponse[];
}

export interface SenseGlossItem {
  id: string;
  language_id: number;
  text: string;
  detail: string | null;
  is_machine: boolean;
  reviewed: boolean;
  quality: number | null;
  rank: number;
}

export interface SenseExampleItem {
  id: string;
  language_id: number;
  text: string;
  translation: Record<string, string>;
  difficulty: number | null;
}

export interface SensePronunciationItem {
  id: string;
  ipa: string | null;
  audio_key: string | null;
  dialect: string | null;
}

export interface SenseFormItem {
  id: string;
  kind: string;
  form_text: string;
  form_order: number;
  is_common: boolean;
}

export interface SenseDetailResponse {
  card: SenseCardResponse;
  glosses: SenseGlossItem[];
  examples: SenseExampleItem[];
  pronunciations: SensePronunciationItem[];
  forms: SenseFormItem[];
}

export interface SenseLinkItem {
  sense_id: string;
  language_id: number;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  confidence: number;
  concept_id: string;
}

export interface SenseLinksResult {
  data: SenseLinkItem[];
  next_cursor: null;
}

export interface KanjiRadical {
  classical: number | null;
  char: string | null;
  name_vi: string | null;
  meaning_vi: string | null;
}

export interface KanjiCardResponse {
  literal: string;
  codepoint_ucs: number;
  grade: number | null;
  stroke_count: number | null;
  frequency_rank: number | null;
  jlpt_old: number | null;
  jlpt_new: number | null;
  radical: KanjiRadical | null;
  readings: unknown;
  meanings: unknown;
  nanori: unknown;
  query_codes: unknown;
  used_in_forms: number;
  media_kinds: string[] | null;
}

export interface SearchHistoryItem {
  id: string;
  raw_query: string;
  normalized: string | null;
  language_id: number | null;
  matched_sense_id: string | null;
  result_count: number | null;
  created_at: string;
}

export interface SearchHistoryResult {
  data: SearchHistoryItem[];
  next_cursor: null;
}

export interface GlossReportResponse {
  id: string;
  target_kind: string;
  target_id: string;
  language_id: number | null;
  issue: string;
  comment: string | null;
  status: string;
  created_at: string;
}
