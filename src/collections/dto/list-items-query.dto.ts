import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class ListItemsQueryDto {
  @ApiPropertyOptional({
    example: 2,
    description: 'Lọc item có mặt (face) ngôn ngữ này',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  language_id?: number;

  @ApiPropertyOptional({ enum: ['learning', 'paused', 'known'] })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(['learning', 'paused', 'known'])
  status?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
