import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ReverseSuggestionQueryDto {
  @ApiProperty({
    example: 'truong',
    maxLength: 64,
    description: 'Tiếng Việt (có dấu hoặc không dấu đều được)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  q!: string;

  @ApiPropertyOptional({
    example: 'en,ja',
    description: 'Đích gợi ý: en, ja hoặc en,ja (mặc định en,ja)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(en|ja)(,(en|ja))?$/)
  to?: string;

  @ApiPropertyOptional({ example: 8, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
