import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Security headers (helmet) — baseline hardening per the Security Review's
  // OWASP API mapping (M8/API8: Security Misconfiguration).
  app.use(helmet());

  // Versioned API (/api/v1/...) per the System Architecture's API design
  // rationale — avoids breaking older mobile clients on schema evolution.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api');

  // Global validation — every DTO is validated; unknown/unexpected fields
  // are stripped (whitelist) rather than silently accepted, closing off
  // OWASP API3 (Broken Object Property Level Authorization) at the edge.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Nafaqa backend listening on port ${port}`);
}

bootstrap();
