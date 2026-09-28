import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
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
      'Nonce đã dùng khi lấy ID token; nếu token chứa claim nonce thì bắt buộc gửi khớp. ' +
      'Khi dùng challenge, đây là nonce do backend cấp.',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  nonce?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Challenge ID do POST /auth/oauth/google/challenge cấp; bắt buộc khi bật ' +
      'GOOGLE_OAUTH_REQUIRE_CHALLENGE.',
  })
  @IsOptional()
  @IsUUID()
  challenge_id?: string;

  @ApiPropertyOptional({
    minLength: 32,
    maxLength: 128,
    description: 'Binding secret trả cùng challenge_id, chỉ gửi lại một lần.',
  })
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  binding_secret?: string;

  @ApiPropertyOptional({ type: DeviceInfoDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device?: DeviceInfoDto;
}

export class GoogleLinkDto extends GoogleLoginDto {
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
