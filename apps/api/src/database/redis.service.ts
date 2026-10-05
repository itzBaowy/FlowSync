import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import type { Environment } from '../config/environment';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  constructor(config: ConfigService<Environment, true>, logger: PinoLogger) {
    this.client = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      password: config.get('REDIS_PASSWORD', { infer: true }),
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      commandTimeout: 3000,
    });
    this.client.on('error', () => logger.warn('Redis connection unavailable'));
  }
  async onModuleDestroy() {
    this.client.disconnect();
  }
}
