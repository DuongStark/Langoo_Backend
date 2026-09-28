import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/swagger/error-response.dto';
import { AuthService } from './auth.service';
import {
  AuthResultDto,
  AuthTokensDto,
  SessionResponseDto,
  UserResponseDto,
} from './dto/auth-response.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleOauthService } from './oauth/google-oauth.service';
import {
  AuthResult,
  AuthTokens,
  JwtPayload,
  SessionResponse,
  UserResponse,
} from './types/auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOauthService: GoogleOauthService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Đăng ký tài khoản mới (tự đăng nhập)' })
  @ApiCreatedResponse({ type: AuthResultDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Email đã được đăng ký (AUTH_EMAIL_TAKEN)',
  })
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bằng email/mật khẩu' })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_INVALID_CREDENTIALS / AUTH_ACCOUNT_LOCKED',
  })
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.authService.login(dto);
  }

  @Post('oauth/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đăng nhập/đăng ký bằng Google ID token (OAuth2)',
    description:
      'Client lấy ID token từ Google Sign-In SDK và gửi lên. Email Google đã xác thực ' +
      'trùng tài khoản password sẽ được tự động liên kết.',
  })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_OAUTH_TOKEN_INVALID (token/nonce không hợp lệ)',
  })
  oauthGoogle(@Body() dto: GoogleLoginDto): Promise<AuthResult> {
    return this.googleOauthService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
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
