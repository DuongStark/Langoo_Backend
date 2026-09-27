import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsUUID } from 'class-validator';

export class SuspendCardDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  face_id!: string;

  @ApiProperty({ enum: ['recognize', 'recall'] })
  @IsIn(['recognize', 'recall'])
  direction!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  suspended!: boolean;
}
