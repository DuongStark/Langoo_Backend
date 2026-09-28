import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    description: 'Refresh token nhận được từ register/login/refresh',
  })
  @IsString()
  @MinLength(20, {
    message: 'Refresh token must be at least 20 characters long',
  })
  @MaxLength(200, {
    message: 'Refresh token must be at most 200 characters long',
  })
  refresh_token!: string;
}
