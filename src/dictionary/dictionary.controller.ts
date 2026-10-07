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

  @Get('reverse')
  @ApiOperation({
    summary: 'Tra ngược Việt→Anh/Nhật (vd cát → sand, 砂)',
  })
  @ApiOkResponse({ type: ReverseLookupResultDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  reverse(@Query() query: ReverseLookupQueryDto): Promise<ReverseLookupResult> {
    return this.dictionaryService.reverseLookup(query.q, query.to);
  }
}

/** Danh sách nghĩa của một lexeme sau khi người dùng chọn kết quả search. */
@ApiTags('lexemes')
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
  ): Promise<LexemeSensesResult> {
    return this.dictionaryService.getLexemeSenses(
      parseDictionaryId(id),
      query.view,
    );
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
  ): Promise<StreamableFile> {
    const { buffer, mime, sha256 } =
      await this.dictionaryService.getKanjiStroke(literal);
    res.set({
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=86400, immutable',
      ETag: `"${sha256}"`,
    });
    return new StreamableFile(buffer);
  }
}
