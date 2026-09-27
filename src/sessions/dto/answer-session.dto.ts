import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
    description: 'Bắt buộc với mode multiple_choice/matching',
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

  @ApiPropertyOptional({ example: 4200, maximum: 3_600_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  elapsed_ms?: number;
}
