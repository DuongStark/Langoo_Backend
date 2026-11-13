import { ApiProperty } from '@nestjs/swagger';

export class ItemKanjiDisplayDto {
  @ApiProperty({ type: String, example: '学' }) literal!: string;
  @ApiProperty({ type: [String], example: ['học'] }) readings_vi!: string[];
  @ApiProperty({ type: [String] }) meanings_vi!: string[];
  @ApiProperty({
    type: Boolean,
    description: 'At least one Vietnamese meaning is machine translated',
  })
  meanings_vi_machine!: boolean;
  @ApiProperty({
    type: Boolean,
    description:
      'All machine Vietnamese meanings explicitly marked reviewed; false when absent',
  })
  meanings_vi_reviewed!: boolean;
}

export class ItemDisplayDto {
  @ApiProperty({ type: String }) sense_id!: string;
  @ApiProperty({ type: String }) lemma!: string;
  @ApiProperty({ type: String, nullable: true }) reading!: string | null;
  @ApiProperty({ type: String, nullable: true }) romanization!: string | null;
  @ApiProperty({ type: String, nullable: true }) pos!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Dictionary English gloss, same source policy as sense detail',
  })
  gloss_en!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Dictionary Vietnamese gloss; does not replace item meaning_vi',
  })
  gloss_vi!: string | null;
  @ApiProperty({
    type: Boolean,
    description: 'Vietnamese gloss is machine translated',
  })
  gloss_vi_machine!: boolean;
  @ApiProperty({
    type: Boolean,
    description: 'Vietnamese gloss has been reviewed',
  })
  gloss_vi_reviewed!: boolean;
  @ApiProperty({ type: [ItemKanjiDisplayDto] }) kanji!: ItemKanjiDisplayDto[];
}
