import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ReverseLookupQueryDto {
  @ApiProperty({ example: 'cát', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  q!: string;

  @ApiPropertyOptional({
    example: 'en,ja',
    description: "Ngôn ngữ đích: 'en', 'ja' hoặc 'en,ja'",
  })
  @IsOptional()
  @IsString()
  @Matches(/^(en|ja)(,(en|ja))?$/, {
    message: "to phải là 'en', 'ja' hoặc 'en,ja'",
  })
  to?: string;
}
