import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/auth.types';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import {
  TermsAcceptanceInput,
  TermsAcceptanceResponse,
  TermsStateResponse,
} from './privacy.dto';
import { PrivacyService } from './privacy.service';

@ApiTags('Legal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({
  type: ErrorResponseDto,
  description: 'PRIVACY_UNAVAILABLE; do not infer acceptance on failure',
})
@Controller('me/legal/terms')
export class TermsController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get()
  @ApiOperation({
    summary: 'Current terms acceptance for the authenticated account',
  })
  @ApiOkResponse({ type: TermsStateResponse })
  state(@CurrentUser() user: JwtPayload): Promise<TermsStateResponse> {
    return this.privacy.termsState(BigInt(user.sub));
  }

  @Post()
  @ApiOperation({
    summary:
      'Record explicit terms acceptance; does not grant optional privacy purposes',
  })
  @ApiCreatedResponse({ type: TermsAcceptanceResponse })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'TERMS_VERSION_OUTDATED or TERMS_REQUEST_CONFLICT',
  })
  accept(
    @CurrentUser() user: JwtPayload,
    @Body() body: TermsAcceptanceInput,
  ): Promise<TermsAcceptanceResponse> {
    return this.privacy.acceptTerms(BigInt(user.sub), body);
  }
}
