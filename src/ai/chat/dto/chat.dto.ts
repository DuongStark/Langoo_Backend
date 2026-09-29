import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CHAT_SCENARIOS, ChatScenario } from '../context-builder';

export class CreateChatSessionDto {
  @ApiProperty({
    example: 2,
    description: 'id ngôn ngữ đích (public.language)',
  })
  @IsInt()
  @Min(1)
  language_id!: number;

  @ApiPropertyOptional({ enum: CHAT_SCENARIOS, example: 'general' })
  @IsOptional()
  @IsIn([...CHAT_SCENARIOS])
  scenario?: ChatScenario;

  @ApiPropertyOptional({ maxLength: 80, example: 'Học từ vựng N5' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Mặc định lấy hồ sơ đang hoạt động',
  })
  @IsOptional()
  @IsUUID()
  profile_id?: string;
}

export class UpdateChatSessionDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional({ enum: CHAT_SCENARIOS })
  @IsOptional()
  @IsIn([...CHAT_SCENARIOS])
  scenario?: ChatScenario;
}

export class SendChatMessageDto {
  @ApiProperty({ maxLength: 2000, example: '走る nghĩa là gì?' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({
    description: 'sense_id để đính kèm ngữ cảnh từ điển cho câu hỏi này',
    example: '1',
  })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'ref_sense_id phải là số nguyên dương' })
  @MaxLength(19)
  ref_sense_id?: string;
}

export class ChatListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor từ response trước' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cursor?: string;
}
