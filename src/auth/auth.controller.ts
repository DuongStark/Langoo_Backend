import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { AuthService } from './auth.service';
import {
  AuthResultDto,
  AuthTokensDto,
  SessionResponseDto,
  UserResponseDto,
} from './dto/auth-response.dto';
import { GoogleLinkDto, GoogleLoginDto } from './dto/google-login.dto';
import { GoogleOAuthChallengeDto } from './dto/google-oauth-challenge.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedRequest, JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { GoogleOauthService } from './oauth/google-oauth.service';
import { GoogleOAuthChallengeService } from './oauth/google-oauth-challenge.service';
import {
  AuthResult,
  AuthTokens,
  JwtPayload,
  SessionResponse,
  UserResponse,
  GoogleLinkResult,
  GoogleOAuthChallengeResult,
} from './types/auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOauthService: GoogleOauthService,
    private readonly googleChallengeService: GoogleOAuthChallengeService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Đăng ký tài khoản mới (tự đăng nhập)' })
  @ApiCreatedResponse({ type: AuthResultDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Email đã được đăng ký (AUTH_EMAIL_TAKEN)',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: 'RATE_LIMITED (5 lần/giờ/IP)',
  })
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Đăng nhập bằng email/mật khẩu' })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_INVALID_CREDENTIALS / AUTH_ACCOUNT_LOCKED',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: 'RATE_LIMITED (10 lần/phút/IP)',
  })
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.authService.login(dto);
  }

  @Post('oauth/google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Đăng nhập/đăng ký bằng Google ID token (OAuth2)',
    description:
      'Client lấy ID token từ Google Sign-In SDK và gửi lên. Email chỉ dùng để phát hiện ' +
      'xung đột; tài khoản đã tồn tại phải liên kết chủ động qua endpoint link.',
  })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_OAUTH_TOKEN_INVALID (token/nonce không hợp lệ)',
  })
  oauthGoogle(@Body() dto: GoogleLoginDto): Promise<AuthResult> {
    return this.googleOauthService.login(dto);
  }

  @Post('oauth/google/challenge')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Tạo challenge dùng một lần cho Google login/link',
    description:
      'Client dùng nonce trả về để khởi tạo Google Sign-In SDK. Link cần bearer token; ' +
      'login có thể gọi công khai.',
  })
  @ApiOkResponse({ description: 'Challenge và secret dùng một lần' })
  oauthGoogleChallenge(
    @Req() request: AuthenticatedRequest,
    @Body() dto: GoogleOAuthChallengeDto,
  ): Promise<GoogleOAuthChallengeResult> {
    const payload = request.user;
    return this.googleChallengeService.create(
      dto.purpose,
      dto.purpose === 'link' && payload ? BigInt(payload.sub) : undefined,
      dto.purpose === 'link' ? payload?.sid : undefined,
    );
  }

  @Post('oauth/google/link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Liên kết Google vào tài khoản hiện tại sau khi xác nhận mật khẩu',
  })
  @ApiOkResponse({ description: 'Google identity đã được liên kết' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'AUTH_OAUTH_EMAIL_MISMATCH / AUTH_OAUTH_IDENTITY_TAKEN / AUTH_OAUTH_LINK_PASSWORD_REQUIRED',
  })
  oauthGoogleLink(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: GoogleLinkDto,
  ): Promise<GoogleLinkResult> {
    return this.googleOauthService.link(BigInt(payload.sub), dto, payload.sid);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Xoay vòng refresh token lấy cặp token mới' })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_INVALID_REFRESH_TOKEN / AUTH_REFRESH_TOKEN_EXPIRED',
  })
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Thu hồi session hiện tại (refresh token của session bị vô hiệu)',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  logout(@CurrentUser() payload: JwtPayload): Promise<SessionResponse> {
    return this.authService.logout(payload);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thông tin user đang đăng nhập' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  me(@CurrentUser() payload: JwtPayload): Promise<UserResponse> {
    return this.authService.me(BigInt(payload.sub));
  }
}
