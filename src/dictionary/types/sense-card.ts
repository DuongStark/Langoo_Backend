/**
 * Kiểu dữ liệu một dòng của view `serve.sense_card` (snake_case — đúng tên cột DB).
 * Chỉ dùng nội bộ trong repository; bên ngoài dùng `SenseCard`.
 */
export interface SenseCardRow {
  sense_id: bigint;
  lexeme_id: bigint;
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
  gloss_en_context?: string[];
  gloss_en_is_hierarchy?: boolean;
  concept_id: bigint | null;
}

/**
 * Một sense cho UI tra cứu.
 * Lưu ý cổng chất lượng: `glossViMachine === true && glossViReviewed === false`
 * là gloss máy chưa kiểm duyệt — FE phải hiện badge "chưa kiểm duyệt".
 */
export interface SenseCard {
  senseId: bigint;
  lexemeId: bigint;
  languageId: number;
  lemma: string;
  reading: string | null;
  romanization: string | null;
  pos: string | null;
  frequencyRank: number | null;
  homographNo: number | null;
  senseNo: number;
  definition: string | null;
  definitionLanguageId: number | null;
  register: string | null;
  domain: string | null;
  isPrimary: boolean;
  glossVi: string | null;
  glossViMachine: boolean | null;
  glossViReviewed: boolean | null;
  glossEn: string | null;
  glossEnContext?: string[];
  glossEnIsHierarchy?: boolean;
  conceptId: bigint | null;
}
