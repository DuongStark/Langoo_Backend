import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CURATION_LANGUAGES = ['ja', 'en'] as const;

export class AdminCurationSearchQueryDto {
  @ApiProperty({
    description:
      'Từ khóa: lemma/kana/romaji (ILIKE) hoặc external_id chính xác (vd jmdict:1000220:1)',
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  q!: string;

  @ApiPropertyOptional({
    description: 'Ngôn ngữ lexeme (mặc định ja)',
    enum: CURATION_LANGUAGES,
    default: 'ja',
  })
  @IsOptional()
  @IsIn(CURATION_LANGUAGES)
  lang?: (typeof CURATION_LANGUAGES)[number];

  @ApiPropertyOptional({
    description: 'Số kết quả tối đa (1..50, mặc định 20)',
    minimum: 1,
    maximum: 50,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AdminCurationConceptQueryDto {
  @ApiProperty({
    description: 'Từ khóa: gloss_en/gloss_vi (ILIKE) hoặc id concept chính xác',
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  q!: string;

  @ApiPropertyOptional({
    description: 'Số kết quả tối đa (1..50, mặc định 20)',
    minimum: 1,
    maximum: 50,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class UpdateCurationGlossDto {
  @ApiPropertyOptional({
    description: 'Nội dung gloss mới (sửa tay → tự bỏ cờ máy dịch)',
    minLength: 1,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text?: string;

  @ApiPropertyOptional({
    description: 'Đánh dấu admin đã duyệt (true) hoặc bỏ duyệt (false)',
  })
  @IsOptional()
  @IsBoolean()
  reviewed?: boolean;

  @ApiPropertyOptional({
    description: 'Chất lượng 0..100 (null để xoá)',
    minimum: 0,
    maximum: 100,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  quality?: number | null;
}

export class CreateCurationGlossDto {
  @ApiProperty({
    description: 'Nội dung gloss VI do admin nhập',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;
}

export const CURATION_RELATIONS = ['exact', 'related'] as const;

export class CreateCurationMappingDto {
  @ApiProperty({ description: 'ID concept (chuỗi số)' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  concept_id!: string;

  @ApiPropertyOptional({
    description: 'Quan hệ (mặc định exact)',
    enum: CURATION_RELATIONS,
    default: 'exact',
  })
  @IsOptional()
  @IsIn(CURATION_RELATIONS)
  relation?: (typeof CURATION_RELATIONS)[number];
}

export const CURATION_CONCEPT_STATUSES = [
  'draft',
  'review',
  'curated',
  'rejected',
] as const;

export class UpdateCurationConceptDto {
  @ApiProperty({
    description: 'Trạng thái concept (draft|review|curated|rejected)',
    enum: CURATION_CONCEPT_STATUSES,
  })
  @IsIn(CURATION_CONCEPT_STATUSES)
  status!: (typeof CURATION_CONCEPT_STATUSES)[number];
}
