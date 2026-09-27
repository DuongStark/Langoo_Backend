import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { parseDictionaryId } from './dictionary-id';
import { DictionaryService } from './dictionary.service';
import {
  LexemeSensesResultDto,
  KanjiCardDto,
  SearchResultDto,
  SenseDetailDto,
  SenseLinksResultDto,
} from './dto/dictionary-response.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import {
  KanjiCardResponse,
  SearchResult,
  SenseDetailResponse,
  SenseLinksResult,
  LexemeSensesResult,
} from './types/dictionary.types';

/**
 * Tra từ điển công khai (không bắt buộc đăng nhập).
 * Nếu client gửi Bearer hợp lệ, từ khoá sẽ được ghi vào lịch sử tra từ.
 */
@ApiTags('dictionary')
@Controller('dictionary')
export class SearchController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Tra từ điển (Anh–Việt, Nhật–Việt); có token sẽ ghi lịch sử',
  })
  @ApiOkResponse({ type: SearchResultDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'LANGUAGE_NOT_FOUND / VALIDATION_FAILED',
  })
  search(
    @Query() query: SearchQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<SearchResult> {
    const userId = request.user ? BigInt(request.user.sub) : undefined;
    return this.dictionaryService.search(query, userId);
  }
}

/** Danh sách nghĩa của một lexeme sau khi người dùng chọn kết quả search. */
@ApiTags('lexemes')
@Controller('lexemes')
export class LexemeController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get(':id/senses')
  @ApiOperation({ summary: 'Lấy toàn bộ nghĩa của một từ điển' })
  @ApiOkResponse({ type: LexemeSensesResultDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'LEXEME_NOT_FOUND',
  })
  senses(@Param('id') id: string): Promise<LexemeSensesResult> {
    return this.dictionaryService.getLexemeSenses(parseDictionaryId(id));
  }
}

/** Chi tiết nghĩa + cặp song ngữ gợi ý — công khai. */
@ApiTags('senses')
@Controller('senses')
export class SenseController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Chi tiết nghĩa: gloss, ví dụ, phát âm, forms của từ',
  })
  @ApiOkResponse({ type: SenseDetailDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'SENSE_NOT_FOUND',
  })
  get(@Param('id') id: string): Promise<SenseDetailResponse> {
    return this.dictionaryService.getSenseDetail(parseDictionaryId(id));
  }

  @Get(':id/links')
  @ApiOperation({
    summary:
      'Cặp sense ngôn ngữ khác cùng concept (serve.sense_pair, chỉ curated)',
  })
  @ApiOkResponse({ type: SenseLinksResultDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'SENSE_NOT_FOUND',
  })
  links(@Param('id') id: string): Promise<SenseLinksResult> {
    return this.dictionaryService.getSenseLinks(parseDictionaryId(id));
  }
}

/** Chi tiết chữ Hán — công khai. */
@ApiTags('kanji')
@Controller('kanji')
export class KanjiController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get(':literal')
  @ApiOperation({ summary: 'Chi tiết chữ Hán: nét, cấp, âm, nghĩa, bộ thủ' })
  @ApiOkResponse({ type: KanjiCardDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'KANJI_NOT_FOUND',
  })
  get(@Param('literal') literal: string): Promise<KanjiCardResponse> {
    return this.dictionaryService.getKanji(literal);
  }
}
