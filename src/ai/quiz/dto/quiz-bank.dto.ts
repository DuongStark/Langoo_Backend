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
import { QUIZ_SKILLS, QuizSkill } from '../quiz-skills';

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
export class QuizSkillEligibilityResponse {
  @ApiProperty({ enum: QUIZ_SKILLS }) skill!: QuizSkill;
  @ApiProperty() requested!: number;
  @ApiProperty() eligible_targets!: number;
  @ApiProperty({
    enum: [
      'collection_only',
      'reading_rule',
      'ai_distractors',
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
  @ApiProperty({ enum: ['pending', 'recorded', 'quarantined'] })
  status!: 'pending' | 'recorded' | 'quarantined';
  @ApiProperty({
    description:
      'Câu báo lỗi bị loại ngay khỏi đề tiếp theo của người báo; đủ 2 người khác nhau báo lỗi sẽ tự khóa toàn hệ thống.',
  })
  cache_excluded!: boolean;
}
