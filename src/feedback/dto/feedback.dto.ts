import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const FEEDBACK_CATEGORIES = [
  'bug',
  'feature',
  'content',
  'other',
] as const;
export const FEEDBACK_STATUSES = ['new', 'in_progress', 'resolved'] as const;

export class CreateFeedbackDto {
  @ApiProperty({ enum: FEEDBACK_CATEGORIES, example: 'bug' })
  @IsIn([...FEEDBACK_CATEGORIES])
  category!: string;

  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  content!: string;
}

export class UpdateFeedbackDto {
  @ApiProperty({ enum: FEEDBACK_STATUSES })
  @IsIn([...FEEDBACK_STATUSES])
  status!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(2000)
  admin_note?: string;
}

export class MyFeedbackQueryDto {
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

export class AdminFeedbackQueryDto extends MyFeedbackQueryDto {
  @ApiPropertyOptional({ enum: FEEDBACK_STATUSES })
  @IsOptional()
  @IsIn([...FEEDBACK_STATUSES])
  status?: string;

  @ApiPropertyOptional({ enum: FEEDBACK_CATEGORIES })
  @IsOptional()
  @IsIn([...FEEDBACK_CATEGORIES])
  category?: string;
}
