import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
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
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN)
  secondary_sense_id?: string;

  @ApiProperty({ example: 'chạy', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  meaning_vi!: string;

  @ApiPropertyOptional({
    example: '1',
    description: 'Mặc định: concept curated tốt nhất của sense',
  })
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN)
  concept_id?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ enum: ['learning', 'paused', 'known'] })
  @IsOptional()
  @IsIn(['learning', 'paused', 'known'])
  status?: string;

  @ApiPropertyOptional({ type: [String], example: ['5'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(ID_PATTERN, { each: true })
  tag_ids?: string[];
}
