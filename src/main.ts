import { configureChatImageBodyParser } from './ai/chat/chat-images-body-parser';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { describeCorsRule, parseCorsOrigins } from './config/cors';
import { configureHttpProxy } from './config/http-proxy';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  configureChatImageBodyParser(app);
  configureHttpProxy(app);
  app.disable('x-powered-by');
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Langoo API')
    .setDescription(
      'API backend cho ứng dụng học ngoại ngữ Langoo (Anh–Nhật). Ví dụ gọi API: docs/api/*.md',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);
  const corsOrigin = parseCorsOrigins(
    configService.get<string>('CORS_ORIGINS'),
  );
  if (corsOrigin !== null) {
    app.enableCors({ origin: corsOrigin, credentials: true });
    logger.log(
      corsOrigin === true
        ? 'CORS: cho phép mọi origin (*)'
        : `CORS: cho phép ${corsOrigin.map(describeCorsRule).join(', ')}`,
    );
  }
  const port = Number(configService.getOrThrow('PORT'));
  await app.listen(port, '0.0.0.0');

  logger.log(
    `Langoo API đang chạy tại http://localhost:${port}/v1 (Swagger: http://localhost:${port}/docs)`,
  );
}

void bootstrap();
