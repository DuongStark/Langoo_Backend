import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class LexemeSensesQueryDto {
  @ApiPropertyOptional({ enum: ['grouped', 'flat'], default: 'grouped' })
  @IsOptional()
  @IsIn(['grouped', 'flat'])
  view?: 'grouped' | 'flat';
}
