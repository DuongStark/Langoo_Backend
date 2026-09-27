import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const GLOSS_REPORT_TARGET_KINDS = [
  'sense_gloss',
  'concept_gloss',
  'example',
  'translation',
] as const;

export const GLOSS_REPORT_ISSUES = [
  'wrong',
  'missing',
  'offensive',
  'other',
] as const;

export class CreateGlossReportDto {
  @ApiProperty({ enum: GLOSS_REPORT_TARGET_KINDS, example: 'sense_gloss' })
  @IsIn(GLOSS_REPORT_TARGET_KINDS)
  target_kind!: string;

  @ApiProperty({
    example: '2',
    description: 'Id của đối tượng bị báo lỗi (dạng chuỗi)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  target_id!: string;

  @ApiPropertyOptional({
    example: 3,
    description: 'Ngôn ngữ của gloss bị báo lỗi',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  language_id?: number;

  @ApiProperty({ enum: GLOSS_REPORT_ISSUES, example: 'wrong' })
  @IsIn(GLOSS_REPORT_ISSUES)
  issue!: string;

  @ApiPropertyOptional({
    maxLength: 500,
    example: 'Nghĩa này chưa đúng với ngữ cảnh',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
