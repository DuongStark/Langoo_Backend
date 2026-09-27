import { ApiProperty } from '@nestjs/swagger';

export class SettingsResponseDto {
  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' })
  timezone!: string;

  @ApiProperty({ nullable: true, example: 3 })
  ui_language_id!: number | null;

  @ApiProperty({ example: 20, minimum: 1, maximum: 500 })
  daily_goal!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 9999 })
  srs_new_per_day!: number;

  @ApiProperty({ example: 200, minimum: 1, maximum: 9999 })
  srs_review_per_day!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { review_reminder: true },
  })
  notify!: Record<string, unknown>;

  @ApiProperty({ nullable: true, example: '01a0dc8a-...' })
  active_profile_id!: string | null;

  @ApiProperty({
    nullable: true,
    example: '2026-09-27T00:00:00.000Z',
    description: 'null khi user chưa có row settings (đang dùng mặc định)',
  })
  updated_at!: string | null;
}
