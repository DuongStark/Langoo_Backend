import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CloneFromDeckDto {
  @ApiProperty({ example: '1', description: 'Id deck (chuỗi số)' })
  @IsString()
  @Matches(/^\d+$/)
  deck_id!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  profile_id?: string;

  @ApiPropertyOptional({ maxLength: 80, description: 'Mặc định: tên deck' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;
}
