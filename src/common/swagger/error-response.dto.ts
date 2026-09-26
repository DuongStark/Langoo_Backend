import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({
    example: 'COLLECTION_NOT_FOUND',
    description: 'Mã lỗi domain (SCREAMING_SNAKE_CASE)',
  })
  code!: string;

  @ApiProperty({
    example: 'Không tìm thấy bộ sưu tập',
    description: 'Thông báo lỗi cho người dùng',
  })
  message!: string;

  @ApiProperty({
    required: false,
    description: 'Chi tiết thêm (ví dụ mảng lỗi validate)',
    example: ['email must be an email'],
  })
  details?: unknown;
}
