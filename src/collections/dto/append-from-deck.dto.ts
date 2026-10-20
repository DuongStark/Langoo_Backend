import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class AppendFromDeckDto {
  @ApiProperty({ example: '6', description: 'Id deck (chuỗi số)' })
  @IsString()
  @Matches(/^\d+$/)
  deck_id!: string;
}
