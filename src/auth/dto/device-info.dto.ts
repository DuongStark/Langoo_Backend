import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class DeviceInfoDto {
  @ApiProperty({ enum: ['ios', 'android', 'web'], example: 'android' })
  @IsIn(['ios', 'android', 'web'])
  platform!: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  app_version?: string;
}
