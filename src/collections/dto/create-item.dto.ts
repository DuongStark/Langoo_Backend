import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const ID_PATTERN = /^\d+$/;

export class CreateItemDto {
  @ApiProperty({
    example: '1',
    description: 'sense_id mặt chính (chuỗi số) — server tự suy ra ngôn ngữ',
  })
  @IsString()
  @Matches(ID_PATTERN)
  sense_id!: string;

  @ApiPropertyOptional({
    example: '2',
    description: 'sense mặt phụ (khác ngôn ngữ với mặt chính)',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(ID_PATTERN)
  secondary_sense_id?: string;

  @ApiProperty({ example: 'chạy', maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  meaning_vi!: string;

  @ApiPropertyOptional({
    example: '1',
    description: 'Mặc định: concept curated tốt nhất của sense',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(ID_PATTERN)
  concept_id?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ enum: ['learning', 'paused', 'known'] })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(['learning', 'paused', 'known'])
  status?: string;

  @ApiPropertyOptional({ type: [String], example: ['5'] })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(ID_PATTERN, { each: true })
  tag_ids?: string[];
}
