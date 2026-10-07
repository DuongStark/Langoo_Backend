import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SourceListResponseDto } from './dto/source-response.dto';
import { SourcesService } from './sources.service';

/** Public — trang "Nguồn dữ liệu / Ghi nguồn" của FE đọc API này. */
@ApiTags('sources')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Danh sách nguồn dữ liệu (license/attribution/url) + số liệu đóng góp',
  })
  @ApiOkResponse({ type: SourceListResponseDto })
  async list(): Promise<SourceListResponseDto> {
    return { data: await this.sourcesService.list() };
  }
}
