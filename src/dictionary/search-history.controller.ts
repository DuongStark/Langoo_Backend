import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { SearchHistoryResultDto } from './dto/dictionary-response.dto';
import { SearchHistoryService } from './search-history.service';
import { SearchHistoryResult } from './types/dictionary.types';

@ApiTags('dictionary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/search-history')
export class SearchHistoryController {
  constructor(private readonly searchHistoryService: SearchHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'Lịch sử tra từ gần đây của tôi (50 dòng)' })
  @ApiOkResponse({ type: SearchHistoryResultDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  list(@CurrentUser() payload: JwtPayload): Promise<SearchHistoryResult> {
    return this.searchHistoryService.list(BigInt(payload.sub));
  }
}
