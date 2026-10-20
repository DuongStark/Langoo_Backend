import { ApiProperty } from '@nestjs/swagger';

export class DeckItemDto {
  @ApiProperty({ example: '6' })
  id!: string;

  @ApiProperty({ example: 'starter-100' })
  slug!: string;

  @ApiProperty({ example: '100 từ tiếng Nhật đầu tiên' })
  title!: string;

  @ApiProperty({ nullable: true, example: 'Bộ khởi động cho người mới.' })
  description!: string | null;

  @ApiProperty({ example: 2 })
  language_id!: number;

  @ApiProperty({ nullable: true, example: 'N5' })
  level_label!: string | null;

  @ApiProperty({ example: 100 })
  item_count!: number;
}

export class DeckListResponseDto {
  @ApiProperty({ type: [DeckItemDto] })
  data!: DeckItemDto[];
}
