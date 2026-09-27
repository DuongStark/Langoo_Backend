import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SearchQueryDto {
  @ApiProperty({ example: '走る', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({
    example: 'ja',
    maxLength: 10,
    description:
      'Mã ngôn ngữ (en/ja/vi/zh-Hans) — service kiểm tra tồn tại trong public.language',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  lang?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
