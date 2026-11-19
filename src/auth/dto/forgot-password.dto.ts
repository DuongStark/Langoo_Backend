import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com', maxLength: 255 })
  @IsString()
  @IsEmail()
  @MaxLength(255, { message: 'Email must be at most 255 characters long' })
  email!: string;
}
