import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProfileDto {
  @ApiProperty({ example: 'Nhật–Việt', maxLength: 80 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    example: 2,
    description: 'Id ngôn ngữ chính (1=en, 2=ja, 3=vi, 4=zh-Hans)',
  })
  @IsInt()
  @Min(1)
  primary_language_id!: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 1,
    description: 'Ngôn ngữ phụ (chế độ song ngữ)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  secondary_language_id?: number | null;

  @ApiProperty({
    example: 3,
    description: 'Ngôn ngữ giải nghĩa (thường là vi)',
  })
  @IsInt()
  @Min(1)
  support_language_id!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}
