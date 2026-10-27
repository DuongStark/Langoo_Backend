import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, ValidateIf } from 'class-validator';

export class MarkAchievementsSeenDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Bỏ trống hoặc [] = đánh dấu tất cả thành tích đã mở khoá; null không hợp lệ',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  codes?: string[];
}

export class LevelProgressDto {
  @ApiProperty({ example: 2 }) level!: number;
  @ApiProperty({ example: 50 }) xp_in_level!: number;
  @ApiProperty({ example: 500 }) xp_for_next!: number;
  @ApiProperty({ example: 10 }) percent!: number;
}

export class GamificationStatsDto {
  @ApiProperty({ example: 42 }) xp_total!: number;
  @ApiProperty({ example: 1 }) level!: number;
  @ApiProperty({ type: LevelProgressDto }) level_progress!: LevelProgressDto;
  @ApiProperty({ example: 3 }) streak_current!: number;
  @ApiProperty({ example: 7 }) streak_longest!: number;
  @ApiProperty({ nullable: true, example: '2026-09-27' })
  last_study_date!: string | null;
  @ApiProperty({ example: 12 }) items_learned!: number;
  @ApiProperty({ example: 40 }) reviews_total!: number;
  @ApiProperty({
    example: {
      day: '2026-09-27',
      review_count: 12,
      xp: 14,
      met_goal: false,
      goal: 20,
    },
  })
  today!: {
    day: string;
    review_count: number;
    xp: number;
    met_goal: boolean;
    goal: number;
  };
}

export class AchievementItemDto {
  @ApiProperty({ example: 'streak_7' }) code!: string;
  @ApiProperty({ example: 'Chuỗi 7 ngày' }) name_vi!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ nullable: true, example: '🔥' }) icon!: string | null;
  @ApiProperty({ example: 'streak' }) category!: string;
  @ApiProperty({ example: 0, description: 'XP thưởng tạm dừng từ M8.3' })
  xp_reward!: number;
  @ApiProperty({ example: 3 }) progress!: number;
  @ApiProperty({ nullable: true }) unlocked_at!: string | null;
  @ApiProperty({ nullable: true }) seen_at!: string | null;
}

export class AchievementListDto {
  @ApiProperty({ type: [AchievementItemDto] })
  data!: AchievementItemDto[];
  @ApiProperty({ example: 1 }) unseen_count!: number;
}

export class MarkSeenResultDto {
  @ApiProperty({ example: 2 }) updated!: number;
  @ApiProperty({ example: 0 }) unseen_count!: number;
}
