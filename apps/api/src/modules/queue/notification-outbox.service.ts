import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment';
import type { NotificationType, Prisma } from '../../generated/prisma/client';
@Injectable()
export class NotificationOutboxService {
  readonly environment: string;
  constructor(config: ConfigService<Environment, true>) {
    this.environment = config.get('NODE_ENV', { infer: true });
  }
  async emails(
    tx: Prisma.TransactionClient,
    notifications: { id: string; type: NotificationType }[],
  ) {
    const data = notifications
      .filter((row) =>
        ['TASK_ASSIGNED', 'MENTION', 'DUE_DATE', 'PROJECT_INVITE', 'WORKSPACE_INVITE'].includes(
          row.type,
        ),
      )
      .map((row) => ({ notificationId: row.id, environment: this.environment }));
    if (data.length) await tx.notificationDelivery.createMany({ data, skipDuplicates: true });
  }
  async reminder(
    tx: Prisma.TransactionClient,
    taskId: string,
    dueDate: Date | null,
    disabled: boolean,
  ) {
    const old = await tx.dueReminder.findUnique({ where: { taskId } });
    if (!dueDate || disabled) {
      if (old && old.status !== 'CANCELLED')
        await tx.dueReminder.update({
          where: { taskId },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });
      return;
    }
    if (old && old.dueDate.getTime() === dueDate.getTime() && old.status !== 'CANCELLED') return;
    const data = {
      dueDate,
      runAt: new Date(dueDate.getTime() - 86400000),
      environment: this.environment,
      status: 'PENDING' as const,
    };
    if (old)
      await tx.dueReminder.update({
        where: { taskId },
        data: { ...data, version: { increment: 1 } },
      });
    else await tx.dueReminder.create({ data: { ...data, taskId } });
  }
}
