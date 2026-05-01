// OTel DEBE ser el primer import — antes que cualquier módulo de NestJS
import { startTelemetry, stopTelemetry } from './instrumentation';
startTelemetry();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  app.useLogger(app.get(PinoLogger));

  // Raw body solo para webhooks (para verificar firmas HMAC)
  app.use('/api/v1/webhooks', express.raw({ type: '*/*', limit: '1mb' }));

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Graceful shutdown: espera que las conexiones activas terminen
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  if (process.env.NODE_ENV !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('Pasarela de Pagos')
      .setDescription('API multi-provider multi-tenant — Sprint 5')
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'x-api-key')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 App corriendo en puerto ${port}`);
  logger.log(`📖 Docs: http://localhost:${port}/docs`);
  logger.log(`💚 Health: http://localhost:${port}/api/v1/health/ready`);
}

void bootstrap();
