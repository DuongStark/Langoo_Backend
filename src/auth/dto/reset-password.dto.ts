import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    description:
      'Token đặt lại mật khẩu (base64url 32 byte, đúng 43 ký tự) từ liên kết email',
    minLength: 43,
    maxLength: 43,
    example: 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UvW',
  })
  @IsString()
  @Length(43, 43, { message: 'Token must be exactly 43 characters long' })
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'Token must be base64url encoded',
  })
  token!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128, { message: 'Password must be at most 128 characters long' })
  new_password!: string;
}
