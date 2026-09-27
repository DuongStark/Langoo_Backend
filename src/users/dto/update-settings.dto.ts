import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    example: 'Asia/Ho_Chi_Minh',
    description: 'Múi giờ IANA — nguồn tính "ngày học"/streak',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ nullable: true, example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  ui_language_id?: number | null;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  daily_goal?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Tuỳ chọn thông báo (cấu trúc khoá chốt ở M9)',
  })
  @IsOptional()
  @IsObject()
  notify?: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  active_profile_id?: string | null;
}
