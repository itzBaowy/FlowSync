import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { OriginGuard } from './common/origin.guard';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { HttpErrorFilter } from './common/http';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { KanbanModule } from './modules/kanban/kanban.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { AIModule } from './modules/ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      assignResponse: true,
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
        genReqId: (_request, response) => {
          const id = randomUUID();
          response.setHeader('X-Request-Id', id);
          return id;
        },
        // URLs can carry reset/invite tokens in later modules; log pathname only.
        serializers: {
          req: (request: { id: string; method: string; url: string }) => ({
            id: request.id,
            method: request.method,
            route: request.url?.split('?')[0],
          }),
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'password',
            'passwordHash',
            'token',
            'accessToken',
            'refreshToken',
          ],
          censor: '[REDACTED]',
        },
        customProps: (request) => ({
          userId: (request as typeof request & { userId?: string }).userId,
        }),
      },
    }),
    DatabaseModule,
    ThrottlerModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: 'default', ttl: 60000, limit: 120 }],
        storage,
      }),
    }),
    AuthModule,
    HealthModule,
    OrganizationsModule,
    WorkspacesModule,
    ProjectsModule,
    KanbanModule,
    RealtimeModule,
    DiscoveryModule,
    AIModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpErrorFilter },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
