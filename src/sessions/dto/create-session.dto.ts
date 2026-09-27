import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const SESSION_KINDS = ['review', 'practice'] as const;
export const SESSION_MODES = [
  'flashcard',
  'multiple_choice',
  'matching',
  'typing',
] as const;

export class CreateSessionDto {
  @ApiProperty({
    enum: SESSION_KINDS,
    description: 'review = thẻ đến hạn; practice = ôn trước (mọi thẻ trong bộ)',
  })
  @IsIn(SESSION_KINDS)
  kind!: string;

  @ApiProperty({ enum: SESSION_MODES })
  @IsIn(SESSION_MODES)
  mode!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  collection_id?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
