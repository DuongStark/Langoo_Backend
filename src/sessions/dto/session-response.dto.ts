import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SessionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'review' }) kind!: string;
  @ApiProperty({ example: 'multiple_choice' }) mode!: string;
  @ApiProperty({ nullable: true }) collection_id!: string | null;
  @ApiProperty({ example: 'in_progress' }) status!: string;
  @ApiProperty({ example: 10 }) item_count!: number;
  @ApiProperty({ example: 4 }) answered_count!: number;
  @ApiProperty({ example: 3 }) correct_count!: number;
  @ApiProperty({ nullable: true, example: null }) score!: number | null;
  @ApiProperty({ example: 4 }) xp_awarded!: number;
  @ApiProperty({ example: { option_count: 4 } }) settings!: Record<
    string,
    unknown
  >;
  @ApiProperty() started_at!: string;
  @ApiProperty({ nullable: true }) finished_at!: string | null;
}

export class SessionItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 1 }) ordinal!: number;
  @ApiProperty({ nullable: true }) srs_id!: string | null;
  @ApiProperty({ nullable: true }) face_id!: string | null;
  @ApiProperty({ description: 'Đề bài (ẩn đáp án tới khi trả lời)' })
  prompt!: unknown;
  @ApiPropertyOptional({ description: 'Chỉ có sau khi đã trả lời' })
  correct_answer?: unknown;
  @ApiPropertyOptional() user_answer?: unknown;
  @ApiProperty({ nullable: true, example: null }) is_correct!: boolean | null;
  @ApiProperty({ nullable: true }) rating!: number | null;
  @ApiProperty({ nullable: true }) elapsed_ms!: number | null;
  @ApiProperty({ nullable: true }) answered_at!: string | null;
}

export class SessionDetailResponseDto {
  @ApiProperty({ type: SessionResponseDto }) session!: SessionResponseDto;
  @ApiProperty({ type: [SessionItemResponseDto] })
  items!: SessionItemResponseDto[];
}

export class AnswerResultResponseDto {
  @ApiProperty({ type: SessionItemResponseDto }) item!: SessionItemResponseDto;
  @ApiProperty({
    example: {
      state: 'learning',
      due_at: '…',
      interval_days: 0,
      ease_factor: 2.5,
      learning_step: 1,
    },
  })
  srs!: {
    state: string;
    due_at: string;
    interval_days: number;
    ease_factor: number;
    learning_step: number | null;
  };
  @ApiProperty({ example: { amount: 1 } }) xp!: { amount: number };
  @ApiProperty({ type: SessionResponseDto }) session!: SessionResponseDto;
}
