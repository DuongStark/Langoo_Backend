import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QUIZ_SKILLS, QuizSkill } from './quiz-blueprint';

export class QuizEligibilityDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Bỏ trống = các bộ trong profile hiện tại, không mở rộng ngoài profile.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  collection_id?: string;

  @ApiProperty({
    minimum: 1,
    maximum: 32767,
    description: 'Ngôn ngữ đích thuộc profile hiện tại.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  language_id!: number;

  @ApiProperty({
    enum: QUIZ_SKILLS,
    isArray: true,
    description:
      'Phân bố đều theo thứ tự chọn. Paraphrase chưa bật khi chưa có nguồn được thẩm định.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsIn([...QUIZ_SKILLS], { each: true })
  skills!: QuizSkill[];

  @ApiProperty({ minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  question_count!: number;
}
export class CreateQuizJobDto extends QuizEligibilityDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Một key cho một ý định tạo đề; giữ nguyên khi retry mạng.',
  })
  @IsUUID()
  idempotency_key!: string;
}
export class QuizJobActionDto {
  @ApiProperty({ enum: ['retry', 'accept_shorter', 'cancel'] })
  @IsIn(['retry', 'accept_shorter', 'cancel'])
  action!: 'retry' | 'accept_shorter' | 'cancel';
}
export class QuizSkillEligibilityResponse {
  @ApiProperty({ enum: QUIZ_SKILLS }) skill!: QuizSkill;
  @ApiProperty() requested!: number;
  @ApiProperty() eligible_targets!: number;
  @ApiProperty({
    enum: [
      'collection_only',
      'reading_rule',
      'same_word_sentences',
      'unavailable',
    ],
  })
  source_policy!: string;
}
export class QuizEligibilityResponse {
  @ApiProperty() feasible!: boolean;
  @ApiProperty() eligible_target_count!: number;
  @ApiProperty() requested_count!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Số câu đã xác minh khả thi, không phải cam kết AI đủ câu.',
  })
  suggested_count!: number | null;
  @ApiProperty({ type: [QuizSkillEligibilityResponse] })
  by_skill!: QuizSkillEligibilityResponse[];
  @ApiProperty({ type: [String] }) reasons!: string[];
  @ApiProperty({ description: 'False khi chỉ đánh giá cửa sổ nguồn hữu hạn.' })
  source_complete!: boolean;
  @ApiProperty({
    description: 'Bản này chưa bật lọc cấp JLPT được chứng nhận.',
  })
  level_filter_supported!: boolean;
  @ApiProperty({
    description: 'Bản này chỉ dùng nội bộ/rule; không âm thầm mở bộ mẫu.',
  })
  sample_sources_supported!: boolean;
}
export class QuizJobSkillProgressResponse {
  @ApiProperty({ enum: QUIZ_SKILLS }) skill!: QuizSkill;
  @ApiProperty() requested!: number;
  @ApiProperty() validated!: number;
}
export class QuizJobResponse {
  @ApiProperty({ format: 'uuid' }) quiz_id!: string;
  @ApiProperty({
    enum: ['queued', 'running', 'needs_action', 'ready', 'failed', 'cancelled'],
  })
  state!: string;
  @ApiProperty({
    enum: [
      'queued',
      'prepare',
      'generate',
      'audit',
      'complete',
      'waiting',
      'terminal',
    ],
  })
  phase!: string;
  @ApiProperty() requested_count!: number;
  @ApiProperty() validated_count!: number;
  @ApiProperty({ type: [QuizJobSkillProgressResponse] })
  by_skill!: QuizJobSkillProgressResponse[];
  @ApiProperty({ type: [String] }) allowed_actions!: string[];
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty() usage_uncertain!: boolean;
}

export class ReportQuizQuestionDto {
  @ApiProperty({
    enum: ['ambiguous', 'wrong_meaning', 'wrong_reading', 'unnatural', 'other'],
  })
  @IsIn(['ambiguous', 'wrong_meaning', 'wrong_reading', 'unnatural', 'other'])
  reason!: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(500)
  note?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() idempotency_key!: string;
}
export class QuizQuestionReportResponse {
  @ApiProperty({ format: 'uuid' }) report_id!: string;
  @ApiProperty({ enum: ['pending'] }) status!: 'pending';
  @ApiProperty({
    description:
      'Câu cùng cache key trong scope này không được tái dùng; chưa kết luận nội dung sai.',
  })
  cache_excluded!: boolean;
}
