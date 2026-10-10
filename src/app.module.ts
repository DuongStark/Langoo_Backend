import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { SchedulerModule } from './common/scheduler/scheduler.module';
import { validateEnv } from './config/env.schema';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { PrismaModule } from './db/prisma.module';
import { DictionaryModule } from './dictionary/dictionary.module';
import { CollectionsModule } from './collections/collections.module';
import { FeedbackModule } from './feedback/feedback.module';
import { GamificationModule } from './gamification/gamification.module';
import { HealthModule } from './health/health.module';
import { SrsModule } from './srs/srs.module';
import { SessionsModule } from './sessions/sessions.module';
import { SourcesModule } from './sources/sources.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        skipIf: () =>
          configService.get<boolean>('RATE_LIMIT_ENABLED') === false,
      }),
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.getOrThrow<string>('LOG_LEVEL'),
          transport:
            configService.get<string>('NODE_ENV') === 'development'
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:standard' },
                }
              : undefined,
          redact: {
            paths: [
              'req.body',
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),
    DbModule,
    PrismaModule,
    StorageModule,
    AiModule,
    SchedulerModule,
    AuthModule,
    DictionaryModule,
    CollectionsModule,
    SrsModule,
    SessionsModule,
    GamificationModule,
    UsersModule,
    FeedbackModule,
    AdminModule,
    HealthModule,
    SourcesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
