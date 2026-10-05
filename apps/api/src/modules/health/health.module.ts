import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { Environment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly storage: S3Client;
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Environment, true>,
  ) {
    this.storage = new S3Client({
      endpoint: config.get('MINIO_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('MINIO_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('MINIO_SECRET_KEY', { infer: true }),
      },
      maxAttempts: 1,
    });
  }
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    const results = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.client.ping(),
      this.storage.send(
        new HeadBucketCommand({ Bucket: this.config.get('MINIO_BUCKET', { infer: true }) }),
        { abortSignal: AbortSignal.timeout(3000) },
      ),
    ]);
    const checks = Object.fromEntries(
      ['postgres', 'redis', 'storage'].map((name, index) => [
        name,
        results[index]?.status === 'fulfilled' ? 'up' : 'down',
      ]),
    );
    if (results.some((result) => result.status === 'rejected'))
      throw new ServiceUnavailableException({ code: 'NOT_READY', checks });
    return { status: 'ok', checks };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
