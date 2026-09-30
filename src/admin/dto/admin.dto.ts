import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export const ADMIN_GLOSS_REPORT_STATUSES = [
  'triaged',
  'fixed',
  'rejected',
] as const;
export const GLOSS_REPORT_FILTER_STATUSES = [
  'open',
  ...ADMIN_GLOSS_REPORT_STATUSES,
] as const;
export const GLOSS_REPORT_ISSUES = [
  'wrong',
  'missing',
  'offensive',
  'other',
] as const;
export const GLOSS_REPORT_TARGET_KINDS = [
  'sense_gloss',
  'concept_gloss',
  'example',
  'translation',
] as const;

export class AdminGlossReportQueryDto {
  @ApiPropertyOptional({ enum: GLOSS_REPORT_FILTER_STATUSES })
  @IsOptional()
  @IsIn([...GLOSS_REPORT_FILTER_STATUSES])
  status?: string;

  @ApiPropertyOptional({ enum: GLOSS_REPORT_ISSUES })
  @IsOptional()
  @IsIn([...GLOSS_REPORT_ISSUES])
  issue?: string;

  @ApiPropertyOptional({ enum: GLOSS_REPORT_TARGET_KINDS })
  @IsOptional()
  @IsIn([...GLOSS_REPORT_TARGET_KINDS])
  target_kind?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor từ response trước' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cursor?: string;
}

export class UpdateGlossReportDto {
  @ApiProperty({ enum: ADMIN_GLOSS_REPORT_STATUSES })
  @IsIn([...ADMIN_GLOSS_REPORT_STATUSES])
  status!: string;
}

export class AdminListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor từ response trước' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cursor?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: ['active', 'locked'] })
  @IsIn(['active', 'locked'])
  status!: 'active' | 'locked';
}

export const TIMESERIES_METRIC_NAMES = [
  'signups',
  'reviews',
  'xp',
  'ai_requests',
] as const;

export class TimeseriesQueryDto {
  @ApiProperty({ enum: TIMESERIES_METRIC_NAMES, example: 'signups' })
  @IsIn([...TIMESERIES_METRIC_NAMES])
  metric!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 180, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  days?: number;
}
