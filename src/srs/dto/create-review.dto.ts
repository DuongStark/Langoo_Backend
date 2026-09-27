import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const REVIEW_MODES = [
  'flashcard',
  'multiple_choice',
  'matching',
  'typing',
  'listening',
] as const;

export class CreateReviewDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Id face của item (collection_item_face)',
  })
  @IsUUID()
  face_id!: string;

  @ApiProperty({ enum: ['recognize', 'recall'] })
  @IsIn(['recognize', 'recall'])
  direction!: string;

  @ApiProperty({
    enum: [1, 2, 3, 4],
    description: '1=Again, 2=Hard, 3=Good, 4=Easy',
  })
  @IsInt()
  @Min(1)
  @Max(4)
  rating!: number;

  @ApiPropertyOptional({ example: 4200, maximum: 3_600_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  elapsed_ms?: number;

  @ApiPropertyOptional({ enum: REVIEW_MODES, default: 'flashcard' })
  @IsOptional()
  @IsIn(REVIEW_MODES)
  mode?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'FE sinh (uuid v7) để retry mạng không cộng đôi',
  })
  @IsOptional()
  @IsUUID()
  client_review_id?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 nếu client muốn ghi giờ trả lời',
  })
  @IsOptional()
  @IsISO8601()
  reviewed_at?: string;
}
