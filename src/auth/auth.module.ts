import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminGuard } from './guards/admin.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { LogoutJwtAuthGuard } from './guards/logout-jwt-auth.guard';
import { GoogleOAuthChallengeService } from './oauth/google-oauth-challenge.service';
import { GoogleIdTokenVerifier } from './oauth/google-id-token.verifier';
import { GoogleOauthService } from './oauth/google-oauth.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleOauthService,
    GoogleOAuthChallengeService,
    GoogleIdTokenVerifier,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    LogoutJwtAuthGuard,
    AdminGuard,
  ],
  exports: [AuthService, JwtAuthGuard, OptionalJwtAuthGuard, AdminGuard],
})
export class AuthModule {}
