import { ApiProperty } from '@nestjs/swagger';

export class DueCardLanguageDto {
  @ApiProperty({ example: 2 })
  id!: number;

  @ApiProperty({ example: 'ja' })
  code!: string;

  @ApiProperty({ example: 'Tiếng Nhật' })
  name_vi!: string;
}

export class LocalizedContentDto {
  @ApiProperty({ enum: ['word', 'meaning'] })
  kind!: string;

  @ApiProperty({ example: '走る' })
  text!: string;

  @ApiProperty({ nullable: true, example: 'はしる' })
  reading?: string | null;

  @ApiProperty({ nullable: true, example: 'hashiru' })
  romanization?: string | null;
}

export class DueCardDto {
  @ApiProperty({ example: '7' })
  srs_id!: string;

  @ApiProperty()
  face_id!: string;

  @ApiProperty()
  item_id!: string;

  @ApiProperty()
  collection_id!: string;

  @ApiProperty({ enum: ['recognize', 'recall'] })
  direction!: string;

  @ApiProperty({ example: 'learning' })
  state!: string;

  @ApiProperty({ type: DueCardLanguageDto })
  language!: DueCardLanguageDto;

  @ApiProperty({ example: 'Nhớ lại từ Tiếng Nhật' })
  instruction!: string;

  @ApiProperty({ type: LocalizedContentDto })
  prompt!: LocalizedContentDto;

  @ApiProperty({ type: LocalizedContentDto })
  answer!: LocalizedContentDto;

  @ApiProperty({ example: '2026-09-27T02:10:00.000Z' })
  due_at!: string;
}

export class DueCountsDto {
  @ApiProperty({ example: 3 }) learning!: number;
  @ApiProperty({ example: 7 }) review!: number;
  @ApiProperty({ example: 2 }) new!: number;
}

export class DueResultDto {
  @ApiProperty({ type: [DueCardDto] })
  data!: DueCardDto[];

  @ApiProperty({ nullable: true, example: null })
  next_cursor!: string | null;

  @ApiProperty({ type: DueCountsDto })
  counts!: DueCountsDto;
}

export class ReviewLogDto {
  @ApiProperty({ example: '42' }) id!: string;
  @ApiProperty({ example: 3 }) rating!: number;
  @ApiProperty({ example: 'flashcard' }) mode!: string;
  @ApiProperty({ nullable: true, example: 'new' }) prev_state!: string | null;
  @ApiProperty() reviewed_at!: string;
}

export class SrsStateDto {
  @ApiProperty({ example: 'learning' }) state!: string;
  @ApiProperty() due_at!: string;
  @ApiProperty({ example: 0 }) interval_days!: number;
  @ApiProperty({ example: 2.5 }) ease_factor!: number;
  @ApiProperty({ nullable: true, example: 1 }) learning_step!: number | null;
}

export class ReviewResultDto {
  @ApiProperty({ type: ReviewLogDto }) review_log!: ReviewLogDto;
  @ApiProperty({ type: SrsStateDto }) srs!: SrsStateDto;
  @ApiProperty({ example: { amount: 1 } }) xp!: { amount: number };
}

export class StatsResultDto {
  @ApiProperty({ example: 12 }) due_now!: number;
  @ApiProperty({ example: 18 }) due_today!: number;
  @ApiProperty({ example: 3 }) learning!: number;
  @ApiProperty({ example: 5 }) new_introduced_today!: number;
  @ApiProperty({ example: 30 }) reviews_today!: number;
  @ApiProperty({ nullable: true, example: 88 }) accuracy_7d!: number | null;
}
