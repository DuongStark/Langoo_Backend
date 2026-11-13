import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, Matches } from 'class-validator';

export class SavedSensesQueryDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Owned study profile',
  })
  @IsUUID()
  profile_id!: string;

  @ApiProperty({
    type: String,
    example: '1,2',
    maxLength: 1049,
    description: '1–50 positive PostgreSQL bigint IDs, comma separated',
  })
  @IsString()
  @MaxLength(1049)
  @Matches(/^\d{1,19}(,\d{1,19}){0,49}$/)
  sense_ids!: string;
}

export class SavedSenseDto {
  @ApiProperty({ type: String, example: '1' })
  sense_id!: string;

  @ApiProperty({
    type: [String],
    description: 'Unarchived collections in the requested profile',
  })
  saved_collection_ids!: string[];
}

export class SavedSensesResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  profile_id!: string;

  @ApiProperty({ type: [SavedSenseDto] })
  data!: SavedSenseDto[];
}
