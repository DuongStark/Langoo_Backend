import { ApiProperty } from '@nestjs/swagger';

export class CollectionResponseDto {
  @ApiProperty({ example: '01a0dc8a-7191-7e18-93b0-32e8378986fe' })
  id!: string;

  @ApiProperty({ example: '01a0dc8a-718f-7acd-a588-2cf077898399' })
  profile_id!: string;

  @ApiProperty({ example: '4' })
  owner_id!: string;

  @ApiProperty({ example: 'Bộ của tôi' })
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({
    example: 'personal',
    description: 'personal | cloned | shared',
  })
  kind!: string;

  @ApiProperty({ nullable: true, example: '1' })
  cloned_from_deck_id!: string | null;

  @ApiProperty({ nullable: true })
  cloned_from_collection_id!: string | null;

  @ApiProperty({ example: false })
  is_public!: boolean;

  @ApiProperty({ example: 12 })
  item_count!: number;

  @ApiProperty({
    example: 10,
    description:
      'Items with at least one face in the collection profile languages',
  })
  visible_item_count!: number;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  updated_at!: string;

  @ApiProperty({ nullable: true })
  archived_at!: string | null;
}

export class CollectionListResponseDto {
  @ApiProperty({ type: [CollectionResponseDto] })
  data!: CollectionResponseDto[];

  @ApiProperty({ nullable: true, example: null })
  next_cursor!: string | null;
}

export class ArchivedResponseDto {
  @ApiProperty({ example: '01a0dc8a-7191-7e18-93b0-32e8378986fe' })
  id!: string;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  archived_at!: string;
}

export class DeletedResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  deleted_at!: string;
}

export class TagResponseDto {
  @ApiProperty({ example: '5' })
  id!: string;

  @ApiProperty({ example: '#n5' })
  name!: string;

  @ApiProperty({ nullable: true, example: '#4f46e5' })
  color!: string | null;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  created_at!: string;
}

export class TagListResponseDto {
  @ApiProperty({ type: [TagResponseDto] })
  data!: TagResponseDto[];

  @ApiProperty({ nullable: true, example: null })
  next_cursor!: string | null;
}

export class ItemFaceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '1' })
  sense_id!: string;

  @ApiProperty({ example: 2 })
  language_id!: number;

  @ApiProperty({ example: 'primary', enum: ['primary', 'secondary'] })
  role!: string;
}

export class ItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  collection_id!: string;

  @ApiProperty({ nullable: true, example: '1' })
  concept_id!: string | null;

  @ApiProperty({ example: '1' })
  anchor_sense_id!: string;

  @ApiProperty({
    nullable: true,
    example: '1',
    description: 'Visible face to display; anchor identity is preserved',
  })
  display_sense_id!: string | null;

  @ApiProperty({ example: 'chạy' })
  meaning_vi!: string;

  @ApiProperty({
    example: 'user',
    description:
      'user | source | machine | llm — machine = gloss máy (FE hiện badge)',
  })
  meaning_source!: string;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ example: 'learning' })
  status!: string;

  @ApiProperty({ example: 1 })
  position!: number;

  @ApiProperty({ nullable: true, example: '1' })
  added_from_deck_id!: string | null;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  updated_at!: string;

  @ApiProperty({ type: [ItemFaceResponseDto] })
  faces!: ItemFaceResponseDto[];

  @ApiProperty({ type: [String], example: ['5'] })
  tag_ids!: string[];
}

export class ItemListResponseDto {
  @ApiProperty({ type: [ItemResponseDto] })
  data!: ItemResponseDto[];

  @ApiProperty({ nullable: true, example: null })
  next_cursor!: string | null;
}
