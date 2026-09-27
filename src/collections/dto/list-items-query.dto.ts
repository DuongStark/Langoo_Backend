import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListItemsQueryDto {
  @ApiPropertyOptional({
    example: 2,
    description: 'Lọc item có mặt (face) ngôn ngữ này',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  language_id?: number;

  @ApiPropertyOptional({ enum: ['learning', 'paused', 'known'] })
  @IsOptional()
  @IsIn(['learning', 'paused', 'known'])
  status?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
