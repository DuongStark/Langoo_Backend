import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CollectionResponseDto } from './collection-response.dto';

export const IMPORT_MAX_ITEMS = 500;
export const IMPORT_STATUSES = ['learning', 'paused', 'known'] as const;
export type ImportItemStatus = (typeof IMPORT_STATUSES)[number];

export class ImportItemInputDto {
  @ApiProperty({
    example: '支える',
    maxLength: 120,
    description: 'Mặt chữ của từ cần import (bắt buộc)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFKC').trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  word!: string;

  @ApiPropertyOptional({
    example: 'verb',
    maxLength: 40,
    description:
      'Từ loại tùy chọn (hỗ trợ n/v/adj/adv, tiếng Việt, tiếng Nhật; ưu tiên khớp đúng POS, lệch sẽ fallback theo mặt chữ)',
  })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFKC').trim() : value,
  )
  @IsString()
  @MaxLength(40)
  pos?: string;

  @ApiPropertyOptional({
    example: 'ささえる つかえる',
    maxLength: 120,
    description:
      'Cách đọc / phiên âm tùy chọn (vd cột Phonetic của Mazii; hỗ trợ nhiều cách đọc cách nhau bởi khoảng trắng)',
  })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFKC').trim() : value,
  )
  @IsString()
  @MaxLength(120)
  reading?: string;

  @ApiPropertyOptional({
    example: 'ささえる つかえる',
    maxLength: 120,
    description:
      'Alias của reading dành cho file Mazii (cột Phonetic); nếu reading trống sẽ dùng phonetic',
  })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFKC').trim() : value,
  )
  @IsString()
  @MaxLength(120)
  phonetic?: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    description:
      'Tùy chọn nhận cột Mean từ file Mazii/Excel để không bị chặn bởi forbidNonWhitelisted (hệ thống vẫn lấy nghĩa chuẩn từ điển)',
  })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(1000)
  mean?: string;

  @ApiPropertyOptional({
    example: 'Gặp trong đề N2',
    maxLength: 500,
    description: 'Ghi chú cá nhân tùy chọn (vd cột Note của Mazii)',
  })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: 'word',
    maxLength: 30,
    description:
      'Loại mục từ nguồn (vd cột Type của Mazii: word | kanji | grammar | sentence). Khác word sẽ báo unsupported_type',
  })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFKC').trim() : value,
  )
  @IsString()
  @MaxLength(30)
  source_type?: string;

  @ApiPropertyOptional({
    example: 'word',
    maxLength: 30,
    description:
      'Alias của source_type dành cho file Mazii (cột Type); nếu source_type trống sẽ dùng type',
  })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFKC').trim() : value,
  )
  @IsString()
  @MaxLength(30)
  type?: string;
}

export class ImportItemsDto {
  @ApiProperty({
    type: [ImportItemInputDto],
    minItems: 1,
    maxItems: IMPORT_MAX_ITEMS,
    description: `Danh sách từ cần import tự động (tối đa ${IMPORT_MAX_ITEMS} dòng/request)`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ImportItemInputDto)
  items!: ImportItemInputDto[];

  @ApiPropertyOptional({
    enum: [...IMPORT_STATUSES],
    default: 'learning',
    description: 'Trạng thái ban đầu của các từ được thêm vào sổ tay',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn([...IMPORT_STATUSES])
  status?: ImportItemStatus;
}

export class CreateCollectionAndImportDto extends ImportItemsDto {
  @ApiProperty({
    example: 'Kanji Shit',
    maxLength: 80,
    description:
      'Tên bộ sưu tập mới (FE có thể điền sẵn từ tên sheet/file Mazii)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Mặc định: active_profile_id → hồ sơ default',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID()
  profile_id?: string;
}

export class ImportAddedItemDto {
  @ApiProperty({ example: 0 })
  index!: number;

  @ApiProperty({ example: '性質' })
  word!: string;

  @ApiProperty({ example: '01a0dc8a-7191-7e18-93b0-32e8378986fe' })
  item_id!: string;

  @ApiProperty({ example: '149507' })
  sense_id!: string;

  @ApiProperty({ example: '性質' })
  lemma!: string;

  @ApiProperty({ nullable: true, example: 'せいしつ' })
  reading!: string | null;

  @ApiProperty({ nullable: true, example: 'noun' })
  pos!: string | null;

  @ApiProperty({ example: 'bản tính, tính tình, khí chất (của con người)' })
  meaning_vi!: string;

  @ApiProperty({
    example: true,
    description:
      'true nếu không gửi pos hoặc khớp đúng pos; false nếu lệch pos và hệ thống fallback theo mặt chữ',
  })
  pos_matched!: boolean;

  @ApiProperty({
    nullable: true,
    example: null,
    description:
      'M4.9: null nếu khớp chính xác; chuỗi mặt chữ gốc người dùng gửi nếu khớp qua đưa từ tiếng Nhật về dạng gốc (deinflection)',
  })
  deinflected_from!: string | null;
}

export class ImportSkippedDuplicateDto {
  @ApiProperty({ example: 3 })
  index!: number;

  @ApiProperty({ example: '教員' })
  word!: string;

  @ApiProperty({ example: '13790' })
  sense_id!: string;

  @ApiProperty({ example: '教員' })
  lemma!: string;

  @ApiProperty({
    enum: ['already_in_collection', 'duplicate_in_request'],
    example: 'already_in_collection',
  })
  reason!: 'already_in_collection' | 'duplicate_in_request';
}

export class ImportNotFoundItemDto {
  @ApiProperty({ example: 7 })
  index!: number;

  @ApiProperty({ example: 'abcxyz' })
  word!: string;

  @ApiProperty({ nullable: true, example: 'noun' })
  pos!: string | null;

  @ApiProperty({
    enum: ['not_in_dictionary', 'language_not_in_profile', 'unsupported_type'],
    example: 'not_in_dictionary',
  })
  reason!: 'not_in_dictionary' | 'language_not_in_profile' | 'unsupported_type';
}

export class ImportItemsResponseDto {
  @ApiProperty({ type: CollectionResponseDto })
  collection!: CollectionResponseDto;

  @ApiProperty({ example: 10 })
  total_submitted!: number;

  @ApiProperty({ example: 8 })
  added_count!: number;

  @ApiProperty({ example: 1 })
  skipped_duplicate_count!: number;

  @ApiProperty({ example: 1 })
  not_found_count!: number;

  @ApiProperty({ type: [ImportAddedItemDto] })
  added!: ImportAddedItemDto[];

  @ApiProperty({ type: [ImportSkippedDuplicateDto] })
  skipped_duplicates!: ImportSkippedDuplicateDto[];

  @ApiProperty({ type: [ImportNotFoundItemDto] })
  not_found!: ImportNotFoundItemDto[];
}
