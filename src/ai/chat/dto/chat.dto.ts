import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
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
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn([...CHAT_SCENARIOS])
  scenario?: ChatScenario;

  @ApiPropertyOptional({ maxLength: 80, example: 'Học từ vựng N5' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Mặc định lấy hồ sơ đang hoạt động',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  profile_id?: string;
}

export class UpdateChatSessionDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional({ enum: CHAT_SCENARIOS })
  @ValidateIf((_object, value: unknown) => value !== undefined)
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
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Matches(/^\d+$/, { message: 'ref_sense_id phải là số nguyên dương' })
  @MaxLength(19)
  ref_sense_id?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 3,
    description:
      'Ảnh tạm thời: data:image/png|jpeg|webp;base64,...; mỗi ảnh tối đa 2 MiB. Không lưu ảnh.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  images?: string[];
}

export class ChatListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor từ response trước' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(2000)
  cursor?: string;
}
