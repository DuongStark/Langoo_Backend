import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class DeckListQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Lọc theo ID ngôn ngữ (1: Tiếng Anh, 2: Tiếng Nhật)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  language_id?: number;
}
