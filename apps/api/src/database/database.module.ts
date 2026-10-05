import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { RedisThrottlerStorage } from '../common/redis-throttler.storage';

@Global()
@Module({
  providers: [PrismaService, RedisService, RedisThrottlerStorage],
  exports: [PrismaService, RedisService, RedisThrottlerStorage],
})
export class DatabaseModule {}
