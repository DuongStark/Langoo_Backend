import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCollectionDto {
  @ApiProperty({ example: 'Bộ của tôi', maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Mặc định: active_profile_id → hồ sơ default',
  })
  @IsOptional()
  @IsUUID()
  profile_id?: string;
}
