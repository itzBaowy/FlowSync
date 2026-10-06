import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Environment } from './config/environment';
import { ResponseInterceptor } from './common/http';

export function configureApp(app: INestApplication, swagger = true) {
  const config = app.get(ConfigService<Environment, true>);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  const instance = app.getHttpAdapter().getInstance();
  instance.disable('x-powered-by');
  instance.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.use(helmet());
  app.use(cookieParser());
  app.use(
    (_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.enableCors({
    origin: config.get('WEB_URL', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['X-Request-Id'],
  });
  app.useGlobalInterceptors(new ResponseInterceptor());
  if (swagger && config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('FlowSync API')
        .setDescription(
          'Authentication, private organizations/workspaces/projects, Kanban, collaboration and assistant requests. Responses use { data, meta }.',
        )
        .setVersion('0.1.0')
        .addBearerAuth()
        .addCookieAuth('flowsync_refresh')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }
}
