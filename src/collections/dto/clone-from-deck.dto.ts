import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CloneFromDeckDto {
  @ApiProperty({ example: '1', description: 'Id deck (chuỗi số)' })
  @IsString()
  @Matches(/^\d+$/)
  deck_id!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID()
  profile_id?: string;

  @ApiPropertyOptional({ maxLength: 80, description: 'Mặc định: tên deck' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;
}
