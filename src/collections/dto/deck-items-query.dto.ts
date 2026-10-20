import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class DeckItemsQueryDto {
  @ApiPropertyOptional({
    example: '20',
    description: 'Position cuối của trang trước (cursor phân trang)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  cursor?: string;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
