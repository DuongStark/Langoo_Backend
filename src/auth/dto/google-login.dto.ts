import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DeviceInfoDto } from './device-info.dto';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'ID token (JWT) từ Google Sign-In SDK',
    maxLength: 4096,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  id_token!: string;

  @ApiPropertyOptional({
    description:
      'Nonce đã dùng khi lấy ID token; nếu token chứa claim nonce thì bắt buộc gửi khớp',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  nonce?: string;

  @ApiPropertyOptional({ type: DeviceInfoDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device?: DeviceInfoDto;
}
