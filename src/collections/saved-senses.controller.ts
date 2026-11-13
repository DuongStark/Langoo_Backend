import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import {
  SavedSensesQueryDto,
  SavedSensesResponseDto,
} from './dto/saved-senses.dto';
import { SavedSensesService } from './saved-senses.service';

@ApiTags('collections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/saved-senses')
export class SavedSensesController {
  constructor(private readonly service: SavedSensesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Batch trạng thái nghĩa đã lưu',
    description:
      'Chỉ sổ chưa archive thuộc user/profile và ngôn ngữ hồ sơ; paused/known vẫn là đã lưu.',
  })
  @ApiOkResponse({ type: SavedSensesResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'PROFILE_NOT_FOUND',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'COLLECTION_READ_UNAVAILABLE / AUTH_SERVICE_UNAVAILABLE',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: SavedSensesQueryDto,
  ): Promise<SavedSensesResponseDto> {
    return this.service.list(BigInt(user.sub), query);
  }
}
