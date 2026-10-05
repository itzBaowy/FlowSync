import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import type { Environment } from '../../config/environment';
import type { Prisma } from '../../generated/prisma/client';
import { OBJECT_STORAGE, type ObjectStorage } from './storage.module';
@Injectable()
export class FileCleanupService {
  readonly environment: string;
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Environment, true>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {
    this.environment = config.get('NODE_ENV', { infer: true });
  }
  reserve(tx: Prisma.TransactionClient, objectKey: string, delay = 0) {
    return tx.objectCleanup.create({
      data: {
        objectKey,
        environment: this.environment,
        nextAttemptAt: new Date(Date.now() + delay),
      },
    });
  }
  async run(id: string) {
    const row = await this.prisma.objectCleanup.findFirst({
      where: { id, environment: this.environment, completedAt: null },
    });
    if (!row) return true;
    const claimed = await this.prisma.objectCleanup.updateMany({
      where: {
        id,
        environment: this.environment,
        completedAt: null,
        nextAttemptAt: { lte: new Date() },
      },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60000) },
    });
    if (!claimed.count) return false;
    try {
      // A reserved upload may have committed metadata before the cleanup job runs.
      if (!(await this.prisma.attachment.count({ where: { objectKey: row.objectKey } })))
        await this.storage.remove(row.objectKey);
      await this.prisma.objectCleanup.update({
        where: { id },
        data: { completedAt: new Date(), lastError: null },
      });
      return true;
    } catch (error) {
      await this.prisma.objectCleanup.update({
        where: { id },
        data: {
          lastError: (error instanceof Error ? error.name : 'StorageError').slice(0, 80),
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600000, 5000 * 2 ** Math.min(row.attempts, 10)),
          ),
        },
      });
      return false;
    }
  }
}
