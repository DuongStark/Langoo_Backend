import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', description: 'Trạng thái API' })
  status!: 'ok';

  @ApiProperty({
    example: 'ok',
    description: 'Trạng thái kết nối cơ sở dữ liệu',
  })
  db!: 'ok';

  @ApiProperty({ example: 3, description: 'Độ trễ truy vấn DB (ms)' })
  db_latency_ms!: number;

  @ApiProperty({ example: 42, description: 'Số giây ứng dụng đã chạy' })
  uptime_s!: number;

  @ApiProperty({
    example: '2026-09-26T12:00:00.000Z',
    description: 'Thời điểm kiểm tra (UTC, ISO 8601)',
  })
  time!: string;
}
