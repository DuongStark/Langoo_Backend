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

export class CreateQuizDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Bỏ trống = gộp mọi collection của hồ sơ',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  collection_id?: string;

  @ApiProperty({
    enum: QUIZ_QUESTION_TYPES,
    isArray: true,
    example: ['multiple_choice', 'fill_blank'],
    description:
      'Checkbox dạng câu hỏi; câu hỏi được chia đều cho các dạng được chọn. ' +
      'Trắc nghiệm tự trộn nghĩa / đọc Kanji / chọn chữ Kanji tuỳ dữ liệu từng từ.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn([...QUIZ_QUESTION_TYPES], { each: true })
  question_types!: QuizQuestionType[];

  @ApiProperty({ minimum: 1, maximum: 50, example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  question_count!: number;
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
