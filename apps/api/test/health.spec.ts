import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { HealthController } from '../src/modules/health/health.module';
import type { Environment } from '../src/config/environment';
import type { PrismaService } from '../src/database/prisma.service';
import type { RedisService } from '../src/database/redis.service';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function fixture() {
  const query = vi.fn(async () => [{ ready: 1 }]);
  const ping = vi.fn(async () => 'PONG');
  const storage = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue(undefined);
  const config = new ConfigService<Environment, true>({
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ACCESS_KEY: 'fixture',
    MINIO_SECRET_KEY: 'fixture-only-secret',
    MINIO_BUCKET: 'fixture',
    S3_REGION: 'us-east-1',
  });
  const controller = new HealthController(
    { $queryRaw: query } as unknown as PrismaService,
    { client: { ping } } as unknown as RedisService,
    config,
  );
  return { controller, query, ping, storage };
}
describe('public readiness dependency pressure', () => {
  it('coalesces concurrent probes and refreshes after the short cache window', async () => {
    vi.useFakeTimers();
    const { controller, query, ping, storage } = fixture();
    try {
      const results = await Promise.all(Array.from({ length: 50 }, () => controller.ready()));
      expect(results.every((result) => result.status === 'ok')).toBe(true);
      await controller.ready();
      expect(query).toHaveBeenCalledTimes(1);
      expect(ping).toHaveBeenCalledTimes(1);
      expect(storage).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2001);
      await controller.ready();
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      controller.onModuleDestroy();
    }
  });
  it('caches failures briefly and detects recovery on the next inspection', async () => {
    vi.useFakeTimers();
    const { controller, query } = fixture();
    query.mockRejectedValueOnce(new Error('fixture outage'));
    try {
      await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
      await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
      expect(query).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2001);
      await expect(controller.ready()).resolves.toMatchObject({ status: 'ok' });
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      controller.onModuleDestroy();
    }
  });
});
