import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class QuizPairDto {
  @ApiProperty({ minimum: 0, example: 0 })
  @IsInt()
  @Min(0)
  left_index!: number;

  @ApiProperty({ minimum: 0, example: 2 })
  @IsInt()
  @Min(0)
  right_index!: number;
}

export class AnswerSessionDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  ordinal!: number;

  @ApiPropertyOptional({
    enum: [1, 2, 3, 4],
    description: 'Bắt buộc với mode flashcard',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  rating?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Bắt buộc với mode multiple_choice/matching; phải khớp index trong prompt.options của phiên',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  option_index?: number;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Bắt buộc với mode typing',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  answer_text?: string;

  @ApiPropertyOptional({
    description:
      'Chỉ dùng cho câu matching của quiz: danh sách cặp ghép left_index → right_index',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuizPairDto)
  pairs?: QuizPairDto[];

  @ApiPropertyOptional({ example: 4200, maximum: 3_600_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  elapsed_ms?: number;
}
