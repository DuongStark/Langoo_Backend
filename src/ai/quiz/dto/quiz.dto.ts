import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { QuizQuestionType } from '../../../sessions/quiz-content';
import { QUIZ_QUESTION_TYPES } from '../quiz-contract';
import { QUIZ_SKILLS, QuizSkill } from '../quiz-skills';

export class CreateQuizDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Bỏ trống = gộp mọi collection của hồ sơ',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  collection_id?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 32767,
    description:
      'M11.5: Ngôn ngữ đích thuộc hồ sơ học hiện tại. Bỏ trống = ngôn ngữ chính của hồ sơ.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  language_id?: number;

  @ApiPropertyOptional({
    enum: QUIZ_SKILLS,
    isArray: true,
    example: ['meaning', 'context_meaning', 'context_cloze'],
    description:
      'M11.5: Các kỹ năng cần ra đề từ ngân hàng câu hỏi dùng chung (<200ms, 0 gọi AI trực tiếp).',
  })
  @ValidateIf(
    (object: CreateQuizDto, value: unknown) =>
      value !== undefined || object.question_types === undefined,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsIn([...QUIZ_SKILLS], { each: true })
  skills?: QuizSkill[];

  @ApiPropertyOptional({
    enum: QUIZ_QUESTION_TYPES,
    isArray: true,
    example: ['multiple_choice', 'fill_blank'],
    description:
      'Tương thích ngược cho client cũ khi chưa gửi skills; cần ít nhất một trong skills hoặc question_types.',
  })
  @ValidateIf(
    (object: CreateQuizDto, value: unknown) =>
      value !== undefined || object.skills === undefined,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn([...QUIZ_QUESTION_TYPES], { each: true })
  question_types?: QuizQuestionType[];

  @ApiProperty({ minimum: 1, maximum: 50, example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  question_count!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'M11.5: Khóa chống tạo trùng khi retry mạng; trả lại đúng đề vừa tạo (reused=true).',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  idempotency_key?: string;
}

export class QuizListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor từ response trước' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cursor?: string;
}

export class StartQuizDto {
  @ApiPropertyOptional({
    enum: ['resume', 'new_attempt'],
    default: 'resume',
    description:
      'Làm tiếp lượt đang dở (resume) hoặc tạo lượt làm lại mới (new_attempt).',
  })
  @IsOptional()
  @IsIn(['resume', 'new_attempt'])
  intent?: 'resume' | 'new_attempt';

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Bắt buộc với new_attempt; giữ key khi retry để không tạo lượt thứ hai.',
  })
  @ValidateIf(
    (object: StartQuizDto, value: unknown) =>
      object.intent === 'new_attempt' || value !== undefined,
  )
  @IsUUID()
  idempotency_key?: string;
}
