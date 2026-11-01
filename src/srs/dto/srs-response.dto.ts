import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImageContractDto } from '../../media/dto/image-contract.dto';

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

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'verb',
    description:
      'Từ loại gốc từ DB; luôn có ở kind=word, null khi thiếu, không có ở kind=meaning',
  })
  pos?: string | null;

  @ApiProperty({ enum: ['user', 'source', 'machine', 'llm'] })
  meaning_source?: string;

  @ApiProperty({ example: false })
  is_machine_generated?: boolean;
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

  @ApiProperty({ enum: ['user', 'source', 'machine', 'llm'] })
  meaning_source!: string;

  @ApiProperty({ example: false })
  is_machine_generated!: boolean;

  @ApiProperty({
    type: ImageContractDto,
    nullable: true,
    description:
      'Ảnh minh họa được phê duyệt cho nghĩa của mặt thẻ này (null nếu chưa có)',
  })
  image!: ImageContractDto | null;
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
  @ApiProperty({
    example: { amount: 0 },
    description: 'XP mới tạm dừng từ M8.3',
  })
  xp!: { amount: number };
}

export class StatsResultDto {
  @ApiProperty({ example: 12 }) due_now!: number;
  @ApiProperty({ example: 18 }) due_today!: number;
  @ApiProperty({ example: 3 }) learning!: number;
  @ApiProperty({ example: 5 }) new_introduced_today!: number;
  @ApiProperty({ example: 30 }) reviews_today!: number;
  @ApiProperty({ nullable: true, example: 88 }) accuracy_7d!: number | null;
}
