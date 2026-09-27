import { ApiProperty } from '@nestjs/swagger';

export class ProfileResponseDto {
  @ApiProperty({ example: '01a0dc8a-7191-7e18-93b0-32e8378986fe' })
  id!: string;

  @ApiProperty({ example: 'Nhật–Việt' })
  name!: string;

  @ApiProperty({ example: 2 })
  primary_language_id!: number;

  @ApiProperty({ nullable: true, example: 1 })
  secondary_language_id!: number | null;

  @ApiProperty({ example: 3 })
  support_language_id!: number;

  @ApiProperty({ example: true })
  is_default!: boolean;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  updated_at!: string;
}

export class DeletedProfileResponseDto {
  @ApiProperty({ example: '01a0dc8a-7191-7e18-93b0-32e8378986fe' })
  id!: string;

  @ApiProperty({ example: '2026-09-27T00:00:00.000Z' })
  deleted_at!: string;
}

export class ProfileListResponseDto {
  @ApiProperty({ type: [ProfileResponseDto] })
  data!: ProfileResponseDto[];
}
