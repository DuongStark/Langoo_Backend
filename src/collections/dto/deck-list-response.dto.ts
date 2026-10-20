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

export class AppendFromDeckResponseDto {
  @ApiProperty({ example: '01a0dc8a-7191-7e18-93b0-32e8378986fe' })
  collection_id!: string;

  @ApiProperty({ example: 44 })
  added!: number;

  @ApiProperty({ example: 0 })
  skipped!: number;

  @ApiProperty({ example: 144 })
  item_count!: number;
}
