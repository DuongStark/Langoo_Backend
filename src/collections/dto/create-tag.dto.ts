import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTagDto {
  @ApiProperty({ example: '#n5', maxLength: 40 })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @ApiPropertyOptional({ example: '#4f46e5', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}
