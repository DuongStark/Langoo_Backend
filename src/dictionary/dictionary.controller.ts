import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiGatewayTimeoutResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { parseDictionaryId } from './dictionary-id';
import { DictionaryService } from './dictionary.service';
import {
  LexemeSensesResultDto,
  KanjiCardDto,
  ReverseLookupResultDto,
  SearchResultDto,
  SenseDetailDto,
  SenseLinksResultDto,
} from './dto/dictionary-response.dto';
import { LexemeSensesQueryDto } from './dto/lexeme-senses-query.dto';
import { ReverseLookupQueryDto } from './dto/reverse-lookup-query.dto';
import { ReverseSuggestionQueryDto } from './dto/reverse-suggestion-query.dto';
import { SuggestionQueryDto } from './dto/suggestion-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import {
  KanjiCardResponse,
  ReverseLookupResult,
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
@UseGuards(OptionalJwtAuthGuard)
@Controller('dictionary')
export class SearchController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get('search')
  @ApiGatewayTimeoutResponse({
    type: ErrorResponseDto,
    description: 'DICTIONARY_SEARCH_TIMEOUT — nhập thêm ký tự rồi thử lại',
  })
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

  @Get('reverse')
  @ApiOperation({
    summary: 'Tra ngược Việt→Anh/Nhật (vd cát → sand, 砂)',
  })
  @ApiOkResponse({ type: ReverseLookupResultDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  reverse(
    @Query() query: ReverseLookupQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReverseLookupResult> {
    return this.dictionaryService.reverseLookup(
      query.q,
      query.to,
      request.user ? BigInt(request.user.sub) : undefined,
    );
  }

  @Get('suggestions')
  @ApiGatewayTimeoutResponse({
    type: ErrorResponseDto,
    description: 'DICTIONARY_SEARCH_TIMEOUT — nhập thêm ký tự rồi thử lại',
  })
  @ApiOperation({
    summary: 'Gợi ý tìm kiếm tối đa 5 từ phổ biến, không ghi lịch sử tra từ',
  })
  @ApiOkResponse({ type: SearchResultDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'LANGUAGE_NOT_FOUND / VALIDATION_FAILED',
  })
  suggestions(
    @Query() query: SuggestionQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<SearchResult> {
    return this.dictionaryService.suggest(
      query,
      request.user ? BigInt(request.user.sub) : undefined,
    );
  }

  /**
   * Gợi ý VI→EN/JA cho autocomplete: prefix, không phân biệt hoa/thường &
   * dấu (gõ "truong" vẫn ra "trường"). Tôn trọng scope hồ sơ như /reverse.
   */
  @Get('suggestions/reverse')
  @ApiOperation({
    summary: 'Gợi ý tiếng Việt → Anh/Nhật (tiền tố, không phân biệt dấu)',
  })
  @ApiOkResponse({ type: ReverseLookupResultDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED (q rỗng/quá dài, to không hợp lệ)',
  })
  suggestReverse(
    @Query() query: ReverseSuggestionQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReverseLookupResult> {
    return this.dictionaryService.suggestReverse(
      query,
      request.user ? BigInt(request.user.sub) : undefined,
    );
  }
}

/** Danh sách nghĩa của một lexeme sau khi người dùng chọn kết quả search. */
@ApiTags('lexemes')
@UseGuards(OptionalJwtAuthGuard)
@Controller('lexemes')
export class LexemeController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get(':id/senses')
  @ApiOperation({
    summary: 'Lấy nghĩa của từ: nhóm Wiktextract hoặc danh sách phẳng',
  })
  @ApiOkResponse({ type: LexemeSensesResultDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'LEXEME_NOT_FOUND',
  })
  senses(
    @Param('id') id: string,
    @Query() query: LexemeSensesQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<LexemeSensesResult> {
    return this.dictionaryService.getLexemeSenses(
      parseDictionaryId(id),
      query.view,
      request.user ? BigInt(request.user.sub) : undefined,
    );
  }
}

/** Chi tiết nghĩa + cặp song ngữ gợi ý — công khai. */
@ApiTags('senses')
@UseGuards(OptionalJwtAuthGuard)
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
  get(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SenseDetailResponse> {
    return this.dictionaryService.getSenseDetail(
      parseDictionaryId(id),
      request.user ? BigInt(request.user.sub) : undefined,
    );
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
  links(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SenseLinksResult> {
    return this.dictionaryService.getSenseLinks(
      parseDictionaryId(id),
      request.user ? BigInt(request.user.sub) : undefined,
    );
  }
}

/** Chi tiết chữ Hán — công khai. */
@ApiTags('kanji')
@UseGuards(OptionalJwtAuthGuard)
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
  get(
    @Param('literal') literal: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<KanjiCardResponse> {
    return this.dictionaryService.getKanji(
      literal,
      request.user ? BigInt(request.user.sub) : undefined,
    );
  }

  @Get(':literal/stroke.svg')
  @ApiOperation({
    summary: 'Ảnh SVG thứ tự nét (KanjiVG) — cache công khai 1 ngày',
  })
  @ApiOkResponse({ description: 'image/svg+xml' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'KANJI_STROKE_NOT_FOUND',
  })
  async stroke(
    @Param('literal') literal: string,
    @Res({ passthrough: true }) res: Response,
    @Req() request: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const { buffer, mime, sha256 } =
      await this.dictionaryService.getKanjiStroke(
        literal,
        request.user ? BigInt(request.user.sub) : undefined,
      );
    res.set({
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Cache-Control': request.user
        ? 'private, max-age=86400, immutable'
        : 'public, max-age=86400, immutable',
      Vary: 'Authorization',
      ETag: `"${sha256}"`,
    });
    return new StreamableFile(buffer);
  }
}
