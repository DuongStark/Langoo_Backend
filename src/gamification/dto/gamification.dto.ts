import { ApiProperty } from '@nestjs/swagger';

export class GamificationStatsDto {
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
      met_goal: false,
      goal: 20,
    },
  })
  today!: {
    day: string;
    review_count: number;
    met_goal: boolean;
    goal: number;
  };
}
