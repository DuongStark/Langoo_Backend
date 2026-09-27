import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateItemDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  meaning_vi?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ enum: ['learning', 'paused', 'known'] })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(['learning', 'paused', 'known'])
  status?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  position?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Thay thế TOÀN BỘ tag của item; gửi [] để bỏ hết',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true })
  tag_ids?: string[];
}
