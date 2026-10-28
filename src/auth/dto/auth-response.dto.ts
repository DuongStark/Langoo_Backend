import { ApiProperty } from '@nestjs/swagger';

export class UserIdentityDto {
  @ApiProperty({
    example: 'google',
    enum: ['password', 'google'],
    description: 'Tên nhà cung cấp định danh',
  })
  provider!: string;

  @ApiProperty({
    example: '2026-09-26T00:00:00.000Z',
    description: 'Thời điểm liên kết định danh này',
  })
  created_at!: string;
}

export class UserResponseDto {
  @ApiProperty({
    example: '5',
    description: 'bigint dạng chuỗi (JSON không có bigint)',
  })
  id!: string;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty({ nullable: true, example: 'An' })
  display_name!: string | null;

  @ApiProperty({ nullable: true, example: null })
  avatar_url!: string | null;

  @ApiProperty({ example: 'active' })
  status!: string;

  @ApiProperty({ example: '2026-09-26T00:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ nullable: true, example: null })
  last_login_at!: string | null;

  @ApiProperty({
    type: [UserIdentityDto],
    description:
      'Danh sách phương thức đăng nhập đã liên kết (password, google...)',
  })
  identities!: UserIdentityDto[];

  @ApiProperty({
    example: true,
    description: 'Tài khoản có mật khẩu hay không',
  })
  has_password!: boolean;

  @ApiProperty({
    example: false,
    description: 'Tài khoản đã liên kết Google hay chưa',
  })
  has_google!: boolean;
}

export class AuthTokensDto {
  @ApiProperty()
  access_token!: string;

  @ApiProperty()
  refresh_token!: string;

  @ApiProperty({
    example: 900,
    description: 'Thời gian sống của access token (giây)',
  })
  expires_in!: number;
}

export class AuthResultDto extends AuthTokensDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}

export class SessionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, example: '2026-09-26T02:00:00.000Z' })
  revoked_at!: string | null;
}
