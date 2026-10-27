import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ActivityQueryDto {
  @ApiPropertyOptional({
    minimum: 2000,
    maximum: 2100,
    description: 'Năm theo timezone user; mặc định năm hiện tại',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class ActivityDayDto {
  @ApiProperty({ example: '2026-10-27' }) date!: string;
  @ApiProperty({ description: 'Lượt ôn và câu quiz dùng để tính streak' })
  activity_count!: number;
  @ApiProperty({ description: 'Lượt ôn SRS; không bao gồm quiz' })
  review_count!: number;
  @ApiProperty({
    description: 'Số lexeme khác nhau xác định được trong các lượt ôn',
  })
  distinct_words!: number;
  @ApiProperty({
    description:
      'Lượt ôn không còn liên kết tới từ; distinct_words là mức tối thiểu nếu lớn hơn 0',
  })
  unresolved_review_count!: number;
}

export class ActivityResponseDto {
  @ApiProperty({ example: 2026 }) year!: number;
  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' }) timezone!: string;
  @ApiProperty({ example: '2026-10-27' }) today!: string;
  @ApiProperty() streak_current!: number;
  @ApiProperty() streak_longest!: number;
  @ApiProperty({ type: [ActivityDayDto] }) days!: ActivityDayDto[];
}
