import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
import {
  QUIZ_DIFFICULTIES,
  QUIZ_TYPES,
  QuizDifficulty,
  QuizType,
} from '../../../sessions/quiz-content';

export class CreateQuizDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Bỏ trống = gộp mọi collection của hồ sơ',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  collection_id?: string;

  @ApiProperty({ enum: QUIZ_TYPES, example: 'multiple_choice' })
  @IsIn([...QUIZ_TYPES])
  quiz_type!: QuizType;

  @ApiProperty({ enum: QUIZ_DIFFICULTIES, example: 'medium' })
  @IsIn([...QUIZ_DIFFICULTIES])
  difficulty!: QuizDifficulty;

  @ApiProperty({ minimum: 1, maximum: 50, example: 5 })
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
