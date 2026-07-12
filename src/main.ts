import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ErrorEnvelopeFilter } from './common/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableCors({
    origin: (process.env.WEB_ORIGINS ?? 'http://localhost:3001').split(','),
    allowedHeaders: ['content-type', 'authorization', 'x-shop-id', 'idempotency-key', 'x-request-id'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.enableShutdownHooks(); // Cloud Run sends SIGTERM on scale-down

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
