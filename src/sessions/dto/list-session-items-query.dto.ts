import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListSessionItemsQueryDto {
  @ApiPropertyOptional({
    example: false,
    description: 'true/false — lọc câu đúng/sai (màn "câu sai" dùng false)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  })
  @IsBoolean()
  is_correct?: boolean;
}
