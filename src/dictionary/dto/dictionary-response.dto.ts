import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImageContractDto } from '../../media/dto/image-contract.dto';

export class SenseCardDto {
  @ApiProperty({ example: '1' })
  sense_id!: string;

  @ApiProperty({ example: '1' })
  lexeme_id!: string;

  @ApiProperty({ example: 2 })
  language_id!: number;

  @ApiProperty({ example: '走る' })
  lemma!: string;

  @ApiProperty({ nullable: true })
  reading!: string | null;

  @ApiProperty({ nullable: true })
  romanization!: string | null;

  @ApiProperty({ nullable: true })
  pos!: string | null;

  @ApiProperty({ nullable: true })
  frequency_rank!: number | null;

  @ApiProperty({ nullable: true })
  homograph_no!: number | null;

  @ApiProperty({ example: 1 })
  sense_no!: number;

  @ApiProperty({ nullable: true })
  definition!: string | null;

  @ApiProperty({ nullable: true })
  definition_language_id!: number | null;

  @ApiProperty({ nullable: true })
  register!: string | null;

  @ApiProperty({ nullable: true })
  domain!: string | null;

  @ApiProperty({ example: true })
  is_primary!: boolean;

  @ApiProperty({ nullable: true, example: 'chạy' })
  gloss_vi!: string | null;

  @ApiProperty({
    nullable: true,
    example: false,
    description: 'true = gloss máy → FE hiện badge',
  })
  gloss_vi_machine!: boolean | null;

  @ApiProperty({ nullable: true, example: false })
  gloss_vi_reviewed!: boolean | null;

  @ApiProperty({ nullable: true, example: 'to run' })
  gloss_en!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Toàn bộ EN gloss theo rank nguồn; giữ ngữ cảnh cha/con và các cách diễn đạt cùng nghĩa',
  })
  gloss_en_context!: string[];

  @ApiProperty({ nullable: true, example: '1' })
  concept_id!: string | null;

  @ApiProperty({
    type: () => [SenseCardDto],
    description:
      'Nghĩa con (subsense của wiktextract) gộp dưới nghĩa này — FE nên hiển thị thu gọn; mảng rỗng nếu không có',
  })
  sub_senses!: SenseCardDto[];

  @ApiProperty({
    nullable: true,
    description:
      'Shared Wiktextract ancestor for presentation; definition remains the actual sense meaning',
  })
  group_heading!: string | null;
}

export class SearchHitDto {
  @ApiProperty({
    type: String,
    example: '折り紙',
    description: 'Dạng chính của lexeme; surface vẫn là dạng khớp tìm kiếm',
  })
  lemma!: string;

  @ApiProperty({ example: '2' })
  lexeme_id!: string;

  @ApiProperty({ example: 1 })
  language_id!: number;

  @ApiProperty({ example: 'en' })
  lang_code!: string;

  @ApiProperty({ example: 'run' })
  surface!: string;

  @ApiProperty({ nullable: true, example: null })
  reading!: string | null;

  @ApiProperty({ nullable: true, example: 'verb' })
  pos!: string | null;

  @ApiProperty({ nullable: true, example: 110 })
  frequency_rank!: number | null;

  @ApiProperty({ nullable: true, example: 1 })
  homograph_no!: number | null;

  @ApiProperty({
    example: 'lemma',
    description: "Nguồn khớp: 'lemma' hoặc kind của form (kanji/kana)",
  })
  surface_kind!: string;

  @ApiProperty({ example: true })
  is_exact!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'bccwj-suw = word frequency, not sense frequency',
  })
  frequency_source?: string | null;

  @ApiPropertyOptional({
    type: () => SenseCardDto,
    description: 'Selected JA learner sense; uses existing sense ID/gloss',
  })
  preview?: SenseCardDto;
}

export class SearchResultDto {
  @ApiProperty({ type: [SearchHitDto] })
  data!: SearchHitDto[];

  @ApiProperty({ nullable: true, example: null })
  next_cursor!: string | null;
}

export class LexemeSensesResultDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Up to three learner senses; all other senses remain in data',
  })
  recommended_sense_ids?: string[];

  @ApiPropertyOptional({
    nullable: true,
    enum: ['curated_learner', 'source_metadata'],
  })
  priority_basis?: string | null;

  @ApiProperty({ type: [SenseCardDto] })
  data!: SenseCardDto[];

  @ApiProperty({ nullable: true, example: null })
  next_cursor!: string | null;
}

export class SenseGlossDto {
  @ApiProperty({ example: '2' })
  id!: string;

  @ApiProperty({ example: 3 })
  language_id!: number;

  @ApiProperty({ example: 'chạy' })
  text!: string;

  @ApiProperty({ nullable: true })
  detail!: string | null;

  @ApiProperty({ example: false })
  is_machine!: boolean;

  @ApiProperty({ example: false })
  reviewed!: boolean;

  @ApiProperty({ nullable: true })
  quality!: number | null;

  @ApiProperty({ example: 1 })
  rank!: number;
}

export class SenseExampleDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 2 })
  language_id!: number;

  @ApiProperty({ example: '毎朝公園を走ります' })
  text!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  translation!: Record<string, string>;

  @ApiProperty({ nullable: true })
  difficulty!: number | null;
}

export class SensePronunciationDto {
  @ApiProperty({ example: '2' })
  id!: string;

  @ApiProperty({ nullable: true, example: 'rʌn' })
  ipa!: string | null;

  @ApiProperty({ nullable: true, example: 'demo/audio/ja/走る.mp3' })
  audio_key!: string | null;

  @ApiProperty({ nullable: true, example: 'Tokyo' })
  dialect!: string | null;
}

export class SenseFormDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'kanji' })
  kind!: string;

  @ApiProperty({ example: '走る' })
  form_text!: string;

  @ApiProperty({ example: 1 })
  form_order!: number;

  @ApiProperty({ example: true })
  is_common!: boolean;
}

export class SenseDetailDto {
  @ApiProperty({ type: SenseCardDto })
  card!: SenseCardDto;

  @ApiProperty({
    type: ImageContractDto,
    nullable: true,
    description: 'Ảnh minh họa được phê duyệt cho nghĩa này (null nếu chưa có)',
  })
  image!: ImageContractDto | null;

  @ApiProperty({ type: [SenseGlossDto] })
  glosses!: SenseGlossDto[];

  @ApiProperty({ type: [SenseExampleDto] })
  examples!: SenseExampleDto[];

  @ApiProperty({ type: [SensePronunciationDto] })
  pronunciations!: SensePronunciationDto[];

  @ApiProperty({ type: [SenseFormDto] })
  forms!: SenseFormDto[];
}

export class SenseLinkDto {
  @ApiProperty({ example: '2' })
  sense_id!: string;

  @ApiProperty({ example: 1 })
  language_id!: number;

  @ApiProperty({ example: 'run' })
  lemma!: string;

  @ApiProperty({ nullable: true })
  reading!: string | null;

  @ApiProperty({ nullable: true })
  romanization!: string | null;

  @ApiProperty({ example: 1 })
  confidence!: number;

  @ApiProperty({ example: '1' })
  concept_id!: string;
}

export class SenseLinksResultDto {
  @ApiProperty({
    type: [SenseLinkDto],
    maxItems: 3,
    description:
      'Tối đa 3 từ khác nhau; đúng nghĩa đã map, có nghĩa Việt và xuất hiện trong search',
  })
  data!: SenseLinkDto[];

  @ApiProperty({ nullable: true, example: null })
  next_cursor!: string | null;
}

export class KanjiRadicalDto {
  @ApiProperty({ nullable: true })
  classical!: number | null;

  @ApiProperty({ nullable: true })
  char!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Chưa seed public.radical → thường null',
  })
  name_vi!: string | null;

  @ApiProperty({ nullable: true })
  meaning_vi!: string | null;
}

export class KanjiPartDto {
  @ApiProperty({ example: '子' })
  char!: string;

  @ApiProperty({ nullable: true, example: 1 })
  position!: number | null;

  @ApiProperty({
    example: true,
    description: 'Thành phần này là một bộ thủ Kangxi (kể cả biến thể)',
  })
  is_radical!: boolean;

  @ApiProperty({ nullable: true, example: 39 })
  radical_number!: number | null;

  @ApiProperty({ nullable: true, example: 'Tử' })
  name_vi!: string | null;

  @ApiProperty({ nullable: true, example: 'Con, đứa trẻ' })
  meaning_vi!: string | null;
}

export class KanjiComponentDto {
  @ApiProperty({
    example: '⺨',
    description: 'Thành phần (KanjiVG kvg:element)',
  })
  char!: string;

  @ApiProperty({
    nullable: true,
    example: '犬',
    description: 'Dạng gốc của biến thể',
  })
  original!: string | null;

  @ApiProperty({ example: false })
  is_variant!: boolean;

  @ApiProperty({ nullable: true, example: 'left' })
  position!: string | null;

  @ApiProperty({ example: true, description: 'Là bộ thủ của chữ' })
  is_radical!: boolean;

  @ApiProperty({ example: false, description: 'Là thành phần biểu âm' })
  is_phonetic!: boolean;

  @ApiProperty({
    nullable: true,
    example: 1,
    description: 'Phần 1/2 khi bị tách',
  })
  part!: number | null;

  @ApiProperty({
    type: [Number],
    example: [1, 2, 3],
    description: 'Số nét thuộc thành phần (KanjiVG stroke id)',
  })
  strokes!: number[];

  @ApiProperty({ example: 3 })
  stroke_count!: number;

  @ApiProperty({ nullable: true, example: 94 })
  radical_number!: number | null;

  @ApiProperty({ nullable: true, example: 'Khuyển' })
  name_vi!: string | null;

  @ApiProperty({ nullable: true, example: 'Con chó' })
  meaning_vi!: string | null;

  @ApiProperty({
    type: () => [KanjiComponentDto],
    description: 'Thành phần con (cây đệ quy)',
  })
  children!: KanjiComponentDto[];
}

export class KanjiCardDto {
  @ApiProperty({ example: '走' })
  literal!: string;

  @ApiProperty({ example: 36208 })
  codepoint_ucs!: number;

  @ApiProperty({ nullable: true })
  grade!: number | null;

  @ApiProperty({ nullable: true })
  stroke_count!: number | null;

  @ApiProperty({ nullable: true })
  frequency_rank!: number | null;

  @ApiProperty({ nullable: true })
  jlpt_old!: number | null;

  @ApiProperty({ nullable: true })
  jlpt_new!: number | null;

  @ApiProperty({ nullable: true, type: KanjiRadicalDto })
  radical!: KanjiRadicalDto | null;

  @ApiProperty({ description: 'jsonb từ core.kanji.readings' })
  readings!: unknown;

  @ApiProperty({ description: 'jsonb từ core.kanji.meanings' })
  meanings!: unknown;

  @ApiProperty({ nullable: true })
  nanori!: unknown;

  @ApiProperty({ nullable: true })
  query_codes!: unknown;

  @ApiProperty({ example: 12 })
  used_in_forms!: number;

  @ApiProperty({ nullable: true, type: [String] })
  media_kinds!: string[] | null;

  @ApiProperty({
    type: [KanjiPartDto],
    description:
      'Thành phần cấu tạo (KRADFILE — fallback) kèm tên/nghĩa VI nếu là bộ thủ',
  })
  parts!: KanjiPartDto[];

  @ApiProperty({
    type: KanjiComponentDto,
    nullable: true,
    description:
      'Cây thành phần chuẩn KanjiVG (ưu tiên hiển thị; null nếu chữ chưa có)',
  })
  components!: KanjiComponentDto | null;
}

export class SearchHistoryItemDto {
  @ApiProperty({ example: '3' })
  id!: string;

  @ApiProperty({ example: 'run' })
  raw_query!: string;

  @ApiProperty({ nullable: true, example: 'run' })
  normalized!: string | null;

  @ApiProperty({ nullable: true, example: 1 })
  language_id!: number | null;

  @ApiProperty({ nullable: true })
  matched_sense_id!: string | null;

  @ApiProperty({ nullable: true, example: 4 })
  result_count!: number | null;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  created_at!: string;
}

export class SearchHistoryResultDto {
  @ApiProperty({ type: [SearchHistoryItemDto] })
  data!: SearchHistoryItemDto[];

  @ApiProperty({ nullable: true, example: null })
  next_cursor!: string | null;
}

export class GlossReportResponseDto {
  @ApiProperty({ example: '12' })
  id!: string;

  @ApiProperty({ example: 'sense_gloss' })
  target_kind!: string;

  @ApiProperty({ example: '2' })
  target_id!: string;

  @ApiProperty({ nullable: true, example: 3 })
  language_id!: number | null;

  @ApiProperty({ example: 'wrong' })
  issue!: string;

  @ApiPropertyOptional({ nullable: true })
  comment!: string | null;

  @ApiProperty({ example: 'open' })
  status!: string;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  created_at!: string;
}

export class ReverseLookupEnHitDto {
  @ApiProperty({ example: '1775198' })
  lexeme_id!: string;

  @ApiProperty({ example: 'sand' })
  lemma!: string;

  @ApiProperty({ nullable: true, example: 'noun' })
  pos!: string | null;

  @ApiProperty({ nullable: true, example: 3409 })
  frequency_rank!: number | null;

  @ApiProperty({ nullable: true, example: 'finely ground rock' })
  sense_hint!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'trường',
    description: 'Từ tiếng Việt khớp (autocomplete)',
  })
  vi?: string | null;
}

export class ReverseLookupJaHitDto {
  @ApiProperty({ example: '砂' })
  text!: string;

  @ApiProperty({ nullable: true, example: 'finely ground rock' })
  sense_hint!: string | null;

  @ApiProperty({ example: '1775198' })
  via_lexeme_id!: string;

  @ApiProperty({ example: 'sand' })
  via_lemma!: string;

  @ApiProperty({
    example: true,
    description:
      'sense_hint của tiếng Nhật khớp sense_hint của nghĩa tiếng Việt',
  })
  exact_sense!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'trường',
    description: 'Từ tiếng Việt khớp (autocomplete)',
  })
  vi?: string | null;
}

export class ReverseLookupResultDto {
  @ApiProperty({ example: 'cát' })
  query!: string;

  @ApiProperty({ example: true })
  matched!: boolean;

  @ApiProperty({ type: [ReverseLookupEnHitDto] })
  en!: ReverseLookupEnHitDto[];

  @ApiProperty({ type: [ReverseLookupJaHitDto] })
  ja!: ReverseLookupJaHitDto[];
}
