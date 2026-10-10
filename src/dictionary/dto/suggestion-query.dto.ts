import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SuggestionQueryDto {
  @ApiProperty({ example: 'book', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({
    example: 'en',
    maxLength: 10,
    description: 'Mã ngôn ngữ (en/ja/vi/zh-Hans)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  lang?: string;
}
