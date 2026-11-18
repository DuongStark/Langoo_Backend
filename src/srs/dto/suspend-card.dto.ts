import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsUUID, ValidateIf } from 'class-validator';

export class SuspendCardDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  face_id!: string;

  @ApiPropertyOptional({ enum: ['recognize'] })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['recognize'])
  direction?: 'recognize';

  @ApiProperty({ example: true })
  @IsBoolean()
  suspended!: boolean;
}
