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
  @ApiProperty({ example: { option_count: 4 } }) settings!: Record<
    string,
    unknown
  >;
  @ApiProperty() started_at!: string;
  @ApiProperty({ nullable: true }) finished_at!: string | null;
}

class QuizAnswerCreditDto {
  @ApiProperty({ example: 3 }) earned!: number;
  @ApiProperty({ example: 4 }) possible!: number;
}

export class SessionItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 1 }) ordinal!: number;
  @ApiProperty({ nullable: true }) srs_id!: string | null;
  @ApiProperty({ nullable: true }) face_id!: string | null;
  @ApiProperty({ description: 'Đề bài (ẩn đáp án tới khi trả lời)' })
  prompt!: unknown;
  @ApiPropertyOptional({
    description: 'Hiện sau khi trả lời câu này với Quiz M11.5',
  })
  correct_answer?: unknown;
  @ApiPropertyOptional({ type: QuizAnswerCreditDto })
  credit?: QuizAnswerCreditDto;
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
    nullable: true,
    description: 'Null với phiên quiz.',
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
  } | null;
  @ApiProperty({ type: SessionResponseDto }) session!: SessionResponseDto;
}

export class RemoveSessionWordResponseDto {
  @ApiProperty({
    example: '01a18014-bdef-70dc-b9fd-0ab4c6937199',
    description: 'ID của collection_item đã xoá',
  })
  item_id!: string;

  @ApiProperty({
    example: '01a18014-bdee-72d8-9891-b3fefa8ec160',
    description: 'ID bộ sưu tập chứa từ đã xoá',
  })
  collection_id!: string;

  @ApiProperty({
    example: [1],
    description: 'Danh sách ordinal các câu hỏi trong phiên đã bị loại bỏ',
  })
  removed_ordinals!: number[];

  @ApiProperty({
    type: SessionResponseDto,
    description: 'Trạng thái phiên học sau khi loại bỏ thẻ',
  })
  session!: SessionResponseDto;
}
