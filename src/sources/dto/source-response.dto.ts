import { ApiProperty } from '@nestjs/swagger';

/** Số dòng dữ liệu đóng góp theo từng bảng nguồn (0 nếu chưa dùng). */
export class SourceUsageDto {
  @ApiProperty({ example: 218794 })
  lexemes!: number;

  @ApiProperty({ example: 253630 })
  senses!: number;

  @ApiProperty({ example: 443328 })
  glosses!: number;

  @ApiProperty({ example: 3216 })
  concepts!: number;

  @ApiProperty({ example: 120635 })
  concept_glosses!: number;

  @ApiProperty({ example: 13108 })
  kanji!: number;

  @ApiProperty({ example: 3512695 })
  examples!: number;
}

export class DataSourceDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'jmdict' })
  code!: string;

  @ApiProperty({ nullable: true, example: 'JMdict (kèm ví dụ Tatoeba)' })
  name!: string | null;

  @ApiProperty({ nullable: true, example: 'CC BY-SA 4.0' })
  license!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Electronic Dictionary Research and Development Group (EDRDG)',
  })
  attribution!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'https://github.com/scriptin/jmdict-simplified/releases',
  })
  url!: string | null;

  @ApiProperty({ nullable: true, example: '3.6.2' })
  version!: string | null;

  @ApiProperty({
    example:
      'JMdict (kèm ví dụ Tatoeba) — Electronic Dictionary Research and Development Group (EDRDG) · CC BY-SA 4.0',
    description: 'Dòng ghi nguồn đã ghép sẵn để hiển thị trang credits',
  })
  credit_line!: string;

  @ApiProperty({ type: SourceUsageDto })
  usage!: SourceUsageDto;
}

export class SourceListResponseDto {
  @ApiProperty({ type: [DataSourceDto] })
  data!: DataSourceDto[];
}
