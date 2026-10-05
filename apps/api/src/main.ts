import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService).get<number>('API_PORT') ?? 4000, '0.0.0.0');
  app.get(Logger).log('FlowSync API ready; Swagger: /api/docs');
}
bootstrap().catch(() => {
  console.error(
    'API startup failed. Check environment validation and infrastructure availability.',
  );
  process.exitCode = 1;
});
