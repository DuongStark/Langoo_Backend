import { ApiProperty } from '@nestjs/swagger';

export class PasswordResetMessageDto {
  @ApiProperty({
    example: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi',
    description:
      'Thông điệp thống nhất, không tiết lộ email có tồn tại hay không',
  })
  message!: string;
}

export class PasswordResetResultDto {
  @ApiProperty({
    example: '5',
    description: 'bigint dạng chuỗi (JSON không có bigint)',
  })
  user_id!: string;

  @ApiProperty({
    example: 3,
    description: 'Số phiên đăng nhập còn sống đã bị thu hồi',
  })
  sessions_revoked!: number;

  @ApiProperty({
    enum: ['login'],
    example: 'login',
    description: 'Client phải đăng nhập lại; endpoint không tự tạo phiên',
  })
  next_action!: 'login';
}
