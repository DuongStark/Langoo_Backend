import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    description: 'Refresh token nhận được từ register/login/refresh',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refresh_token!: string;
}
