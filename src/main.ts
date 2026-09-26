import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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
  const port = Number(configService.getOrThrow('PORT'));
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(
    `Langoo API đang chạy tại http://localhost:${port}/v1 (Swagger: http://localhost:${port}/docs)`,
  );
}

void bootstrap();
